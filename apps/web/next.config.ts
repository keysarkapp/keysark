import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// 注入应用版本号 + 构建所用的 git 提交与仓库地址。导出助记词 PDF/HTML 时一并标注,
// 让用户/审计者能据此检出「生成这份备份的确切源码」核对端到端加密实现。
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version?: string;
  repository?: string | { url?: string };
};

/** 归一化仓库地址为可点击的 https 形式:git@github.com:org/repo.git → https://github.com/org/repo */
function normalizeRepo(raw: string): string {
  let s = raw.replace(/^git\+/, "").trim();
  const ssh = s.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  s = s.replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "");
  return s;
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

/** 构建所用提交短哈希;工作区有未提交改动时附 `-dirty`。无 git 时降级 "unknown",绝不让构建失败。 */
function gitCommit(): string {
  // 平台/CI 优先(从 tarball 或浅克隆构建时 git 命令可能不可用)。
  const fromEnv =
    process.env.KEYSARK_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    const sha = git("rev-parse --short=12 HEAD");
    if (!sha) return "unknown";
    let dirty = "";
    try {
      if (git("status --porcelain")) dirty = "-dirty";
    } catch {
      /* 忽略 */
    }
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

/** 仓库地址:env > Vercel owner/slug > package.json#repository > git origin > 空。 */
function repoUrl(): string {
  if (process.env.KEYSARK_REPO) return normalizeRepo(process.env.KEYSARK_REPO);
  const { VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: slug } = process.env;
  if (owner && slug) return `https://github.com/${owner}/${slug}`;
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repo) return normalizeRepo(repo);
  try {
    const remote = git("config --get remote.origin.url");
    if (remote) return normalizeRepo(remote);
  } catch {
    /* 忽略 */
  }
  return "";
}

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_KEYSARK_VERSION: pkg.version ?? "0.0.0",
    NEXT_PUBLIC_KEYSARK_COMMIT: gitCommit(),
    NEXT_PUBLIC_KEYSARK_REPO: repoUrl(),
  },
  transpilePackages: [
    "@keysark/ui",
    "@keysark/db",
    "@keysark/baidupan",
    "@keysark/googledrive",
    "@keysark/crypto",
    "@keysark/vault",
  ],
  typedRoutes: true,
};

export default config;
