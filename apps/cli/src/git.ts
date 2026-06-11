// git origin → 保险库文件夹路径:去协议/用户/端口/.git,得到 "host/owner/repo" 形式。
import { execFileSync } from "node:child_process";

/** 解析 origin url 为文件夹路径。https/ssh/scp-like/本地路径均可;解析不出返回 null。 */
export function originToPath(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  let host: string | null = null;
  let p: string;
  // scheme 形式:proto://[user@]host[:port]/path
  const m = /^[a-zA-Z][\w+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.*)$/.exec(u);
  if (m) {
    host = m[1]!;
    p = m[2]!;
  } else {
    // scp 形式:[user@]host:path
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(u);
    if (scp) {
      host = scp[1]!;
      p = scp[2]!;
    } else {
      p = u; // 本地路径 origin
    }
  }
  p = p.replace(/\.git\/?$/, "").replace(/^\/+|\/+$/g, "");
  const joined = host ? (p ? `${host}/${p}` : host) : p;
  return joined || null;
}

/** 取某目录所在 git 仓库的 origin 文件夹路径与仓库根;无仓库/无 origin 返回 null。 */
export function gitContext(dir: string): { originPath: string; repoRoot: string } | null {
  const run = (...argv: string[]): string =>
    execFileSync("git", ["-C", dir, ...argv], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  try {
    const repoRoot = run("rev-parse", "--show-toplevel");
    const originPath = originToPath(run("remote", "get-url", "origin"));
    return originPath ? { originPath, repoRoot } : null;
  } catch {
    return null;
  }
}
