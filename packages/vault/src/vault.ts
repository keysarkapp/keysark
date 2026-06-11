// 本地优先的保险库数据层(环境无关)。每个库的数据在各自子目录 dir 下。
//
// 模型(以某个保险库的 dir 为基准,dir="" 表示历史单库在沙盒根):
//   - <dir>/index.json                   ← 加密信封,明文为 { v, entries, folders },做检索。
//   - <dir>/items/<id>/<ts>.json         ← 条目某版本快照(加密信封,明文 EntryDoc),不可变。
//   - <dir>/items/<id>/<ts>.bin          ← 文件条目某版本正文(二进制信封),不可变。
//   - keysark.json(沙盒根)              ← 保险库注册表(明文元数据 + 密文校验块)。
//
// 版本:每次内容保存写一份时间戳命名的新快照,旧快照永不覆盖/删除 → 历史自然累积。
//   当前版由 EntryMeta.updatedAt 直接指向(即当前版快照文件名)。目录列表自描述
//   (文件名=ts=版本号+时间),故无需 manifest。保存前用明文 SHA-256 去重:内容
//   与当前版相同则不写新快照。开/存当前版的网络往返数与无版本时一致。
//
// 写入流程:先加密落本地缓存(密文),再经 transport 同步到网盘。
// 同步失败不影响本地副本,失败项标记 pending,可手动重试。
//
// E2E:主密钥只在内存;落本地/上网盘的都是不透明密文信封。transport 只搬运密文。
import { newId } from "@keysark/db/id";
import {
  decryptBytesFromBlob,
  decryptFromEnvelope,
  encryptBytesToBlob,
  encryptToEnvelope,
  sha256Hex,
} from "@keysark/crypto";
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
  type VersionMeta,
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
        kind: e.kind ?? "text", // 旧数据无 kind → 视为文本
        ...(e.filename !== undefined ? { filename: e.filename } : {}),
        ...(e.mimeType !== undefined ? { mimeType: e.mimeType } : {}),
        ...(e.fileSize !== undefined ? { fileSize: e.fileSize } : {}),
        ...(e.contentHash !== undefined ? { contentHash: e.contentHash } : {}),
        ...(e.versions !== undefined ? { versions: e.versions } : {}),
        ...(e.provider !== undefined ? { provider: e.provider } : {}),
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
  /** 某条目的版本目录:<dir>/items/<id>(其下每个版本一份 <ts>.json[/.bin])。 */
  private versionsDir(id: string): string {
    return joinPath(this.itemsDir(), id);
  }
  private versionPath(id: string, ts: number): string {
    return joinPath(this.versionsDir(id), `${ts}.json`);
  }
  private blobVersionPath(id: string, ts: number): string {
    return joinPath(this.versionsDir(id), `${ts}.bin`);
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

  /** 打开条目(当前版):本地优先,未命中再回网盘读 items/<id>/<updatedAt>.json。 */
  async open(id: string): Promise<EntryDoc> {
    const cached = this.cache.getEntry(id);
    if (cached) {
      try {
        return await decJson<EntryDoc>(this.key, b64decode(cached));
      } catch {
        /* 本地损坏 → 回网盘 */
      }
    }
    const meta = this.index.entries.find((e) => e.id === id);
    if (!meta) throw new Error("entry not found");
    const versMap = await this.transport.list(this.versionsDir(id));
    const f = versMap.get(`${meta.updatedAt}.json`);
    if (!f) throw new Error("entry version not found on netdisk");
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
    provider?: string | null; // undefined=保留原值;null/空串=清除;字符串=设置
  }): Promise<{ id: string; entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    const now = Date.now();
    const id = input.id ?? newId();
    const existing = this.index.entries.find((e) => e.id === id);
    const createdAt = existing?.createdAt ?? now;
    const folderId = input.folderId ?? null;
    const provider =
      input.provider === undefined ? existing?.provider : input.provider || undefined;
    const contentHash = await sha256Hex(new TextEncoder().encode(input.content));

    // 内容去重:与当前版内容相同 → 不写新快照(不动 updatedAt = 不生成新版本)。
    if (existing && existing.contentHash === contentHash) {
      // 仅 title/folder/provider 变化时更新 index 元数据;内容无变化则完全 no-op。
      if (
        existing.title !== input.title ||
        existing.folderId !== folderId ||
        existing.provider !== provider
      ) {
        existing.title = input.title;
        existing.folderId = folderId;
        if (provider !== undefined) existing.provider = provider;
        else delete existing.provider;
        const res = await this.persistIndex();
        return { id, entries: this.entries, ...res };
      }
      return { id, entries: this.entries, synced: true };
    }

    const doc: EntryDoc = { id, title: input.title, content: input.content, folderId, createdAt, updatedAt: now, contentHash, ...(provider !== undefined ? { provider } : {}) };

    // 写一份新快照 → 版本数 +1(旧数据无 versions 时按已有 1 版计)。
    const versions = (existing ? (existing.versions ?? 1) : 0) + 1;
    const entryEnvelope = await encJson(this.key, doc);
    const meta: EntryMeta = { id, title: input.title, folderId, createdAt, updatedAt: now, size: entryEnvelope.byteLength, contentHash, versions, ...(provider !== undefined ? { provider } : {}) };
    if (existing) {
      Object.assign(existing, meta);
      if (provider === undefined) delete existing.provider; // input.provider=null 显式清除
    } else this.index.entries.push(meta);
    const indexEnvelope = await encJson(this.key, this.index);

    // 1) 本地优先(标 pending)
    this.cache.setEntry(id, b64encode(entryEnvelope), true);
    this.cache.setIndex(b64encode(indexEnvelope), true);

    // 2) 同步网盘:写新版本快照 + index,并行上传(往返数与无版本时相同:2 PUT)。
    //    部分成功(一个成功一个失败)留失败项 pending,返回 synced=false。
    const results = await Promise.allSettled([
      this.transport
        .upload(this.versionPath(id, now), entryEnvelope)
        .then(() => this.cache.clearPending(id)),
      this.transport
        .upload(this.indexPath(), indexEnvelope)
        .then(() => this.cache.clearIndexPending()),
    ]);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) {
      return { id, entries: this.entries, synced: false, syncError: String(failed.reason) };
    }
    return { id, entries: this.entries, synced: true };
  }

  /**
   * 新建或更新文件条目。文件正文(原始字节)加密成二进制信封,存独立 <id>.bin;
   * 元信息(title/filename/mimeType/fileSize,content 留空)走 JSON 信封存 <id>.json。
   * 加密只在调用方(浏览器)内存做,网盘只见密文。本地优先 + 并行同步 + pending 同 save。
   */
  async saveFile(input: {
    id?: string | null;
    title: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    folderId?: string | null;
  }): Promise<{ id: string; entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    const now = Date.now();
    const id = input.id ?? newId();
    const existing = this.index.entries.find((e) => e.id === id);
    const createdAt = existing?.createdAt ?? now;
    const folderId = input.folderId ?? null;
    const fileSize = input.bytes.byteLength;
    const contentHash = await sha256Hex(input.bytes);

    // 内容去重:文件字节与当前版相同 → 不写新快照(不动 updatedAt)。
    if (existing && existing.contentHash === contentHash) {
      if (
        existing.title !== input.title ||
        existing.folderId !== folderId ||
        existing.filename !== input.filename
      ) {
        existing.title = input.title;
        existing.folderId = folderId;
        existing.filename = input.filename;
        const res = await this.persistIndex();
        return { id, entries: this.entries, ...res };
      }
      return { id, entries: this.entries, synced: true };
    }

    const doc: EntryDoc = {
      id,
      title: input.title,
      content: "",
      folderId,
      createdAt,
      updatedAt: now,
      kind: "file",
      filename: input.filename,
      mimeType: input.mimeType,
      fileSize,
      contentHash,
    };

    // 写一份新快照 → 版本数 +1(旧数据无 versions 时按已有 1 版计)。
    const versions = (existing ? (existing.versions ?? 1) : 0) + 1;
    const blob = await encryptBytesToBlob(this.key, input.bytes);
    const entryEnvelope = await encJson(this.key, doc);
    const meta: EntryMeta = {
      id,
      title: input.title,
      folderId,
      createdAt,
      updatedAt: now,
      size: entryEnvelope.byteLength,
      kind: "file",
      filename: input.filename,
      mimeType: input.mimeType,
      fileSize,
      contentHash,
      versions,
    };
    if (existing) Object.assign(existing, meta);
    else this.index.entries.push(meta);
    const indexEnvelope = await encJson(this.key, this.index);

    // 本地优先:元信息信封进缓存(标 pending);文件 blob 不进 localStorage(可达 100MB,会爆配额)。
    this.cache.setEntry(id, b64encode(entryEnvelope), true);
    this.cache.setIndex(b64encode(indexEnvelope), true);

    // 同步网盘:写新版本的 blob + 元信息 + index,并行上传(往返数与无版本时相同:3 PUT)。
    const results = await Promise.allSettled([
      this.transport.upload(this.blobVersionPath(id, now), blob),
      this.transport
        .upload(this.versionPath(id, now), entryEnvelope)
        .then(() => this.cache.clearPending(id)),
      this.transport
        .upload(this.indexPath(), indexEnvelope)
        .then(() => this.cache.clearIndexPending()),
    ]);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) {
      return { id, entries: this.entries, synced: false, syncError: String(failed.reason) };
    }
    return { id, entries: this.entries, synced: true };
  }

  /** 打开文件条目(当前版):下载 items/<id>/<updatedAt>.bin 密文信封 → 解密 → 原始字节。 */
  async openFile(id: string): Promise<Uint8Array> {
    const meta = this.index.entries.find((e) => e.id === id);
    if (!meta) throw new Error("entry not found");
    const versMap = await this.transport.list(this.versionsDir(id));
    const f = versMap.get(`${meta.updatedAt}.bin`);
    if (!f) throw new Error("file blob not found on netdisk");
    const blob = await this.transport.download(f.id);
    return decryptBytesFromBlob(this.key, blob);
  }

  // ---------- 历史版本(冷路径;只在用户主动查看历史时触发,不在开/存当前版的热路径) ----------

  /** 列某条目的全部版本(倒序)。由 items/<id>/ 目录列表派生,文件名即时间戳。 */
  async listVersions(id: string): Promise<VersionMeta[]> {
    const map = await this.transport.list(this.versionsDir(id));
    const acc = new Map<number, { hasBin: boolean; jsonSize: number; binSize: number }>();
    for (const [name, f] of map) {
      const m = /^(\d+)\.(json|bin)$/.exec(name);
      if (!m) continue;
      const ts = Number(m[1]);
      const e = acc.get(ts) ?? { hasBin: false, jsonSize: 0, binSize: 0 };
      if (m[2] === "bin") {
        e.hasBin = true;
        e.binSize = f.size;
      } else {
        e.jsonSize = f.size;
      }
      acc.set(ts, e);
    }
    const out: VersionMeta[] = [];
    for (const [ts, e] of acc) {
      out.push({ ts, kind: e.hasBin ? "file" : "text", size: e.hasBin ? e.binSize : e.jsonSize });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  /** 读某条目某版本的 EntryDoc(文本正文 / 文件元信息)。 */
  async openVersion(id: string, ts: number): Promise<EntryDoc> {
    const map = await this.transport.list(this.versionsDir(id));
    const f = map.get(`${ts}.json`);
    if (!f) throw new Error("version not found on netdisk");
    const bytes = await this.transport.download(f.id);
    return decJson<EntryDoc>(this.key, bytes);
  }

  /** 读某文件条目某版本的原始字节。 */
  async openFileVersion(id: string, ts: number): Promise<Uint8Array> {
    const map = await this.transport.list(this.versionsDir(id));
    const f = map.get(`${ts}.bin`);
    if (!f) throw new Error("file version not found on netdisk");
    const blob = await this.transport.download(f.id);
    return decryptBytesFromBlob(this.key, blob);
  }

  /**
   * 还原某历史版本为当前版:读旧版内容 → 以 now 走 save/saveFile 存为新版本。
   * 经内容 hash 去重:若旧版内容与当前版相同则为 no-op(不新增版本)。保留当前 title/folder。
   */
  async restoreVersion(
    id: string,
    ts: number,
  ): Promise<{ id: string; entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    const meta = this.index.entries.find((e) => e.id === id);
    if (!meta) throw new Error("entry not found");
    if (meta.kind === "file") {
      const doc = await this.openVersion(id, ts);
      const bytes = await this.openFileVersion(id, ts);
      return this.saveFile({
        id,
        title: meta.title,
        filename: doc.filename ?? meta.filename ?? "file",
        mimeType: doc.mimeType ?? meta.mimeType ?? "application/octet-stream",
        bytes,
        folderId: meta.folderId,
      });
    }
    const doc = await this.openVersion(id, ts);
    return this.save({ id, title: meta.title, content: doc.content, folderId: meta.folderId });
  }

  /**
   * 删除条目:从 index 摘除 + 清本地缓存,删除 items/<id>/ 子目录下全部版本文件。
   * 删除失败不阻塞 index 同步(下次手工清理仍可)。
   */
  async remove(id: string): Promise<{ entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    this.index.entries = this.index.entries.filter((e) => e.id !== id);
    this.cache.clearPending(id);
    // 列出该条目所有版本文件并逐个删除(无保留上限 → 可能多版本)。幂等;失败不影响 index 摘除。
    try {
      const versMap = await this.transport.list(this.versionsDir(id));
      await Promise.allSettled(
        [...versMap.keys()].map((name) =>
          this.transport.delete(joinPath(this.versionsDir(id), name)),
        ),
      );
    } catch {
      /* 列举失败(目录已不在等)→ 跳过,index 摘除仍继续 */
    }
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
      const meta = this.index.entries.find((e) => e.id === id);
      if (!env || !meta) {
        this.cache.clearPending(id);
        continue;
      }
      // 重传到该条目当前版的快照路径(updatedAt 即版本文件名)。
      await this.transport.upload(this.versionPath(id, meta.updatedAt), b64decode(env));
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
