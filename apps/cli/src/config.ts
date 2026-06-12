// 云端连接信息:~/.keysark/cloud.json(`ark login` 设备码授权写出 { server, token, provider })。
// CLI 是完全独立的程序,直连云端 web 接口;--server / KEYSARK_SERVER 可覆盖服务器地址。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// build 时由 scripts/build.mjs 经 esbuild define 注入(生产 https://keysark.com,
// 否则 http://localhost:6134);tsx 直跑源码未注入 → 回退本地 dev 端口。
declare const __KEYSARK_DEFAULT_SERVER__: string | undefined;
declare const __KEYSARK_VERSION__: string | undefined;

/** 内置默认云端接口(build 时按环境注入)。 */
export function defaultServer(): string {
  return typeof __KEYSARK_DEFAULT_SERVER__ === "string"
    ? __KEYSARK_DEFAULT_SERVER__
    : "http://localhost:6134";
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
  server: string;
  token: string;
  provider?: string;
}

/** 读云端登录态(`ark login` 写出);没有/损坏返回 null。 */
export function loadCloud(): CloudConn | null {
  try {
    const cfg = JSON.parse(readFileSync(cloudConfigPath(), "utf8")) as Partial<CloudConn>;
    if (typeof cfg.server === "string" && cfg.server && typeof cfg.token === "string" && cfg.token) {
      return { server: cfg.server, token: cfg.token, provider: cfg.provider };
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
  source: "--server" | "KEYSARK_SERVER" | "cloud.json" | "default";
}

/** 解析云端连接:--server / KEYSARK_SERVER > 登录态 cloud.json > 内置默认;未登录 token 为 null。 */
export function resolveConn(serverOverride?: string): Conn {
  const cloud = loadCloud();
  const override = (serverOverride ?? process.env.KEYSARK_SERVER ?? "").replace(/\/+$/, "");
  if (override) {
    return {
      baseUrl: override,
      token: cloud && cloud.server === override ? cloud.token : null,
      source: serverOverride ? "--server" : "KEYSARK_SERVER",
    };
  }
  if (cloud) return { baseUrl: cloud.server, token: cloud.token, source: "cloud.json" };
  return { baseUrl: defaultServer(), token: null, source: "default" };
}
