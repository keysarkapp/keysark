// 固定窗口限流。配置 DATABASE_URL 时优先使用 Postgres 共享桶;否则回退进程内内存桶。
// 这用于 CLI 设备码端点等防滥用入口;更高强度的边缘防护仍应叠加 WAF/平台限流。
import { consumeRateLimit } from "@keysark/db";
import { NextResponse } from "next/server";

interface Window {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Window>();

function trustProxyHeaders(): boolean {
  return process.env.VERCEL === "1" || process.env.KEYSARK_TRUST_PROXY_HEADERS === "1";
}

/**
 * 取客户端标识。默认不信任客户端可伪造的 x-forwarded-for/x-real-ip;
 * 仅在受控代理环境(Vercel 或显式 KEYSARK_TRUST_PROXY_HEADERS=1)下使用。
 */
export function clientKey(request: Request): string {
  if (!trustProxyHeaders()) return "unknown";
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** 命中限流返回剩余等待秒数;未命中返回 null。固定窗口。 */
export function rateLimit(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || w.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // 顺手清理过期桶,避免无界增长(低频路径,直接遍历足够)。
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return null;
  }
  if (w.count >= limit) return Math.ceil((w.resetAt - now) / 1000);
  w.count++;
  return null;
}

async function consumeBestEffort(key: string, limit: number, windowMs: number): Promise<number | null> {
  if (process.env.DATABASE_URL) {
    try {
      return await consumeRateLimit(key, limit, windowMs);
    } catch (err) {
      console.error("global rate limit failed; falling back to memory", err);
    }
  }
  return rateLimit(key, limit, windowMs);
}

/** 便捷封装:命中则返回 429 响应,否则 null。 */
export async function enforceRateLimit(
  request: Request,
  opts: { bucket: string; limit: number; windowMs: number },
): Promise<NextResponse | null> {
  const retry = await consumeBestEffort(`${opts.bucket}:${clientKey(request)}`, opts.limit, opts.windowMs);
  if (retry === null) return null;
  return NextResponse.json(
    { error: "rate_limited", retryAfter: retry },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}
