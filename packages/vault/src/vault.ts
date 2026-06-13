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

/** load 检测到网盘 index 版本回退(rev 低于本地已接受值)时抛出。 */
export class VaultRollbackError extends Error {
  constructor(
    readonly localRev: number,
    readonly remoteRev: number,
  ) {
    super(`vault index rollback detected: remote rev ${remoteRev} < local rev ${localRev}`);
    this.name = "VaultRollbackError";
  }
}

/** load 检测到远端 index 无法通过解密/AAD/JSON 校验时抛出。 */
export class VaultIntegrityError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`vault index integrity check failed: ${String(cause)}`);
    this.name = "VaultIntegrityError";
    this.cause = cause;
  }
}

function emptyIndex(): IndexDoc {
  return { v: 2, entries: [], folders: [], rev: 0 };
}

/**
 * 归一化(兼容旧 v1:补 folders/folderId 默认值;旧数据里的 tags 直接丢弃)。
 * 注意:除 tags 外的未知字段必须原样保留(先展开再补默认),否则新老客户端混用时,
 * 老客户端会把新 schema 字段从 index 里洗掉并随下次保存写回,造成永久丢失。
 */
function normalizeIndex(raw: unknown): IndexDoc {
  const r = (raw ?? {}) as Partial<IndexDoc>;
  const folders: FolderMeta[] = Array.isArray(r.folders)
    ? r.folders.filter((f): f is FolderMeta => !!f && typeof f.id === "string")
    : [];
  const entries: EntryMeta[] = Array.isArray(r.entries)
    ? r.entries.map((raw) => {
        const { tags: _legacyTags, ...e } = raw as EntryMeta & { tags?: unknown };
        return {
          ...e,
          title: e.title ?? "",
          folderId: e.folderId ?? null,
          createdAt: e.createdAt ?? 0,
          updatedAt: e.updatedAt ?? 0,
          size: e.size ?? 0,
          kind: e.kind ?? "text", // 旧数据无 kind → 视为文本
        };
      })
    : [];
  return { v: 2, entries, folders, rev: typeof r.rev === "number" ? r.rev : 0 };
}

// ---------- 加解密 JSON(aad 绑定逻辑位置,防替换/回滚) ----------
async function encJson(key: CryptoKey, obj: unknown, aad?: string): Promise<Uint8Array> {
  return encryptToEnvelope(key, JSON.stringify(obj), aad);
}
async function decJson<T>(key: CryptoKey, bytes: Uint8Array, aad?: string): Promise<T> {
  return JSON.parse(await decryptFromEnvelope(key, bytes, aad)) as T;
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

  // ---------- AAD 上下文:把密文绑定到其逻辑位置/身份(防跨位置替换、跨版本回滚) ----------
  /** index 绑定到本库 dir(防跨库 index 替换)。 */
  private idxAad(): string {
    return `ksv1|idx|${this.dir}`;
  }
  /** 条目文本快照绑定到 (id, 版本时间戳)。 */
  private docAad(id: string, ts: number): string {
    return `ksv1|doc|${id}|${ts}`;
  }
  /** 文件 blob 绑定到 (id, 版本时间戳)。 */
  private blobAad(id: string, ts: number): string {
    return `ksv1|blob|${id}|${ts}`;
  }
  /** index 每次写入前 +1(单调,供 load 回滚检测)。 */
  private bumpRev(): void {
    this.index.rev = (this.index.rev ?? 0) + 1;
  }

  get entries(): EntryMeta[] {
    return sortEntries(this.index.entries);
  }
  pendingCount(): number {
    return this.cache.pendingCount();
  }

  /**
   * 解锁后加载:以网盘 index.json 为准,网盘不可达则回退本地缓存。
   * 回滚检测:本地非 pending(已同步)且网盘 index rev 低于上次接受的 rev → 抛 VaultRollbackError
   * (恶意/被入侵的存储后端回滚到旧 index)。本地 pending 时跳过(本地领先是合法的)。
   * 远端 index 若已下载但解密/AAD/JSON 校验失败 → 抛 VaultIntegrityError,不静默回退。
   */
  async load(): Promise<EntryMeta[]> {
    let idxFile: { id: string; size: number } | undefined;
    try {
      this.fileMap = await this.transport.list(this.dir);
      idxFile = this.fileMap.get(INDEX_NAME);
    } catch (err) {
      // 网盘不可达 → 用本地缓存(离线可读)
      return this.loadCachedIndex();
    }
    if (!idxFile) {
      this.index = emptyIndex();
      return this.entries;
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.transport.download(this.indexPath());
    } catch {
      // index 存在但暂时下载失败(网络/后端错误) → 用本地缓存离线读。
      return this.loadCachedIndex();
    }
    let remote: IndexDoc;
    try {
      remote = normalizeIndex(await decJson<unknown>(this.key, bytes, this.idxAad()));
    } catch (err) {
      throw new VaultIntegrityError(err);
    }
    await this.assertNoRollback(remote);
    this.index = remote;
    this.cache.setIndex(b64encode(bytes), false);
    return this.entries;
  }

  private async loadCachedIndex(): Promise<EntryMeta[]> {
    const cached = this.cache.getIndex();
    if (cached) {
      try {
        this.index = normalizeIndex(await decJson<unknown>(this.key, b64decode(cached), this.idxAad()));
      } catch {
        this.index = emptyIndex();
      }
    }
    return this.entries;
  }

  /** 比对本地已接受的 index rev(缓存,非 pending 才算)与网盘 rev,检出回滚。 */
  private async assertNoRollback(remote: IndexDoc): Promise<void> {
    if (this.cache.indexPending()) return; // 本地有未同步改动,领先是合法的
    const cached = this.cache.getIndex();
    if (!cached) return;
    let prevRev: number;
    try {
      const prev = normalizeIndex(await decJson<unknown>(this.key, b64decode(cached), this.idxAad()));
      prevRev = prev.rev ?? 0;
    } catch {
      return; // 缓存损坏/无法解密 → 无从比较,放行
    }
    if ((remote.rev ?? 0) < prevRev) throw new VaultRollbackError(prevRev, remote.rev ?? 0);
  }

  /** 打开条目(当前版):本地优先,未命中再回网盘读 items/<id>/<updatedAt>.json。 */
  async open(id: string): Promise<EntryDoc> {
    const meta = this.index.entries.find((e) => e.id === id);
    if (!meta) throw new Error("entry not found");
    const aad = this.docAad(id, meta.updatedAt);
    const cached = this.cache.getEntry(id);
    if (cached) {
      try {
        return this.verifyDoc(await decJson<EntryDoc>(this.key, b64decode(cached), aad), id);
      } catch {
        /* 本地损坏/AAD 不符 → 回网盘 */
      }
    }
    const versMap = await this.transport.list(this.versionsDir(id));
    const f = versMap.get(`${meta.updatedAt}.json`);
    if (!f) throw new Error("entry version not found on netdisk");
    const bytes = await this.transport.download(this.versionPath(id, meta.updatedAt));
    const doc = this.verifyDoc(await decJson<EntryDoc>(this.key, bytes, aad), id);
    this.cache.setEntry(id, b64encode(bytes), false);
    return doc;
  }

  /** 解密后再校验 doc.id 与请求一致(AAD 之外的纵深防御)。 */
  private verifyDoc(doc: EntryDoc, id: string): EntryDoc {
    if (doc.id !== id) throw new Error(`entry id mismatch: expected ${id}, got ${doc.id}`);
    return doc;
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
    const entryEnvelope = await encJson(this.key, doc, this.docAad(id, now));
    const meta: EntryMeta = { id, title: input.title, folderId, createdAt, updatedAt: now, size: entryEnvelope.byteLength, contentHash, versions, ...(provider !== undefined ? { provider } : {}) };
    if (existing) {
      Object.assign(existing, meta);
      if (provider === undefined) delete existing.provider; // input.provider=null 显式清除
    } else this.index.entries.push(meta);
    this.bumpRev();
    const indexEnvelope = await encJson(this.key, this.index, this.idxAad());

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
    const blob = await encryptBytesToBlob(this.key, input.bytes, this.blobAad(id, now));
    const entryEnvelope = await encJson(this.key, doc, this.docAad(id, now));
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

    // 顺序提交:blob → (元信息 + index)。
    // blob 不进本地缓存(可达 100MB,会爆 localStorage 配额),失败便无法重试 → 必须先确认 blob 落盘
    // 成功,才把指向它的元信息/index 落本地缓存与网盘。否则 index 会指向缺失的 blob 且无从恢复。
    try {
      await this.transport.upload(this.blobVersionPath(id, now), blob);
    } catch (err) {
      // blob 上传失败:不改 index、不缓存,旧版本(若有)保持完整。本次保存整体失败。
      return { id, entries: this.entries, synced: false, syncError: String(err) };
    }

    // blob 已落盘 → 提交元信息与 index。两者都进缓存(小),即便上传失败也能由 sync() 重推恢复。
    if (existing) Object.assign(existing, meta);
    else this.index.entries.push(meta);
    this.bumpRev();
    const indexEnvelope = await encJson(this.key, this.index, this.idxAad());
    this.cache.setEntry(id, b64encode(entryEnvelope), true);
    this.cache.setIndex(b64encode(indexEnvelope), true);

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

  /** 打开文件条目(当前版):下载 items/<id>/<updatedAt>.bin 密文信封 → 解密 → 原始字节。 */
  async openFile(id: string): Promise<Uint8Array> {
    const meta = this.index.entries.find((e) => e.id === id);
    if (!meta) throw new Error("entry not found");
    const versMap = await this.transport.list(this.versionsDir(id));
    const f = versMap.get(`${meta.updatedAt}.bin`);
    if (!f) throw new Error("file blob not found on netdisk");
    const blob = await this.transport.download(this.blobVersionPath(id, meta.updatedAt));
    return decryptBytesFromBlob(this.key, blob, this.blobAad(id, meta.updatedAt));
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
    const bytes = await this.transport.download(this.versionPath(id, ts));
    return this.verifyDoc(await decJson<EntryDoc>(this.key, bytes, this.docAad(id, ts)), id);
  }

  /** 读某文件条目某版本的原始字节。 */
  async openFileVersion(id: string, ts: number): Promise<Uint8Array> {
    const map = await this.transport.list(this.versionsDir(id));
    const f = map.get(`${ts}.bin`);
    if (!f) throw new Error("file version not found on netdisk");
    const blob = await this.transport.download(this.blobVersionPath(id, ts));
    return decryptBytesFromBlob(this.key, blob, this.blobAad(id, ts));
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
   * 删除条目:先提交「index 摘除」,成功后再 best-effort 删除 items/<id>/ 子目录下全部版本文件。
   * 这样即便 index 上传失败,远端旧 index 仍能指向完整版本文件,不会产生悬空引用。
   */
  async remove(id: string): Promise<{ entries: EntryMeta[]; synced: boolean; syncError?: string }> {
    this.index.entries = this.index.entries.filter((e) => e.id !== id);
    this.cache.clearPending(id);
    const res = await this.persistIndex();
    if (!res.synced) return { entries: this.entries, ...res };

    // index 已提交成功后再清理历史版本文件。幂等;失败不影响已完成的 index 摘除。
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
    return { entries: this.entries, ...res };
  }

  // ---------- 文件夹(仅改 index;本地优先 + 同步) ----------
  get folders(): FolderMeta[] {
    return [...this.index.folders];
  }

  private async persistIndex(): Promise<{ synced: boolean; syncError?: string }> {
    this.bumpRev();
    const env = await encJson(this.key, this.index, this.idxAad());
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
