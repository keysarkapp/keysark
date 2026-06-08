// 本地 JSON 文件 token 后端(桌面/CLI)。零外部依赖。
// 文件:KEYSARK_TOKEN_FILE 或默认 ~/.keysark/tokens.json。
// 形如 { accounts: [{ provider, accountKey, accessToken, refreshToken, expiresAt(ISO), scope }] }
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StorageAccountRecord, StorageTokenInput, TokenStore } from "./token-store";

interface RawRow {
  provider: string;
  accountKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO
  scope: string;
}

function filePath(): string {
  return process.env.KEYSARK_TOKEN_FILE || join(homedir(), ".keysark", "tokens.json");
}

function readAll(): RawRow[] {
  try {
    const raw = readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as { accounts?: RawRow[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return []; // 文件不存在/损坏:当作空
  }
}

function writeAll(rows: RawRow[]): void {
  const p = filePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ accounts: rows }, null, 2), { mode: 0o600 });
}

function toRecord(r: RawRow): StorageAccountRecord {
  return { ...r, expiresAt: new Date(r.expiresAt) };
}
function toRaw(provider: string, accountKey: string, t: StorageTokenInput): RawRow {
  return {
    provider,
    accountKey,
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: t.expiresAt.toISOString(),
    scope: t.scope,
  };
}

export function jsonTokenStore(): TokenStore {
  return {
    async get(provider, accountKey) {
      const r = readAll().find((x) => x.provider === provider && x.accountKey === accountKey);
      return r ? toRecord(r) : null;
    },
    async upsert(provider, accountKey, token) {
      const rows = readAll().filter((x) => !(x.provider === provider && x.accountKey === accountKey));
      rows.push(toRaw(provider, accountKey, token));
      writeAll(rows);
    },
    async update(provider, accountKey, token) {
      const rows = readAll();
      const i = rows.findIndex((x) => x.provider === provider && x.accountKey === accountKey);
      if (i >= 0) rows[i] = toRaw(provider, accountKey, token);
      writeAll(rows);
    },
    async listByProvider(provider) {
      return readAll()
        .filter((x) => x.provider === provider)
        .map(toRecord);
    },
  };
}
