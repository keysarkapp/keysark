// 桌面 sidecar 启动器:由 Tauri(Rust)拉起。
// 职责:定端口 → 生成本地接口 token → 配好环境 → 写 ~/.keysark/local.json → 起 Next.js standalone。
//
// 端口优先级:desktop.json.port > KEYSARK_LOCAL_PORT > DEFAULT_LOCAL_PORT(35291)。
// 本地接口绑 127.0.0.1(loopback only)。token 仅护「密文中转端点」,绝不经手明文/密钥。
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOCAL_PORT,
  desktopConfigPath,
  keysarkDir,
  localConfigPath,
  tokensPath,
} from "./paths.mjs";

function resolvePort() {
  try {
    const cfg = JSON.parse(readFileSync(desktopConfigPath(), "utf8"));
    if (Number.isInteger(cfg.port) && cfg.port > 0) return cfg.port;
  } catch {
    /* 无配置 → 看环境变量/默认 */
  }
  const envPort = Number(process.env.KEYSARK_LOCAL_PORT);
  return Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_LOCAL_PORT;
}

function main() {
  const port = resolvePort();
  const host = "127.0.0.1";
  const token = randomBytes(24).toString("hex");

  mkdirSync(keysarkDir(), { recursive: true });
  // 供 CLI 读取:端口 + 本地接口 token。
  writeFileSync(localConfigPath(), JSON.stringify({ port, token }, null, 2), { mode: 0o600 });

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: host, // Next standalone 绑 loopback
    KEYSARK_TOKEN_STORE: "json",
    KEYSARK_TOKEN_FILE: tokensPath(),
    KEYSARK_LOCAL_TOKEN: token, // 本地接口鉴权(校验 x-keysark-token)
    KEYSARK_LOCAL_AUTH: "1",
    KEYSARK_DESKTOP: "1", // 落地页隐藏百度入口(v1 仅 Google)
    // Google「桌面应用」客户端:loopback 任意端口被接受,无需逐端口登记。
    GOOGLE_REDIRECT_URI: `http://${host}:${port}/api/google/callback`,
  };

  // Next standalone(monorepo)产物入口:bundle-sidecar 把 standalone 拷到 launcher 同级,
  // server.js 落在 apps/web/server.js。
  const serverEntry =
    process.env.KEYSARK_SERVER_ENTRY || join(import.meta.dirname, "apps", "web", "server.js");
  const child = spawn(process.execPath, [serverEntry], { env, stdio: "inherit" });

  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));

  // 让父进程(Tauri)能从 stdout 抓到就绪端口。
  console.log(`[keysark-sidecar] listening on http://${host}:${port}`);
}

main();
