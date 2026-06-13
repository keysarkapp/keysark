// 助记词的本机凭据与解锁缓存(机制与 web 版 vault-lock 一致):
//   - credential.json:用「解锁密码」经 Argon2id(m=512MB/t=4/p=1,参数随凭据存储)派生密钥,
//     AES-256-GCM 加密助记词。格式 {v, kdf, salt, params, iv, ct},全 base64。
//     本地永不存明文密码;密码对不对靠 GCM 认证标签。
//   - unlock-cache.json:输对密码后 15 分钟内免重输(对齐 web 闲置自动锁定默认值)。
//     用设备密钥 AES-256-GCM 加密 + 过期时间,每次命中滑动续期;过期即删,回到要密码的状态。
//     设备密钥优先存 OS keystore(钥匙串 / Secret Service / DPAPI,见 ./keystore),
//     使「拷贝整个 ~/.keysark」拿不到该密钥;keystore 不可用时回退到 0600 文件。
// 助记词/明文绝不进网络;加解密用 @keysark/crypto(与 web 同一套实现)。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ARGON2ID_PARAMS,
  decrypt,
  deriveWrappingKey,
  encrypt,
  generateWrappingSalt,
  scorePassword,
  type Argon2idParams,
  type StrengthReason,
} from "@keysark/crypto";
import { keysarkDir } from "./config";
import { ensureSecureDir, writeSecureFile } from "./fsperm";
import { deleteDeviceKey, loadOrCreateDeviceKey } from "./keystore";
import { askPassword, log, spinner } from "./ui";

/** 解锁缓存有效期:15 分钟(对齐 web 闲置自动锁定默认值),命中滑动续期。 */
const UNLOCK_TTL_MS = 15 * 60 * 1000;

const credentialPath = () => join(keysarkDir(), "credential.json");
const cachePath = () => join(keysarkDir(), "unlock-cache.json");
const deviceKeyPath = () => join(keysarkDir(), "device.key");

function ensureDir() {
  ensureSecureDir(keysarkDir()); // 目录 0700(POSIX);best-effort,启动守卫复核
}

let cachedDeviceKey: Buffer | null = null; // 进程内缓存:避免每次缓存读写都 spawn keystore CLI
let warnedFileFallback = false;

function deviceKey(): Buffer {
  if (cachedDeviceKey) return cachedDeviceKey;
  ensureDir();
  const { key, backend } = loadOrCreateDeviceKey(deviceKeyPath());
  if (backend === "file" && !warnedFileFallback) {
    warnedFileFallback = true;
    log.warn("OS keystore unavailable; unlock-cache key stored in ~/.keysark (weaker). Copying that dir within the 15-min window exposes the mnemonic.");
  }
  cachedDeviceKey = key;
  return key;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

// ---------- 密码加密的助记词凭据 ----------

interface Credential {
  v: 1;
  kdf: "argon2id";
  salt: string;
  params: Argon2idParams;
  iv: string;
  ct: string;
}

export function hasCredential(): boolean {
  return existsSync(credentialPath());
}

/** 用解锁密码封装助记词并落盘(覆盖旧凭据;salt 每次重新随机)。 */
export async function saveCredential(mnemonic: string, password: string): Promise<void> {
  const salt = generateWrappingSalt();
  const params = DEFAULT_ARGON2ID_PARAMS;
  const key = await deriveWrappingKey(password, salt, params);
  const { iv, ct } = await encrypt(key, new TextEncoder().encode(mnemonic));
  const cred: Credential = {
    v: 1,
    kdf: "argon2id",
    salt: b64(salt),
    params,
    iv: b64(iv),
    ct: b64(ct),
  };
  writeSecureFile(keysarkDir(), credentialPath(), JSON.stringify(cred));
}

/** 密码解锁:还原助记词。无凭据或密码错误(GCM 认证失败)都抛错。 */
export async function unlockCredential(password: string): Promise<string> {
  const raw = JSON.parse(readFileSync(credentialPath(), "utf8")) as Credential;
  if (raw.v !== 1 || raw.kdf !== "argon2id") throw new Error("Unsupported credential format");
  const key = await deriveWrappingKey(password, unb64(raw.salt), raw.params);
  const pt = await decrypt(key, unb64(raw.iv), unb64(raw.ct));
  return new TextDecoder().decode(pt);
}

/** 忘记本机助记词:删除凭据、解锁缓存与设备密钥(含 keystore 条目)。 */
export function clearCredential(): void {
  rmSync(credentialPath(), { force: true });
  clearUnlockCache();
  deleteDeviceKey(deviceKeyPath());
  cachedDeviceKey = null;
}

// ---------- 15 分钟解锁缓存(device.key 加密,滑动续期) ----------

interface UnlockCache {
  iv: string;
  ct: string;
  tag: string;
  expiresAt: number;
}

export function writeUnlockCache(mnemonic: string): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deviceKey(), iv);
  const ct = Buffer.concat([cipher.update(mnemonic, "utf8"), cipher.final()]);
  const cache: UnlockCache = {
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    expiresAt: Date.now() + UNLOCK_TTL_MS,
  };
  writeSecureFile(keysarkDir(), cachePath(), JSON.stringify(cache));
}

/** 读解锁缓存:过期返回 null 并删除;命中则滑动续期(再给 15 分钟)。 */
export function readUnlockCache(): string | null {
  try {
    const cache = JSON.parse(readFileSync(cachePath(), "utf8")) as UnlockCache;
    if (!cache.expiresAt || cache.expiresAt < Date.now()) {
      clearUnlockCache();
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deviceKey(),
      Buffer.from(cache.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(cache.tag, "base64"));
    const mnemonic = Buffer.concat([
      decipher.update(Buffer.from(cache.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
    writeUnlockCache(mnemonic); // 滑动续期
    return mnemonic;
  } catch {
    return null;
  }
}

export function clearUnlockCache(): void {
  rmSync(cachePath(), { force: true });
}

// ---------- 交互输入(@clack/prompts,经 ./ui 封装) ----------

const REASON_TEXT: Record<StrengthReason, string> = {
  too_short: "12+ chars",
  need_classes: "need 3 of: lower/upper/digit/symbol",
  weak_pattern: "too predictable",
};

/** 交互设置解锁密码:强度校验(与 web 同一套规则,提交时校验)+ 二次确认,直到合格。 */
export async function promptNewPassword(): Promise<string> {
  for (;;) {
    const pw = await askPassword("Set unlock password (12+ chars, 3+ classes)", (v) => {
      const score = scorePassword(v);
      return score.ok ? undefined : score.reasons.map((r) => REASON_TEXT[r]).join(" · ");
    });
    const pw2 = await askPassword("Confirm password");
    if (pw === pw2) return pw;
    log.error("Mismatch, try again.");
  }
}

/**
 * 取助记词:env > 解锁缓存(15 分钟,滑动续期)> 密码解锁凭据(最多 3 次)。
 * allowPrompt=false 时不交互(脚本场景)。返回 null 表示无可用助记词(应先 import)。
 */
export async function acquireMnemonic(allowPrompt = true): Promise<string | null> {
  const env = process.env.KEYSARK_MNEMONIC?.trim();
  if (env) return env.replace(/\s+/g, " ");

  const cached = readUnlockCache();
  if (cached) return cached;

  if (!hasCredential()) return null;
  if (!allowPrompt || !process.stdin.isTTY) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const pw = await askPassword("Unlock password");
    if (!pw) continue;
    // Argon2id(512MB)派生要 ~1-2s,转个 spinner 免得像卡死。
    const sp = spinner();
    sp.start("Deriving key…");
    try {
      const mnemonic = await unlockCredential(pw);
      sp.stop();
      writeUnlockCache(mnemonic); // 输对密码 → 15 分钟内免重输
      return mnemonic;
    } catch {
      sp.stop();
      log.error(attempt < 3 ? "Wrong password, try again." : "Wrong password.");
    }
  }
  return null;
}
