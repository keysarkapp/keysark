// 读注册表(keysark.json)、按 verifier 把派生密钥匹配到保险库。
// 兼容历史单库(无注册表但有 .keysark.json → dir="" 的 legacy 库)。
import { checkVerifier } from "@keysark/crypto";
import {
  LEGACY_META_NAME,
  LEGACY_VAULT_ID,
  REGISTRY_NAME,
  Vault,
  b64decode,
  b64encode,
  makeCache,
  memoryKv,
  type StorageTransport,
  type VaultDescriptor,
} from "@keysark/vault";

const decoder = new TextDecoder();

/** 拉取注册表里的保险库列表(含历史单库迁移)。 */
export async function fetchVaults(transport: StorageTransport): Promise<VaultDescriptor[]> {
  const root = await transport.list("");
  const reg = root.get(REGISTRY_NAME);
  if (reg) {
    const bytes = await transport.download(reg.id);
    const parsed = JSON.parse(decoder.decode(bytes)) as { vaults?: VaultDescriptor[] };
    return Array.isArray(parsed.vaults) ? parsed.vaults : [];
  }
  const legacy = root.get(LEGACY_META_NAME);
  if (legacy) {
    const bytes = await transport.download(legacy.id);
    return [{ id: LEGACY_VAULT_ID, label: "", dir: "", verifier: b64encode(bytes), createdAt: 0 }];
  }
  return [];
}

/** 在保险库里挑出与密钥匹配的那个;--vault 可按 id/label 先过滤。 */
export async function pickVault(
  vaults: VaultDescriptor[],
  key: CryptoKey,
  vaultSel?: string,
): Promise<VaultDescriptor | null> {
  const candidates = vaultSel
    ? vaults.filter((v) => v.id === vaultSel || v.label === vaultSel)
    : vaults;
  for (const v of candidates) {
    if (await checkVerifier(key, b64decode(v.verifier))) return v;
  }
  return null;
}

export function openVault(
  key: CryptoKey,
  descriptor: VaultDescriptor,
  transport: StorageTransport,
): Vault {
  // CLI 进程短命:用内存缓存,每次从网盘读最新,避免陈旧。
  return new Vault(key, { dir: descriptor.dir }, transport, makeCache(memoryKv(), descriptor.id));
}
