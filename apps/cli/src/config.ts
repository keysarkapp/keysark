// 本地接口连接信息:默认从 ~/.keysark/local.json(桌面写出)读 { port, token };
// KEYSARK_PORT / --port 覆盖端口。缺失则回退默认端口并提示桌面可能未运行。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_LOCAL_PORT = 35291;

export function keysarkDir(): string {
  return process.env.KEYSARK_HOME || join(homedir(), ".keysark");
}
export function localConfigPath(): string {
  return join(keysarkDir(), "local.json");
}

export interface LocalConn {
  baseUrl: string;
  token: string | null;
  desktopRunning: boolean;
}

/** 解析本地接口连接。portOverride 来自 --port/KEYSARK_PORT。 */
export function resolveConn(portOverride?: number): LocalConn {
  let port = DEFAULT_LOCAL_PORT;
  let token: string | null = null;
  let desktopRunning = false;
  try {
    const cfg = JSON.parse(readFileSync(localConfigPath(), "utf8")) as {
      port?: number;
      token?: string;
    };
    if (Number.isInteger(cfg.port) && cfg.port! > 0) port = cfg.port!;
    if (typeof cfg.token === "string") token = cfg.token;
    desktopRunning = true; // 文件在 → 桌面至少启动过
  } catch {
    /* 无 local.json → 回退默认端口 */
  }
  const envPort = Number(process.env.KEYSARK_PORT);
  if (Number.isInteger(envPort) && envPort > 0) port = envPort;
  if (portOverride && portOverride > 0) port = portOverride;
  return { baseUrl: `http://127.0.0.1:${port}`, token, desktopRunning };
}
