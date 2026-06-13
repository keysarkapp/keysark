// OS keystore 接入:解锁缓存用的 device key(32 字节随机)存进操作系统的安全存储,
// 而非 ~/.keysark 下的明文文件,使「整目录拷贝」不再能拿到该 key。
//   - macOS  : 登录钥匙串(security generic-password,受登录密码保护)。
//   - Linux  : Secret Service / libsecret(secret-tool;GNOME Keyring、KWallet 等)。
//   - Windows: DPAPI(ProtectedData,CurrentUser 绑定;受保护 blob 仍落盘但仅本用户可解)。
//   - 其它/工具缺失:回退到原 0600 文件(行为不变),由调用方告警一次。
// 零原生依赖:只 shell out 到各 OS 自带 CLI。device key 本身不是秘密(只护 15 分钟缓存),
// 但把它移出 ~/.keysark 才能让「拷目录」失效——这正是接入的目的。
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const SERVICE = "keysark";
const ACCOUNT = "device-key"; // 钥匙串/Secret Service 里的条目名
const KEY_LEN = 32;

export type KeystoreBackend = "keychain" | "secret-service" | "dpapi" | "file";

/** 后端工具不存在(spawn ENOENT)时抛此错 → 调用方回退到文件。 */
class KeystoreUnavailable extends Error {}

interface Backend {
  name: KeystoreBackend;
  /** 命中返回 32 字节 key;不存在返回 null;工具缺失抛 KeystoreUnavailable。 */
  get(): Buffer | null;
  set(key: Buffer): void;
  remove(): void;
}

/** execFileSync 包装:ENOENT(工具缺失)→ KeystoreUnavailable;其它非零退出 → 原样抛。 */
function run(cmd: string, args: string[], opts: { input?: Buffer; env?: NodeJS.ProcessEnv } = {}): Buffer {
  try {
    return execFileSync(cmd, args, {
      input: opts.input,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "ignore"], // 吞掉 stderr,避免污染输出
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new KeystoreUnavailable(cmd);
    throw e;
  }
}

// ---------- macOS 登录钥匙串 ----------
const macKeychain: Backend = {
  name: "keychain",
  get() {
    try {
      const out = run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      const key = Buffer.from(out.toString("utf8").trim(), "base64");
      return key.length === KEY_LEN ? key : null;
    } catch (e) {
      if (e instanceof KeystoreUnavailable) throw e;
      return null; // 退出码 44 = item not found
    }
  },
  set(key) {
    // -U:已存在则更新。-w 取值走 stdin(避免 base64 出现在 argv / ps 里)。
    run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", key.toString("base64")]);
  },
  remove() {
    try {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    } catch (e) {
      if (e instanceof KeystoreUnavailable) throw e;
      /* 不存在即无需删 */
    }
  },
};

// ---------- Linux Secret Service (libsecret) ----------
const linuxSecretService: Backend = {
  name: "secret-service",
  get() {
    try {
      const out = run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
      const s = out.toString("utf8").trim();
      if (!s) return null;
      const key = Buffer.from(s, "base64");
      return key.length === KEY_LEN ? key : null;
    } catch (e) {
      if (e instanceof KeystoreUnavailable) throw e;
      return null; // lookup 未命中 → 非零退出
    }
  },
  set(key) {
    // secret-tool store 从 stdin 读 secret(非 TTY 时不回显提示)。
    run("secret-tool", ["store", "--label=keysark device key", "service", SERVICE, "account", ACCOUNT], {
      input: Buffer.from(key.toString("base64"), "utf8"),
    });
  },
  remove() {
    try {
      run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
    } catch (e) {
      if (e instanceof KeystoreUnavailable) throw e;
    }
  },
};

// ---------- Windows DPAPI(受保护 blob 落盘,绑定当前用户) ----------
// 没有合适的纯 CLI 存储,故用 PowerShell ProtectedData 加密后写 device.key.dpapi。
// blob 仍在 ~/.keysark,但只有同一 Windows 用户能 Unprotect → 拷到别处/别人解不开。
function winDpapi(blobPath: string): Backend {
  const ps = (script: string, env: NodeJS.ProcessEnv) =>
    run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env }).toString("utf8").trim();
  return {
    name: "dpapi",
    get() {
      if (!existsSync(blobPath)) return null;
      const blob = readFileSync(blobPath, "utf8").trim();
      if (!blob) return null;
      const b64 = ps(
        "Add-Type -AssemblyName System.Security;" +
          "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect(" +
          "[Convert]::FromBase64String($env:KS_BLOB),$null,'CurrentUser'))",
        { ...process.env, KS_BLOB: blob },
      );
      const key = Buffer.from(b64, "base64");
      return key.length === KEY_LEN ? key : null;
    },
    set(key) {
      const blob = ps(
        "Add-Type -AssemblyName System.Security;" +
          "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect(" +
          "[Convert]::FromBase64String($env:KS_KEY),$null,'CurrentUser'))",
        { ...process.env, KS_KEY: key.toString("base64") },
      );
      writeFileSync(blobPath, blob, { mode: 0o600 });
    },
    remove() {
      rmSync(blobPath, { force: true });
    },
  };
}

/** 当前平台的首选后端;不支持的平台返回 null(走文件回退)。 */
function pickBackend(filePath: string): Backend | null {
  switch (process.platform) {
    case "darwin":
      return macKeychain;
    case "linux":
      return linuxSecretService;
    case "win32":
      return winDpapi(`${filePath}.dpapi`);
    default:
      return null;
  }
}

/** 文件回退:原 device.key 行为(32 随机字节、0600)。 */
function fileGetOrCreate(filePath: string): Buffer {
  if (!existsSync(filePath)) writeFileSync(filePath, randomBytes(KEY_LEN), { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return readFileSync(filePath);
}

/**
 * 取(或首次创建)device key。优先 OS keystore;命中即返回,否则新建随机 key 存入。
 * keystore 工具缺失 → 回退文件,backend 返回 "file"(调用方据此告警)。
 */
export function loadOrCreateDeviceKey(filePath: string): { key: Buffer; backend: KeystoreBackend } {
  const primary = pickBackend(filePath);
  if (primary) {
    try {
      const existing = primary.get();
      if (existing) return { key: existing, backend: primary.name };
      const key = randomBytes(KEY_LEN);
      primary.set(key);
      return { key, backend: primary.name };
    } catch (e) {
      if (!(e instanceof KeystoreUnavailable)) throw e;
      // 工具缺失(如无 libsecret 的精简 Linux):落到文件回退。
    }
  }
  return { key: fileGetOrCreate(filePath), backend: "file" };
}

/** 彻底清除 device key:keystore 条目 + 历史明文文件 + DPAPI blob 都删。 */
export function deleteDeviceKey(filePath: string): void {
  const primary = pickBackend(filePath);
  if (primary) {
    try {
      primary.remove();
    } catch {
      /* 工具缺失或条目不存在,忽略 */
    }
  }
  rmSync(filePath, { force: true });
}
