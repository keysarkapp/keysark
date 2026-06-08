// 存储后端授权 token 的读写。按 (provider, accountKey) 存。
// 实际落地由可插拔后端决定(Postgres / 本地 JSON),见 token-store.ts。
import { tokenStore } from "./token-store";
import type { StorageAccountRecord, StorageTokenInput } from "./token-store";

export type { StorageTokenInput } from "./token-store";
/** 后端无关的账号记录(消费方只用这些字段)。 */
export type StorageAccount = StorageAccountRecord;

export async function getStorageAccount(
  provider: string,
  accountKey: string,
): Promise<StorageAccount | null> {
  return tokenStore().get(provider, accountKey);
}

/** 首次授权 / 重新授权落库,按 (provider, accountKey) 去重。 */
export async function upsertStorageAccount(
  provider: string,
  accountKey: string,
  token: StorageTokenInput,
): Promise<void> {
  await tokenStore().upsert(provider, accountKey, token);
}

/** access_token 刷新后更新存量记录。 */
export async function updateStorageTokens(
  provider: string,
  accountKey: string,
  token: StorageTokenInput,
): Promise<void> {
  await tokenStore().update(provider, accountKey, token);
}

/** 列出某 provider 下全部账号(本地接口无 cookie 时按唯一账号解析)。 */
export async function listStorageAccounts(provider: string): Promise<StorageAccount[]> {
  return tokenStore().listByProvider(provider);
}
