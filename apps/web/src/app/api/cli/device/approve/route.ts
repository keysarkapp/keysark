import { NextResponse } from "next/server";
import {
  approveCliAuthRequest,
  denyCliAuthRequest,
  getCliAuthRequestByUserCode,
} from "@keysark/db";
import { normalizeUserCode } from "@/lib/cli-auth";
import { getConnectedStorage } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  MAX_CONTROL_BODY_BYTES,
  PayloadTooLargeError,
  readBodyLimited,
  tooLargeResponse,
} from "@/lib/request-limits";

export const runtime = "nodejs";

// 网页授权页的确认/拒绝(表单 POST)。必须有已登录的会话 cookie ——
// 批准即把 CLI 绑定到当前登录的存储账号。完成后跳回 /cli-auth 展示结果。
// CSRF:会话 cookie 均为 SameSite=Lax,跨站表单 POST 不携带 → 天然拒绝。
export async function POST(request: Request) {
  // 防暴力枚举 user_code:每 IP 每分钟最多 30 次确认/拒绝。
  const limited = await enforceRateLimit(request, { bucket: "cli-approve", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // 表单为 application/x-www-form-urlencoded(cli-auth 页);读 body 设小上限后手动解析,
  // 避免 formData() 对超大 body 无限缓冲。
  let form: URLSearchParams;
  try {
    const raw = await readBodyLimited(request, MAX_CONTROL_BODY_BYTES);
    form = new URLSearchParams(new TextDecoder().decode(raw));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return tooLargeResponse(MAX_CONTROL_BODY_BYTES);
    form = new URLSearchParams();
  }
  const code = normalizeUserCode(form.get("code") ?? "");
  const action = form.get("action") ?? "";
  const url = new URL(request.url);
  const back = (result: string) =>
    NextResponse.redirect(
      new URL(`/cli-auth?code=${encodeURIComponent(code ?? "")}&result=${result}`, url.origin),
      { status: 303 },
    );

  if (!code) return back("invalid");

  const conn = await getConnectedStorage();
  if (!conn) return back("login_required");

  try {
    const req = await getCliAuthRequestByUserCode(code);
    if (!req || req.status !== "pending") return back("invalid");

    if (action === "deny") {
      await denyCliAuthRequest(req.id);
      return back("denied");
    }
    const ok = await approveCliAuthRequest(req.id, conn.provider, conn.accountKey);
    return back(ok ? "approved" : "invalid");
  } catch (err) {
    console.error("cli approve failed", err);
    return back("error");
  }
}
