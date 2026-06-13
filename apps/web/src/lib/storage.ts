// 统一存储抽象:把百度网盘与 Google Drive 收敛成同一套「路径进、密文字节出」接口。
// 上层(page.tsx / API /api/files*)只依赖此抽象,与具体后端无关。
// E2E 不变:服务端只搬运不透明密文,主密钥/助记词/明文绝不触达。
import { getCliTokenByHash } from "@keysark/db";
import { sha256Hex } from "./cli-auth";
import { getConnectedBaidu, getConnectedBaiduByUk, type ConnectedBaidu } from "./baidu";
import { getConnectedGoogle, getConnectedGoogleBySub, type ConnectedGoogle } from "./google";

export type StorageProvider = "baidu" | "google";

export interface StorageFile {
  id: string;
  name: string;
  size: number;
}
export interface StorageUser {
  name: string;
  avatar: string | null;
}
export interface StorageClient {
  userInfo(): Promise<StorageUser>;
  /** 列出某相对目录下的文件(不含子目录),""=根。 */
  list(dir: string): Promise<StorageFile[]>;
  /** 上传/覆盖文件到相对路径(目录按需创建)。 */
  upload(path: string, bytes: Uint8Array): Promise<void>;
  /** 按文件 id 下载原始字节。 */
  download(fileId: string): Promise<Uint8Array>;
  /** 删除相对路径的文件;不存在应幂等不报错。 */
  delete(path: string): Promise<void>;
}
export interface ConnectedStorage {
  provider: StorageProvider;
  accountKey: string;
  /** 存储根的展示前缀(百度沙盒绝对路径 / Google 的 displayRoot)。用于客户端直接拼「打开链接」。 */
  root: string;
  client: StorageClient;
}

/** 把一个已连接的 Google 客户端包装成统一 ConnectedStorage(cookie 路径与本地接口路径共用)。 */
function wrapGoogle(google: ConnectedGoogle): ConnectedStorage {
  const c = google.client;
  return {
    provider: "google",
    accountKey: google.sub,
    root: c.displayRoot,
    client: {
      async userInfo() {
        const i = await c.userInfo();
        return { name: i.name || i.email || "", avatar: i.picture || null };
      },
      list: (dir) => c.list(dir),
      upload: (path, bytes) => c.upload(path, bytes),
      download: (id) => c.download(id),
      delete: (path) => c.remove(path),
    },
  };
}

/** 把一个已连接的百度客户端包装成统一 ConnectedStorage(cookie 路径与 CLI token 路径共用)。 */
function wrapBaidu(baidu: ConnectedBaidu): ConnectedStorage {
  const c = baidu.client;
  return {
    provider: "baidu",
    accountKey: baidu.uk,
    root: c.root,
    client: {
      async userInfo() {
        const i = await c.userInfo();
        return { name: i.netdisk_name || i.baidu_name || "", avatar: i.avatar_url || null };
      },
      async list(dir) {
        const files = await c.list(dir, { order: "time", desc: true });
        return files
          .filter((f) => f.isdir === 0)
          .map((f) => ({ id: String(f.fs_id), name: f.server_filename, size: f.size }));
      },
      async upload(path, bytes) {
        await c.upload(path, bytes, 3);
      },
      download: (id) => c.download(Number(id)),
      async delete(path) {
        // 百度删除不存在的路径会报 errno;delete 语义要求幂等 → 吞掉错误(best-effort)。
        try {
          await c.remove([path]);
        } catch (err) {
          console.warn("baidu delete ignored", path, String(err));
        }
      },
    },
  };
}

/** 取当前会话的存储连接:优先 Google,其次百度;都未连接返回 null。 */
export async function getConnectedStorage(): Promise<ConnectedStorage | null> {
  const google = await getConnectedGoogle();
  if (google) return wrapGoogle(google);

  const baidu = await getConnectedBaidu();
  if (baidu) return wrapBaidu(baidu);

  return null;
}

/** CLI 鉴权头。 */
const CLI_TOKEN_HEADER = "x-keysark-token";

/**
 * CLI 长期令牌(ksk_ 前缀,设备码授权颁发)的无 cookie 解析:
 * 哈希查 cli_token 表 → 绑定的 (provider, accountKey) → 对应后端客户端。
 * 仅 Postgres 模式可用;JSON token store(桌面)下查询抛错 → 按未认证处理。
 */
export async function getConnectedStorageByCliToken(
  request: Request,
): Promise<ConnectedStorage | null> {
  const presented = request.headers.get(CLI_TOKEN_HEADER);
  if (!presented || !presented.startsWith("ksk_")) return null;
  let bound: { provider: string; accountKey: string } | null = null;
  try {
    bound = await getCliTokenByHash(sha256Hex(presented));
  } catch (err) {
    console.error("cli token lookup failed", err);
    return null;
  }
  if (!bound) return null;
  if (bound.provider === "google") {
    const google = await getConnectedGoogleBySub(bound.accountKey);
    return google ? wrapGoogle(google) : null;
  }
  if (bound.provider === "baidu") {
    const baidu = await getConnectedBaiduByUk(bound.accountKey);
    return baidu ? wrapBaidu(baidu) : null;
  }
  return null;
}

/**
 * 按请求解析存储连接:会话 cookie(浏览器)→ CLI 设备码令牌。
 * /api/files* 用它替代 getConnectedStorage,使浏览器与 CLI 都能访问。
 */
export async function getStorageForRequest(request: Request): Promise<ConnectedStorage | null> {
  const byCookie = await getConnectedStorage();
  if (byCookie) return byCookie;
  return getConnectedStorageByCliToken(request);
}

/** 归一化沙盒内相对路径:拒绝绝对路径、空段、`.`/`..`/控制字符(防越界与歧义路径)。非法返回 null。 */
export function sanitizeRelPath(p: string | null, opts: { allowEmpty?: boolean } = {}): string | null {
  const t = (p ?? "").trim();
  if (!t) return opts.allowEmpty ? "" : null;
  if (t.startsWith("/") || /[\u0000-\u001f\u007f]/.test(t)) return null;
  const segs = t.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  return t;
}

/** 归一化沙盒内相对目录:允许空字符串表示根目录。 */
export function sanitizeRelDir(p: string | null): string | null {
  return sanitizeRelPath(p, { allowEmpty: true });
}

/**
 * 按沙盒相对路径下载:服务端在受信 app 根内 list 父目录、按文件名解析出 provider fileId,
 * 再下载。绝不接受客户端直接给的裸 fileId —— 杜绝代取账号内任意可访问文件。
 */
export async function downloadByPath(
  conn: ConnectedStorage,
  rawPath: string | null,
): Promise<{ status: "ok"; bytes: Uint8Array } | { status: "bad_path" } | { status: "not_found" }> {
  const safe = sanitizeRelPath(rawPath);
  if (!safe) return { status: "bad_path" };
  const slash = safe.lastIndexOf("/");
  const dir = slash >= 0 ? safe.slice(0, slash) : "";
  const base = slash >= 0 ? safe.slice(slash + 1) : safe;
  const files = await conn.client.list(dir);
  const f = files.find((x) => x.name === base);
  if (!f) return { status: "not_found" };
  return { status: "ok", bytes: await conn.client.download(f.id) };
}
