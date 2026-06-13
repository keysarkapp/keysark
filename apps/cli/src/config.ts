// 云端连接信息:~/.keysark/cloud.json(`ark login` 设备码授权写出 { token, provider, issuer })。
// server 仍按 --server / KEYSARK_SERVER / 内置默认解析,但 token 绑定 issuer(颁发它的 server):
// 解析出的 server 与 issuer 不一致时拒绝发 token,防止把令牌发往错误/恶意服务端。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 归一化 server URL(去尾部斜杠),用于 issuer 绑定比较。 */
export function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

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
  /** 颁发该 token 的 server(归一化 URL)。token 只应发回此 issuer。 */
  issuer?: string;
}

/** 读云端登录态(`ark login` 写出 token/provider/issuer;server 由 env/flag/默认解析)。 */
export function loadCloud(): CloudConn | null {
  try {
    const cfg = JSON.parse(readFileSync(cloudConfigPath(), "utf8")) as Partial<CloudConn>;
    if (typeof cfg.token === "string" && cfg.token) {
      return { token: cfg.token, provider: cfg.provider, issuer: cfg.issuer };
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
  /** 登录态里 token 绑定的 issuer(无登录态 / 旧版无 issuer 则为 null) */
  issuer: string | null;
  /** token 是否可用于当前 baseUrl(必须有 issuer 且匹配;旧版无 issuer 需重新登录) */
  tokenUsableHere: boolean;
}

/** 解析云端连接:--server > KEYSARK_SERVER > 内置默认;token 来自登录态,且绑定 issuer。 */
export function resolveConn(serverOverride?: string): Conn {
  const cloud = loadCloud();
  const baseUrl = normalizeServer(serverOverride ?? process.env.KEYSARK_SERVER ?? "") || defaultServer();
  const issuer = cloud?.issuer ? normalizeServer(cloud.issuer) : null;
  // 旧版 cloud.json 无 issuer 无法证明 token 归属哪个 server → 拒绝发送,要求重新登录。
  const tokenUsableHere = !cloud?.token || (issuer !== null && issuer === baseUrl);
  return {
    baseUrl,
    token: cloud?.token ?? null,
    source: serverOverride ? "--server" : process.env.KEYSARK_SERVER ? "KEYSARK_SERVER" : "default",
    issuer,
    tokenUsableHere,
  };
}
