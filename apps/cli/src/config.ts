// 云端连接信息:~/.keysark/cloud.json(`ark login` 设备码授权写出 { token, provider };
// 不存 server)。server 一律按 --server / KEYSARK_SERVER / 内置默认解析。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// build 时由 scripts/build.mjs 经 esbuild define 注入;tsx 直跑源码未注入 → "dev"。
declare const __KEYSARK_VERSION__: string | undefined;

/** 内置默认云端接口;本地开发用 KEYSARK_SERVER 或 --server 覆盖。 */
export function defaultServer(): string {
  return "https://keysark.com";
}

/** CLI 版本(build 时注入;源码直跑为 "dev")。 */
export function cliVersion(): string {
  return typeof __KEYSARK_VERSION__ === "string" ? __KEYSARK_VERSION__ : "dev";
}

export function keysarkDir(): string {
  return process.env.KEYSARK_HOME || join(homedir(), ".keysark");
}

export function cloudConfigPath(): string {
  return join(keysarkDir(), "cloud.json");
}

export interface CloudConn {
  token: string;
  provider?: string;
}

/** 读云端登录态(`ark login` 写出,只存 token/provider;server 由 env/flag/默认解析)。 */
export function loadCloud(): CloudConn | null {
  try {
    const cfg = JSON.parse(readFileSync(cloudConfigPath(), "utf8")) as Partial<CloudConn>;
    if (typeof cfg.token === "string" && cfg.token) {
      return { token: cfg.token, provider: cfg.provider };
    }
  } catch {
    /* 无 cloud.json */
  }
  return null;
}

export function saveCloud(c: CloudConn): void {
  mkdirSync(keysarkDir(), { recursive: true });
  writeFileSync(cloudConfigPath(), JSON.stringify(c), { mode: 0o600 });
}

export function clearCloud(): void {
  rmSync(cloudConfigPath(), { force: true });
}

export interface Conn {
  baseUrl: string;
  token: string | null;
  /** baseUrl 的来源(info / 报错提示用) */
  source: "--server" | "KEYSARK_SERVER" | "default";
}

/** 解析云端连接:--server > KEYSARK_SERVER > 内置默认;token 来自登录态(与 server 解耦)。 */
export function resolveConn(serverOverride?: string): Conn {
  const cloud = loadCloud();
  const override = (serverOverride ?? process.env.KEYSARK_SERVER ?? "").replace(/\/+$/, "");
  return {
    baseUrl: override || defaultServer(),
    token: cloud?.token ?? null,
    source: serverOverride ? "--server" : override ? "KEYSARK_SERVER" : "default",
  };
}
