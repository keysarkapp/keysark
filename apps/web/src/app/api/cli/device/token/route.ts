import { NextResponse } from "next/server";
import {
  consumeCliAuthRequest,
  createCliToken,
  getCliAuthRequestByDeviceHash,
} from "@keysark/db";
import { generateCliToken, sha256Hex } from "@/lib/cli-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  MAX_CONTROL_BODY_BYTES,
  PayloadTooLargeError,
  readBodyLimited,
  tooLargeResponse,
} from "@/lib/request-limits";

export const runtime = "nodejs";

// CLI 轮询:device_code 换令牌。approved → 原子消费、颁发一次性明文令牌;
// pending → 继续等;不存在/已消费/过期 → 终止轮询。
export async function POST(request: Request) {
  // 合法轮询约 20 次/分钟;留宽到 120/分钟,挡住高频暴力枚举 device_code。
  const limited = await enforceRateLimit(request, { bucket: "cli-poll", limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  let deviceCode = "";
  try {
    const raw = await readBodyLimited(request, MAX_CONTROL_BODY_BYTES);
    const body = JSON.parse(new TextDecoder().decode(raw)) as { device_code?: string };
    deviceCode = (body.device_code ?? "").trim();
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return tooLargeResponse(MAX_CONTROL_BODY_BYTES);
    /* JSON 解析失败 → 落到下面 400 */
  }
  if (!deviceCode) return NextResponse.json({ error: "device_code_required" }, { status: 400 });

  try {
    const req = await getCliAuthRequestByDeviceHash(sha256Hex(deviceCode));
    if (!req) return NextResponse.json({ status: "expired" }, { status: 400 });
    if (req.status === "pending") return NextResponse.json({ status: "pending" });
    if (req.status === "denied") return NextResponse.json({ status: "denied" }, { status: 403 });
    if (req.status !== "approved" || !req.provider || !req.accountKey) {
      // consumed 或脏数据:令牌只发一次,重复轮询视为过期。
      return NextResponse.json({ status: "expired" }, { status: 400 });
    }

    // 并发轮询只有一个赢家;输家拿 expired(令牌绝不二次下发)。
    const consumed = await consumeCliAuthRequest(req.id);
    if (!consumed) return NextResponse.json({ status: "expired" }, { status: 400 });

    const token = generateCliToken();
    await createCliToken({
      tokenHash: sha256Hex(token),
      provider: req.provider,
      accountKey: req.accountKey,
    });
    return NextResponse.json({ status: "approved", token, provider: req.provider });
  } catch (err) {
    console.error("cli device token failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
