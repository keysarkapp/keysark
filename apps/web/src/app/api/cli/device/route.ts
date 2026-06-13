import { NextResponse } from "next/server";
import { createCliAuthRequest } from "@keysark/db";
import {
  DEVICE_EXPIRES_IN,
  DEVICE_POLL_INTERVAL,
  generateDeviceCode,
  generateUserCode,
  sha256Hex,
} from "@/lib/cli-auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// CLI 发起设备码授权:生成 device_code(给 CLI 轮询)+ user_code(给人核对),
// 返回网页授权链接。无需登录态 —— 授权动作发生在网页侧。
export async function POST(request: Request) {
  // 防刷码:每 IP 每分钟最多 10 次发起。
  const limited = await enforceRateLimit(request, { bucket: "cli-device", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  try {
    await createCliAuthRequest({
      deviceCodeHash: sha256Hex(deviceCode),
      userCode,
      expiresAt: new Date(Date.now() + DEVICE_EXPIRES_IN * 1000),
    });
  } catch (err) {
    console.error("cli device create failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_url: `${origin}/cli-auth?code=${encodeURIComponent(userCode)}`,
    interval: DEVICE_POLL_INTERVAL,
    expires_in: DEVICE_EXPIRES_IN,
  });
}
