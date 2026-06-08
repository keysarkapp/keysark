// 本地密文缓存的通用实现。把整份缓存(密文信封 base64 + pending 标记)序列化为一个
// JSON 字符串,存进注入的 KvStore 的单个 key。浏览器用 localStorage 适配 KvStore,
// CLI 用文件 / 内存适配 —— 缓存逻辑本身环境无关。
import type { CacheStore } from "./types";

/** 极简键值后端:只需对单个字符串值 get/set(localStorage / 文件 / 内存均可适配)。 */
export interface KvStore {
  get(key: string): string | null;
  set(key: string, val: string): void;
}

interface CacheShape {
  index: string | null;
  entries: Record<string, string>;
  pending: string[]; // 待同步条目 id
  indexPending: boolean;
}

function emptyCache(): CacheShape {
  return { index: null, entries: {}, pending: [], indexPending: false };
}

const NS_PREFIX = "keysark.vault.v1";

/** 为某保险库(按 id)建一份独立缓存,底层落在注入的 KvStore。 */
export function makeCache(kv: KvStore, vaultId: string): CacheStore {
  const ns = `${NS_PREFIX}::${vaultId}`;
  function read(): CacheShape {
    try {
      const raw = kv.get(ns);
      if (!raw) return emptyCache();
      return { ...emptyCache(), ...(JSON.parse(raw) as Partial<CacheShape>) };
    } catch {
      return emptyCache();
    }
  }
  function write(c: CacheShape): void {
    try {
      kv.set(ns, JSON.stringify(c));
    } catch {
      /* 配额/隐私模式/磁盘失败:本地缓存只是镜像,忽略写失败 */
    }
  }
  return {
    getIndex() {
      return read().index;
    },
    setIndex(b64, pending) {
      const c = read();
      c.index = b64;
      c.indexPending = pending;
      write(c);
    },
    getEntry(id) {
      return read().entries[id] ?? null;
    },
    setEntry(id, b64, pending) {
      const c = read();
      c.entries[id] = b64;
      if (pending && !c.pending.includes(id)) c.pending.push(id);
      if (!pending) c.pending = c.pending.filter((x) => x !== id);
      write(c);
    },
    clearPending(id) {
      const c = read();
      c.pending = c.pending.filter((x) => x !== id);
      write(c);
    },
    clearIndexPending() {
      const c = read();
      c.indexPending = false;
      write(c);
    },
    pendingCount() {
      const c = read();
      return c.pending.length + (c.indexPending ? 1 : 0);
    },
    pendingEntries() {
      return [...read().pending];
    },
    indexPending() {
      return read().indexPending;
    },
  };
}

/** 不落盘的内存缓存(CLI / 测试用)。 */
export function memoryKv(): KvStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
    },
  };
}
