// 可插拔 token 存储。云端(web)= Postgres;桌面/CLI = 本地 JSON 文件。
// 由 KEYSARK_TOKEN_STORE 选择(json → 文件;其余 → postgres)。
// 公开的 storage-accounts 三函数委托到这里,google.ts/baidu.ts 无需感知后端。
import { postgresTokenStore } from "./token-store-postgres";
import { jsonTokenStore } from "./token-store-json";

export interface StorageTokenInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

/** 后端无关的账号记录(消费方只用这些字段)。 */
export interface StorageAccountRecord {
  provider: string;
  accountKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export interface TokenStore {
  get(provider: string, accountKey: string): Promise<StorageAccountRecord | null>;
  upsert(provider: string, accountKey: string, token: StorageTokenInput): Promise<void>;
  update(provider: string, accountKey: string, token: StorageTokenInput): Promise<void>;
  /** 列出某 provider 下的全部账号(本地接口无 cookie 时按唯一账号解析用)。 */
  listByProvider(provider: string): Promise<StorageAccountRecord[]>;
}

let _store: TokenStore | null = null;

export function tokenStore(): TokenStore {
  if (!_store) {
    _store =
      (process.env.KEYSARK_TOKEN_STORE ?? "").toLowerCase() === "json"
        ? jsonTokenStore()
        : postgresTokenStore();
  }
  return _store;
}
