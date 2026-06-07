// 统一存储抽象:把百度网盘与 Google Drive 收敛成同一套「路径进、密文字节出」接口。
// 上层(page.tsx / API /api/files*)只依赖此抽象,与具体后端无关。
// E2E 不变:服务端只搬运不透明密文,主密钥/助记词/明文绝不触达。
import { getConnectedBaidu } from "./baidu";
import { getConnectedGoogle } from "./google";

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

/** 取当前会话的存储连接:优先 Google,其次百度;都未连接返回 null。 */
export async function getConnectedStorage(): Promise<ConnectedStorage | null> {
  const google = await getConnectedGoogle();
  if (google) {
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
