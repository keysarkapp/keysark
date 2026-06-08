import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Postgres 连接惰性创建:只有真正用到 postgres token 后端时才连。
// 桌面/CLI 走 JSON 文件后端(KEYSARK_TOKEN_STORE=json),不应在 import 时强求 DATABASE_URL。
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = drizzle(postgres(url, { prepare: false }), { schema });
  }
  return _db;
}

export { schema };
