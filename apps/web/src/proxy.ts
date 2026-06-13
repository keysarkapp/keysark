// 安全响应头 + 严格 CSP。vault 场景下主密钥/明文只在浏览器内存,一旦 XSS 后果严重,
// 因此用尽量严格的 CSP 收紧脚本来源与数据外泄面。
//
// CSP 策略:
//   - 生产:nonce + strict-dynamic(只信任带 nonce 的脚本及其动态加载链),禁 inline。
//     Next 会自动给自身脚本注入这里下发的 nonce(经请求头传入)。
//   - 开发:HMR 需要 inline/eval,放宽为 'unsafe-inline' 'unsafe-eval'(nonce 在 dev 不启用)。
//   - 始终:wasm-unsafe-eval(Argon2id 走 hash-wasm)、object/base/frame-ancestors 收死。
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProd = process.env.NODE_ENV === "production";

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`
    : `'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:`;
  const connectSrc = isProd ? "'self'" : "'self' ws: wss:";

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind/Next 注入 inline style;nonce 化不现实
    `img-src 'self' data: blob: https:`, // google/baidu 头像走 https
    `font-src 'self' data:`,
    `connect-src ${connectSrc}`,
    `worker-src 'self' blob:`, // pdf.js worker
    `object-src 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `frame-src 'none'`,
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  // 把 nonce 经请求头传入,Next 据此给自身脚本打 nonce。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  res.headers.set("content-security-policy", csp);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("x-dns-prefetch-control", "off");
  res.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );
  if (isProd) {
    res.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return res;
}

// 跳过静态资源与图片优化(它们不需要 CSP 文档头,且避免无谓开销)。
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
