import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { rateLimitBucket } from "./schema";

interface RateLimitRow extends Record<string, unknown> {
  count: number;
  resetAt: Date;
}

/** Postgres 共享固定窗口限流。命中限流返回等待秒数;未命中返回 null。 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<number | null> {
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await getDb().execute<RateLimitRow>(sql`
    insert into ${rateLimitBucket}
      (${rateLimitBucket.bucketKey}, ${rateLimitBucket.count}, ${rateLimitBucket.resetAt})
    values (${key}, 1, ${resetAt})
    on conflict (${rateLimitBucket.bucketKey}) do update set
      ${rateLimitBucket.count} = case
        when ${rateLimitBucket.resetAt} <= ${now} then 1
        else ${rateLimitBucket.count} + 1
      end,
      ${rateLimitBucket.resetAt} = case
        when ${rateLimitBucket.resetAt} <= ${now} then ${resetAt}
        else ${rateLimitBucket.resetAt}
      end
    returning
      ${rateLimitBucket.count} as "count",
      ${rateLimitBucket.resetAt} as "resetAt"
  `);
  const row = rows[0];
  if (!row || row.count <= limit) return null;
  return Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
}
