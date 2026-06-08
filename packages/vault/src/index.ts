export {
  INDEX_NAME,
  ITEMS_DIR,
  REGISTRY_NAME,
  LEGACY_META_NAME,
  LEGACY_VAULT_ID,
  joinPath,
  itemRelPath,
  vaultDir,
  b64encode,
  b64decode,
  type FolderMeta,
  type EntryMeta,
  type IndexDoc,
  type EntryDoc,
  type VaultDescriptor,
  type Registry,
  type StorageTransport,
  type CacheStore,
} from "./types";
export { makeCache, memoryKv, type KvStore } from "./cache";
export { Vault, saveRegistry } from "./vault";
