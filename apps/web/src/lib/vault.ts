// 浏览器侧的 vault 适配层:把环境无关的 @keysark/vault 接到浏览器实现 ——
//   - StorageTransport → fetch('/api/files*')(服务端只搬运密文)
//   - CacheStore       → localStorage(密文信封 base64,按保险库分命名空间)
// E2E:主密钥只在内存;落本地/上网盘的都是不透明密文信封。
import {
  Vault,
  makeCache,
  type CacheStore,
  type KvStore,
  type StorageTransport,
} from "@keysark/vault";

// ---------- 浏览器密文中转:/api/files* ----------
function b64encode(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export const browserTransport: StorageTransport = {
  async list(dir) {
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const data = (await res.json()) as { files: { id: string; name: string; size: number }[] };
    const m = new Map<string, { id: string; size: number }>();
    for (const f of data.files) m.set(f.name, { id: f.id, size: f.size });
    return m;
  },
  async upload(path, bytes) {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, contentB64: b64encode(bytes) }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  },
  async download(fileId) {
    const res = await fetch(`/api/files/content?fileId=${encodeURIComponent(fileId)}`);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const data = (await res.json()) as { contentB64: string };
    return b64decode(data.contentB64);
  },
};

// ---------- 浏览器缓存后端:localStorage ----------
const localStorageKv: KvStore = {
  get(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, val) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, val);
    } catch {
      /* 配额/隐私模式:本地缓存只是镜像,忽略写失败 */
    }
  },
};

function browserCache(vaultId: string): CacheStore {
  return makeCache(localStorageKv, vaultId);
}

/** 用浏览器 transport + localStorage 缓存装配一个 Vault。 */
export function openBrowserVault(key: CryptoKey, descriptor: { id: string; dir: string }): Vault {
  return new Vault(key, { dir: descriptor.dir }, browserTransport, browserCache(descriptor.id));
}

// 类型与路径工具直接透传 @keysark/vault,消费方仍从 "@/lib/vault" import。
export {
  Vault,
  itemRelPath,
  type EntryMeta,
  type FolderMeta,
} from "@keysark/vault";
