export {
  INDEX_NAME,
  ITEMS_DIR,
  REGISTRY_NAME,
  LEGACY_META_NAME,
  LEGACY_VAULT_ID,
  joinPath,
  itemRelPath,
  itemBlobRelPath,
  vaultDir,
  b64encode,
  b64decode,
  type FolderMeta,
  type EntryMeta,
  type VersionMeta,
  type EntryKind,
  type IndexDoc,
  type EntryDoc,
  type VaultDescriptor,
  type Registry,
  type StorageTransport,
  type CacheStore,
} from "./types";
export { makeCache, memoryKv, type KvStore } from "./cache";
export { Vault, saveRegistry } from "./vault";
export { SERVICE_PROVIDERS, providerById, providerForHost, type ServiceProvider } from "./providers";
