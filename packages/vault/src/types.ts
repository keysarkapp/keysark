// 共享 vault 数据层的类型、常量、路径工具与抽象接口(transport / cache)。
// 这一层不碰任何环境特定 API(无 fetch、无 window/localStorage、无 node:fs);
// 由消费方(浏览器 / CLI)注入 StorageTransport + CacheStore 实现。

// ---------- 存储路径常量 ----------
export const INDEX_NAME = "index.json";
export const ITEMS_DIR = "items";
/** 保险库注册表文件名(沙盒一级目录)。 */
export const REGISTRY_NAME = "keysark.json";
/** 历史单库的校验文件名(无注册表时据此迁移为单个 legacy 保险库)。 */
export const LEGACY_META_NAME = ".keysark.json";
/** 历史单库的固定 id;其数据在沙盒根目录(dir="")。 */
export const LEGACY_VAULT_ID = "legacy";

// ---------- 数据模型 ----------
/** 文件夹:靠 parentId 串成无限嵌套的树;只存在于 index 里(无独立文件)。 */
export interface FolderMeta {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}
export interface EntryMeta {
  id: string;
  title: string;
  folderId: string | null; // null = 根目录
  createdAt: number;
  updatedAt: number;
  size: number;
}
export interface IndexDoc {
  v: number;
  entries: EntryMeta[];
  folders: FolderMeta[];
}
export interface EntryDoc {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 保险库注册表条目(明文元数据 + 密文校验块)。 */
export interface VaultDescriptor {
  id: string; // uuidv7;历史单库为 LEGACY_VAULT_ID
  label: string; // 用户可见名称(明文元数据,可为空 → 前端回退默认名)
  dir: string; // 条目数据目录(相对沙盒根);"" 表示历史库(根目录)
  verifier: string; // 校验块密文信封的 base64
  createdAt: number;
}
export interface Registry {
  v: 1;
  vaults: VaultDescriptor[];
}

// ---------- 路径工具 ----------
/** 拼接沙盒内相对路径;base="" 时直接返回 name(历史单库在根目录)。 */
export function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}
/** 某条目在存储后端里的相对路径(dir 为保险库数据目录,""=根)。用于展示网盘位置。 */
export function itemRelPath(dir: string, id: string): string {
  return joinPath(joinPath(dir, ITEMS_DIR), `${id}.json`);
}
/** 新建保险库的数据目录:vaults/<id>。 */
export function vaultDir(id: string): string {
  return `vaults/${id}`;
}

// ---------- base64(纯实现,浏览器/Node 通用,依赖全局 btoa/atob) ----------
export function b64encode(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---------- 抽象:密文中转 ----------
/** 存储后端的密文中转:路径进、密文字节出,内容无关。浏览器=fetch /api/files;CLI=HTTP localhost。 */
export interface StorageTransport {
  /** 列某相对目录下的文件,返回 name→{id,size}。 */
  list(dir: string): Promise<Map<string, { id: string; size: number }>>;
  /** 上传/覆盖文件到相对路径。 */
  upload(path: string, bytes: Uint8Array): Promise<void>;
  /** 按文件 id 下载原始字节。 */
  download(fileId: string): Promise<Uint8Array>;
}

// ---------- 抽象:本地密文缓存 ----------
/** Vault 需要的本地缓存能力(存的都是密文信封 base64,按保险库分命名空间)。 */
export interface CacheStore {
  getIndex(): string | null;
  setIndex(b64: string, pending: boolean): void;
  getEntry(id: string): string | null;
  setEntry(id: string, b64: string, pending: boolean): void;
  clearPending(id: string): void;
  clearIndexPending(): void;
  pendingCount(): number;
  /** 待同步条目 id 列表(供 sync 重推)。 */
  pendingEntries(): string[];
  indexPending(): boolean;
}
