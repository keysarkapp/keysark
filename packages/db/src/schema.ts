import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { newId } from "./id";

// 存储后端授权 token,按 (provider, accountKey) 存。
// provider: "baidu"(accountKey=百度 uk)| "google"(accountKey=Google sub)。
// access/refresh token 字段在应用层信封加密后落库(KEYSARK_DB_ENCRYPTION_KEY,见 secret-box.ts);
// 未配置主密钥时回退明文(仅开发态)。
export const storageAccount = pgTable(
  "storage_account",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    provider: text("provider").notNull(),
    accountKey: text("account_key").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scope: text("scope").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("storage_account_provider_account").on(t.provider, t.accountKey)],
);

// ---------- CLI 设备码授权(device-code flow,仅云端 Postgres 模式) ----------
// CLI 发起授权请求 → 用户在已登录的网页上核对 user_code 并确认 →
// CLI 轮询用 device_code 换长期 cli_token。两张表都只存码/令牌的 SHA-256,不存明文。

/** 短命授权请求(10 分钟过期,创建时顺手清理过期行)。 */
export const cliAuthRequest = pgTable("cli_auth_request", {
  id: text("id").primaryKey().$defaultFn(newId),
  /** device_code 的 SHA-256 hex。device_code 只在 CLI 与服务端之间流转。 */
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  /** 人类可读核对码(如 ABCD-1234),展示在 CLI 与网页两侧供肉眼核对。 */
  userCode: text("user_code").notNull().unique(),
  /** pending → approved(网页确认)→ consumed(CLI 已取走 token);或 denied。 */
  status: text("status").notNull().default("pending"),
  provider: text("provider"),
  accountKey: text("account_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** CLI 长期访问令牌:权限等价一份浏览器登录态(只搬运密文),可吊销、有过期。 */
export const cliToken = pgTable("cli_token", {
  id: text("id").primaryKey().$defaultFn(newId),
  /** 令牌明文只在颁发响应里出现一次;库里只存 SHA-256 hex。 */
  tokenHash: text("token_hash").notNull().unique(),
  provider: text("provider").notNull(),
  accountKey: text("account_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  /** 过期时间(颁发时设定);超过即失效,与 revokedAt 一起决定可用性。
   *  DB 默认 now()+90d:让历史行在 db:push 时安全回填,并兜底任何未显式赋值的插入。 */
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '90 days'`),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** 全局固定窗口限流桶。用于多实例/serverless 下共享 CLI 授权端点限额。 */
export const rateLimitBucket = pgTable("rate_limit_bucket", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
