// 请求体体积硬限制:防止超大上传把整包读进内存造成内存/网盘写入成本 DoS。
// 前端限制明文 100MB;服务端这里对「请求体字节」设独立硬上限(含信封/base64 膨胀冗余)。
import { NextResponse } from "next/server";

/** 请求体硬上限:150MB。覆盖 100MB 明文 + base64(~1.33x)/信封开销。 */
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

/** 控制类小请求(CLI 授权码/确认表单等)的 body 上限:16KB,远超合法负载。 */
export const MAX_CONTROL_BODY_BYTES = 16 * 1024;

/** 用 Content-Length 头早拒(行为良好的客户端无需读 body)。超限返回 413,否则 null。 */
export function rejectIfTooLargeByHeader(request: Request, max = MAX_UPLOAD_BYTES): NextResponse | null {
  const len = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > max) {
    return NextResponse.json({ error: "payload_too_large", max }, { status: 413 });
  }
  return null;
}

/**
 * 流式读取请求体并在超过上限时中止(真正的防护:不信任 Content-Length)。
 * 返回字节;超限抛 PayloadTooLargeError(调用方转 413)。
 */
export class PayloadTooLargeError extends Error {
  constructor() {
    super("payload too large");
    this.name = "PayloadTooLargeError";
  }
}

export async function readBodyLimited(request: Request, max = MAX_UPLOAD_BYTES): Promise<Uint8Array> {
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** PayloadTooLargeError → 413 响应;其它错误重新抛出。 */
export function tooLargeResponse(max = MAX_UPLOAD_BYTES): NextResponse {
  return NextResponse.json({ error: "payload_too_large", max }, { status: 413 });
}
