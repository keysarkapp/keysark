// 本地优先的保险库数据层(环境无关)。每个库的数据在各自子目录 dir 下。
//
// 模型(以某个保险库的 dir 为基准,dir="" 表示历史单库在沙盒根):
//   - <dir>/index.json          ← 加密信封,明文为 { v, entries, folders },做检索。
//   - <dir>/items/<uuidv7>.json ← 每条条目一个文件,加密信封,明文为 EntryDoc。
//   - keysark.json(沙盒根)     ← 保险库注册表(明文元数据 + 密文校验块)。
//
// 写入流程:先加密落本地缓存(密文),再经 transport 同步到网盘。
// 同步失败不影响本地副本,失败项标记 pending,可手动重试。
//
// E2E:主密钥只在内存;落本地/上网盘的都是不透明密文信封。transport 只搬运密文。
import { newId } from "@keysark/db/id";
import { decryptFromEnvelope, encryptToEnvelope } from "@keysark/crypto";
import {
  INDEX_NAME,
  ITEMS_DIR,
  REGISTRY_NAME,
  b64decode,
  b64encode,
  joinPath,
  type CacheStore,
  type EntryDoc,
  type EntryMeta,
  type FolderMeta,
  type IndexDoc,
  type Registry,
  type StorageTransport,
} from "./types";

function emptyIndex(): IndexDoc {
  return { v: 2, entries: [], folders: [] };
}

/** 归一化(兼容旧 v1:补 folders/folderId 默认值;旧数据里的 tags 直接丢弃)。 */
function normalizeIndex(raw: unknown): IndexDoc {
  const r = (raw ?? {}) as Partial<IndexDoc>;
  const folders: FolderMeta[] = Array.isArray(r.folders)
    ? r.folders.filter((f): f is FolderMeta => !!f && typeof f.id === "string")
    : [];
  const entries: EntryMeta[] = Array.isArray(r.entries)
    ? r.entries.map((e) => ({
        id: e.id,
        title: e.title ?? "",
        folderId: e.folderId ?? null,
        createdAt: e.createdAt ?? 0,
        updatedAt: e.updatedAt ?? 0,
        size: e.size ?? 0,
      }))
    : [];
  return { v: 2, entries, folders };
}

// ---------- 加解密 JSON ----------
async function encJson(key: CryptoKey, obj: unknown): Promise<Uint8Array> {
  return encryptToEnvelope(key, JSON.stringify(obj));
}
async function decJson<T>(key: CryptoKey, bytes: Uint8Array): Promise<T> {
  return JSON.parse(await decryptFromEnvelope(key, bytes)) as T;
}

function sortEntries(entries: EntryMeta[]): EntryMeta[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 写注册表到网盘(覆盖)。注册表是明文 JSON(只含元数据 + 密文校验块),
 * 经 transport 字节进字节出。
 */
export async function saveRegistry(transport: StorageTransport, reg: Registry): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(reg));
  await transport.upload(REGISTRY_NAME, bytes);
}

export class Vault {
  private fileMap = new Map<string, { id: string; size: number }>();
  private index: IndexDoc = emptyIndex();
  private readonly dir: string;
  private readonly cache: CacheStore;
  private readonly transport: StorageTransport;

  /**
   * @param key 助记词派生的主密钥(只在内存)。
   * @param opts.dir 数据目录,""=沙盒根(历史单库)。
   * @param transport 密文中转(浏览器=fetch /api/files;CLI=HTTP localhost)。
   * @param cache 本地密文缓存(按保险库 id 分命名空间)。
   */
  constructor(
    private readonly key: CryptoKey,
    opts: { dir: string },
    transport: StorageTransport,
    cache: CacheStore,
  ) {
    this.dir = opts.dir;
    this.transport = transport;
    this.cache = cache;
  }

  private indexPath(): string {
    return joinPath(this.dir, INDEX_NAME);
  }
  private itemsDir(): string {
    return joinPath(this.dir, ITEMS_DIR);
  }
  private itemPath(id: string): string {
    return joinPath(this.itemsDir(), `${id}.json`);
  }

  get entries(): EntryMeta[] {
    return sortEntries(this.index.entries);
  }
  pendingCount(): number {
    return this.cache.pendingCount();
  }

  /** 解锁后加载:以网盘 index.json 为准,失败则回退本地缓存。 */
  async load(): Promise<EntryMeta[]> {
    try {
      this.fileMap = await this.transport.list(this.dir);
      const idxFile = this.fileMap.get(INDEX_NAME);
      if (idxFile) {
        const bytes = await this.transport.download(idxFile.id);
        this.index = normalizeIndex(await decJson<unknown>(this.key, bytes));
        this.cache.setIndex(b64encode(bytes), false);
        return this.entries;
      }
    } catch {
      // 网盘不可达 → 用本地缓存(离线可读)
      const cached = this.cache.getIndex();
      if (cached) {
        try {
          this.index = normalizeIndex(await decJson<unknown>(this.key, b64decode(cached)));
        } catch {
          this.index = emptyIndex();
        }
      }
      return this.entries;
    }
    this.index = emptyIndex();
    return this.entries;
  }

  /** 打开条目:本地优先,未命中再回网盘。 */
  async open(id: string): Promise<EntryDoc> {
    const cached = this.cache.getEntry(id);
    if (cached) {
      try {
        return await decJson<EntryDoc>(this.key, b64decode(cached));
      } catch {
        /* 本地损坏 → 回网盘 */
      }
    }
    const itemsMap = await this.transport.list(this.itemsDir());
    const f = itemsMap.get(`${id}.json`);
    if (!f) throw new Error("entry not found on netdisk");
    const bytes = await this.transport.download(f.id);
    this.cache.setEntry(id, b64encode(bytes), false);
    return decJson<EntryDoc>(this.key, bytes);
  }

  /**
   * 新建或更新条目。先加密落本地(乐观提交),再同步网盘(条目 + index)。
   * 同步失败不回滚本地副本,返回 synced=false + 错误,失败项保持 pending。
   */
  async save(input: {
    id?: string | null;
    title: string;
    content: string;
    folderId?: string | null;
  }): Promise<{ id: string; entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    const now = Date.now();
    const id = input.id ?? newId();
    const existing = this.index.entries.find((e) => e.id === id);
    const createdAt = existing?.createdAt ?? now;
    const folderId = input.folderId ?? null;
    const doc: EntryDoc = { id, title: input.title, content: input.content, folderId, createdAt, updatedAt: now };

    const entryEnvelope = await encJson(this.key, doc);
    const meta: EntryMeta = { id, title: input.title, folderId, createdAt, updatedAt: now, size: entryEnvelope.byteLength };
    if (existing) Object.assign(existing, meta);
    else this.index.entries.push(meta);
    const indexEnvelope = await encJson(this.key, this.index);

    // 1) 本地优先(标 pending)
    this.cache.setEntry(id, b64encode(entryEnvelope), true);
    this.cache.setIndex(b64encode(indexEnvelope), true);

    // 2) 同步网盘
    try {
      await this.transport.upload(this.itemPath(id), entryEnvelope);
      this.cache.clearPending(id);
      await this.transport.upload(this.indexPath(), indexEnvelope);
      this.cache.clearIndexPending();
    } catch (err) {
      return { id, entries: this.entries, synced: false, syncError: String(err) };
    }
    return { id, entries: this.entries, synced: true };
  }

  /**
   * 删除条目:从 index 摘除 + 清本地缓存,再同步 index。
   * 注:当前 StorageTransport 无 delete 原语,网盘上的条目文件会成为不被 index 引用的孤儿
   * (不再出现在任何列表/检索中)。引入 transport.delete 后可真正清除 —— 见 feedback。
   */
  async remove(id: string): Promise<{ entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    this.index.entries = this.index.entries.filter((e) => e.id !== id);
    this.cache.clearPending(id);
    const res = await this.persistIndex();
    return { entries: this.entries, ...res };
  }

  // ---------- 文件夹(仅改 index;本地优先 + 同步) ----------
  get folders(): FolderMeta[] {
    return [...this.index.folders];
  }

  private async persistIndex(): Promise<{ synced: boolean; syncError?: string }> {
    const env = await encJson(this.key, this.index);
    this.cache.setIndex(b64encode(env), true);
    try {
      await this.transport.upload(this.indexPath(), env);
      this.cache.clearIndexPending();
      return { synced: true };
    } catch (err) {
      return { synced: false, syncError: String(err) };
    }
  }

  async addFolder(
    name: string,
    parentId: string | null,
  ): Promise<{ id: string; folders: FolderMeta[]; synced: boolean; syncError?: string }> {
    const id = newId();
    this.index.folders.push({ id, name: name.trim(), parentId, createdAt: Date.now() });
    const res = await this.persistIndex();
    return { id, folders: this.folders, ...res };
  }

  /** 把条目移动到某文件夹(null=根)。只改 index 元数据,本地优先 + 同步。 */
  async moveEntry(
    id: string,
    folderId: string | null,
  ): Promise<{ entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    const e = this.index.entries.find((x) => x.id === id);
    if (e) e.folderId = folderId;
    const res = await this.persistIndex();
    return { entries: this.entries, ...res };
  }

  async renameFolder(
    id: string,
    name: string,
  ): Promise<{ folders: FolderMeta[]; synced: boolean; syncError?: string }> {
    const f = this.index.folders.find((x) => x.id === id);
    if (f) f.name = name.trim();
    const res = await this.persistIndex();
    return { folders: this.folders, ...res };
  }

  /** 删除文件夹:其子文件夹与条目都上移到被删文件夹的父级(不丢数据)。 */
  async deleteFolder(id: string): Promise<{
    folders: FolderMeta[];
    entries: EntryMeta[];
    synced: boolean;
    syncError?: string;
  }> {
    const target = this.index.folders.find((x) => x.id === id);
    const parentId = target?.parentId ?? null;
    for (const f of this.index.folders) if (f.parentId === id) f.parentId = parentId;
    for (const e of this.index.entries) if (e.folderId === id) e.folderId = parentId;
    this.index.folders = this.index.folders.filter((x) => x.id !== id);
    const res = await this.persistIndex();
    return { folders: this.folders, entries: this.entries, ...res };
  }

  /** 手动重试:把本地 pending 的条目与 index 重新推送到网盘。 */
  async sync(): Promise<{ remaining: number }> {
    for (const id of this.cache.pendingEntries()) {
      const env = this.cache.getEntry(id);
      if (!env) {
        this.cache.clearPending(id);
        continue;
      }
      await this.transport.upload(this.itemPath(id), b64decode(env));
      this.cache.clearPending(id);
    }
    if (this.cache.indexPending()) {
      const idx = this.cache.getIndex();
      if (idx) {
        await this.transport.upload(this.indexPath(), b64decode(idx));
        this.cache.clearIndexPending();
      }
    }
    return { remaining: this.cache.pendingCount() };
  }
}
