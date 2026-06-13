// ~/.keysark 下本地敏感文件的权限加固:目录 0700、文件 0600。
// 注意:Node 的 writeFileSync({ mode }) 只在「新建」文件时按 mode 创建,
//   已存在文件的旧权限不会被修正 —— 故每次写后显式 chmod,且每次命令启动统一复核一遍。
// Windows 不适用 POSIX 权限位(chmod 在 Win 上只切只读位),整体跳过。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
const POSIX = process.platform !== "win32";

/** 一处无法 chmod 到目标权限的记录(用于拼出给用户照抄的 chmod 命令)。 */
export interface PermFailure {
  path: string;
  mode: number;
}

/** 确保目录存在并(POSIX 下)设为 0700。best-effort:chmod 失败不抛,由启动守卫复核报错。 */
export function ensureSecureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (!POSIX) return;
  try {
    chmodSync(dir, DIR_MODE);
  } catch {
    /* 改不动 → checkSecurePerms 会在下次/本次启动守卫里捕获并提示 */
  }
}

/** 安全写:父目录 0700 → 写文件(新建按 0600)→ 显式修正已有文件权限。 */
export function writeSecureFile(dir: string, path: string, data: string | Uint8Array): void {
  ensureSecureDir(dir);
  writeFileSync(path, data, { mode: FILE_MODE });
  if (POSIX) {
    try {
      chmodSync(path, FILE_MODE);
    } catch {
      /* 同上,启动守卫复核 */
    }
  }
}

/**
 * 统一复核并修正 dir(0700)+ 各 file(0600)的权限。
 * 会真正 chmod;只把「确实改不动」的项作为失败返回(不抛)。dir 不存在则视作无需加固。
 */
export function checkSecurePerms(dir: string, files: string[]): PermFailure[] {
  if (!POSIX) return [];
  const fails: PermFailure[] = [];
  if (existsSync(dir)) {
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      fails.push({ path: dir, mode: DIR_MODE });
    }
  }
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      chmodSync(f, FILE_MODE);
    } catch {
      fails.push({ path: f, mode: FILE_MODE });
    }
  }
  return fails;
}

/** 失败项 → 可直接执行的 chmod 命令(八进制权限,给用户照抄)。 */
export function fixCommands(fails: PermFailure[]): string[] {
  return fails.map((f) => `chmod ${f.mode.toString(8)} ${f.path}`);
}
