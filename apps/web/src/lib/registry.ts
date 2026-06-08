// 保险库注册表(keysark.json)浏览器适配层。类型/常量来自 @keysark/vault;
// saveRegistry 注入浏览器 transport(fetch /api/files)。
//
// E2E:注册表只含「非敏感元数据(label)+ 密文校验块(verifier)」;
// 主密钥、助记词、明文条目绝不出现在此文件。
import { saveRegistry as saveRegistryWith, type Registry } from "@keysark/vault";
import { browserTransport } from "./vault";

export {
  REGISTRY_NAME,
  LEGACY_META_NAME,
  LEGACY_VAULT_ID,
  vaultDir,
  b64encode,
  b64decode,
  type VaultDescriptor,
  type Registry,
} from "@keysark/vault";

/** 写注册表到网盘(覆盖),经浏览器 transport。仅在浏览器调用。 */
export async function saveRegistry(reg: Registry): Promise<void> {
  await saveRegistryWith(browserTransport, reg);
}
