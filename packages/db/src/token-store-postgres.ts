// Postgres token 后端(web/云端)。沿用原 Drizzle 逻辑,connection 惰性。
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { storageAccount } from "./schema";
import type { StorageAccountRecord, StorageTokenInput, TokenStore } from "./token-store";

function toRecord(row: typeof storageAccount.$inferSelect): StorageAccountRecord {
  return {
    provider: row.provider,
    accountKey: row.accountKey,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    scope: row.scope,
  };
}

export function postgresTokenStore(): TokenStore {
  return {
    async get(provider, accountKey) {
      const rows = await getDb()
        .select()
        .from(storageAccount)
        .where(
          and(eq(storageAccount.provider, provider), eq(storageAccount.accountKey, accountKey)),
        )
        .limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async upsert(provider, accountKey, token) {
      await getDb()
        .insert(storageAccount)
        .values({ provider, accountKey, ...token })
        .onConflictDoUpdate({
          target: [storageAccount.provider, storageAccount.accountKey],
          set: { ...token, updatedAt: new Date() },
        });
    },
    async update(provider, accountKey, token) {
      await getDb()
        .update(storageAccount)
        .set({ ...token, updatedAt: new Date() })
        .where(
          and(eq(storageAccount.provider, provider), eq(storageAccount.accountKey, accountKey)),
        );
    },
    async listByProvider(provider) {
      const rows = await getDb()
        .select()
        .from(storageAccount)
        .where(eq(storageAccount.provider, provider));
      return rows.map(toRecord);
    },
  };
}
