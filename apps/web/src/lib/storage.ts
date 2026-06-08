// 统一存储抽象:把百度网盘与 Google Drive 收敛成同一套「路径进、密文字节出」接口。
// 上层(page.tsx / API /api/files*)只依赖此抽象,与具体后端无关。
// E2E 不变:服务端只搬运不透明密文,主密钥/助记词/明文绝不触达。
import { listStorageAccounts } from "@keysark/db";
import { getConnectedBaidu } from "./baidu";
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
    },
  };
}

/** 取当前会话的存储连接:优先 Google,其次百度;都未连接返回 null。 */
export async function getConnectedStorage(): Promise<ConnectedStorage | null> {
  const google = await getConnectedGoogle();
  if (google) return wrapGoogle(google);

  const baidu = await getConnectedBaidu();
  if (baidu) {
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
      },
    };
  }

  return null;
}

/** 本地接口鉴权头(桌面 sidecar / CLI 共用)。 */
const LOCAL_TOKEN_HEADER = "x-keysark-token";

/**
 * 本地接口(:35291)的无 cookie 解析:校验 x-keysark-token,通过后按桌面唯一 Google 账号解析。
 * 仅当 sidecar 设置了 KEYSARK_LOCAL_TOKEN(桌面模式)才启用;云端 web 未设置 → 恒返回 null。
 * v1 仅 Google。
 */
export async function getConnectedStorageByLocalAuth(
  request: Request,
): Promise<ConnectedStorage | null> {
  const expected = process.env.KEYSARK_LOCAL_TOKEN;
  if (!expected) return null; // 非桌面模式,不启用本地鉴权
  const presented = request.headers.get(LOCAL_TOKEN_HEADER);
  if (!presented || presented !== expected) return null;

  const accounts = await listStorageAccounts("google");
  if (accounts.length === 0) return null; // 桌面还未登录任何 Google 账号
  const google = await getConnectedGoogleBySub(accounts[0]!.accountKey);
  return google ? wrapGoogle(google) : null;
}

/**
 * 按请求解析存储连接:先走会话 cookie(浏览器/webview),再走本地 token(CLI)。
 * /api/files* 用它替代 getConnectedStorage,使 webview 与 CLI 都能访问。
 */
export async function getStorageForRequest(request: Request): Promise<ConnectedStorage | null> {
  const byCookie = await getConnectedStorage();
  if (byCookie) return byCookie;
  return getConnectedStorageByLocalAuth(request);
}
