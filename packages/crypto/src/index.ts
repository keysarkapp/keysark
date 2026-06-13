// 纯浏览器 E2E 加密。BIP39 助记词 → 派生密钥 → AES-256-GCM。
// 禁止 import node:crypto;只用 globalThis.crypto.subtle + @noble/@scure(纯 JS)。
// 例外:Argon2id 走 hash-wasm(WebCrypto 无此原语);wasm 仅用于 Argon2id,AES 仍走 crypto.subtle。
import {
  generateMnemonic as bip39Generate,
  validateMnemonic as bip39Validate,
  mnemonicToSeed,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2id } from "hash-wasm";

const VERIFIER_MARKER = "keysark-verify-v1";
const HKDF_INFO = new TextEncoder().encode("keysark-aes-gcm-v1");

// 把 Uint8Array 拷成独立 ArrayBuffer,规避 WebCrypto 类型对 SharedArrayBuffer 的排斥。
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer as ArrayBuffer;
}

function b64encode(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** BIP39 助记词,固定 24 词 + 英文词表(256-bit 熵,标准 BIP39,可导入 MetaMask)。 */
export function generateMnemonic(): string {
  return bip39Generate(wordlist, 256);
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic.trim(), wordlist);
}

/** mnemonic → BIP39 seed (PBKDF2-HMAC-SHA512) → HKDF-SHA256 → AES-256-GCM CryptoKey。 */
export async function deriveKey(mnemonic: string): Promise<CryptoKey> {
  const seed = await mnemonicToSeed(mnemonic.trim());
  const keyBytes = hkdf(sha256, seed, new Uint8Array(0), HKDF_INFO, 32);
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface Cipher {
  iv: Uint8Array;
  ct: Uint8Array;
}

// AES-GCM 可选 AAD(附加认证数据):不加密但参与认证标签。用于把密文绑定到其
// 逻辑位置/身份(路径/条目 id/版本),恶意存储后端把 A 的密文塞到 B 的位置时,
// AAD 不匹配 → GCM 解密失败 → 篡改/替换被检出。AAD 不入信封,由调用方按上下文重建。
function gcmParams(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  const p: AesGcmParams = { name: "AES-GCM", iv: toArrayBuffer(iv) };
  if (aad) p.additionalData = toArrayBuffer(aad);
  return p;
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit,每次随机
  const ct = await crypto.subtle.encrypt(gcmParams(iv, aad), key, toArrayBuffer(plaintext));
  return { iv, ct: new Uint8Array(ct) };
}

export async function decrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(gcmParams(iv, aad), key, toArrayBuffer(ct));
  return new Uint8Array(pt);
}

interface Envelope {
  v: 2; // 恒为 2:加密时必绑定 AAD(解密必须提供同一 AAD)
  alg: "A256GCM";
  kdf: "BIP39+HKDF-SHA256";
  iv: string;
  ct: string;
}

const enc = new TextEncoder();

/** 明文字符串 → 加密 → envelope JSON 字节(存上网盘的格式)。aad 必填,把密文绑定到逻辑位置/身份。 */
export async function encryptToEnvelope(
  key: CryptoKey,
  plaintext: string,
  aad: string,
): Promise<Uint8Array> {
  const { iv, ct } = await encrypt(key, enc.encode(plaintext), enc.encode(aad));
  const env: Envelope = {
    v: 2,
    alg: "A256GCM",
    kdf: "BIP39+HKDF-SHA256",
    iv: b64encode(iv),
    ct: b64encode(ct),
  };
  return enc.encode(JSON.stringify(env));
}

export async function decryptFromEnvelope(
  key: CryptoKey,
  envelopeBytes: Uint8Array,
  aad: string,
): Promise<string> {
  const env = JSON.parse(new TextDecoder().decode(envelopeBytes)) as Envelope;
  if (env.v !== 2) throw new Error(`unsupported envelope version ${env.v}`);
  const pt = await decrypt(key, b64decode(env.iv), b64decode(env.ct), enc.encode(aad));
  return new TextDecoder().decode(pt);
}

// ---------- 二进制信封(文件密文专用,无 base64/JSON,省 33% 体积) ----------
// 帧格式:magic(4B "KSF1") + ver(1B,恒=2) + iv(12B) + ct(剩余全部)。
// ver=2:加密时必绑定 AAD(解密需提供同一 AAD)。文本条目走上面的 JSON 信封;大文件走这套裸字节帧。
const BLOB_MAGIC = new Uint8Array([0x4b, 0x53, 0x46, 0x31]); // "KSF1"
const BLOB_VER = 2;
const BLOB_HEADER_LEN = 4 + 1 + 12; // = 17

/** 原始字节 → 加密 → 二进制信封字节。aad 必填,把密文绑定到逻辑位置/身份。 */
export async function encryptBytesToBlob(
  key: CryptoKey,
  data: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  const { iv, ct } = await encrypt(key, data, enc.encode(aad));
  const out = new Uint8Array(BLOB_HEADER_LEN + ct.byteLength);
  out.set(BLOB_MAGIC, 0);
  out[4] = BLOB_VER;
  out.set(iv, 5);
  out.set(ct, BLOB_HEADER_LEN);
  return out;
}

/** 二进制信封字节 → 解密 → 原始字节。需提供加密时同一 aad。 */
export async function decryptBytesFromBlob(
  key: CryptoKey,
  blob: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  if (blob.byteLength < BLOB_HEADER_LEN) throw new Error("blob too short");
  for (let i = 0; i < BLOB_MAGIC.length; i++) {
    if (blob[i] !== BLOB_MAGIC[i]) throw new Error("bad blob magic");
  }
  const ver = blob[4];
  if (ver !== BLOB_VER) throw new Error(`unsupported blob version ${ver}`);
  const iv = blob.subarray(5, BLOB_HEADER_LEN);
  const ct = blob.subarray(BLOB_HEADER_LEN);
  return decrypt(key, iv, ct, enc.encode(aad));
}

/**
 * 明文字节的 SHA-256,返回小写 hex。用于条目内容去重(同内容不重复存版本)。
 * 注:对 AES-GCM 密文哈希无意义(每次随机 IV → 密文不同),只能对明文哈希。
 * 用 subtle.digest(原生、异步),100MB 文件也快。
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// ---------- 密码包裹密钥(每库解锁密码 → Argon2id → AES-256-GCM) ----------
// 用途:用「解锁密码」在本机加密保存助记词(见 apps/web vault-lock)。
// Argon2id 是 WebCrypto 缺失的原语,走审计过的 hash-wasm;输出喂给 crypto.subtle 当 AES key。

/** Argon2id 参数。m=内存(KiB),t=迭代次数,p=并行度。 */
export interface Argon2idParams {
  m: number;
  t: number;
  p: number;
}

/** 默认参数:512MB / t=4 / p=1(高强度抗离线暴破;桌面/中高端手机约 0.5-1s,
 *  低端设备可能更慢。参数随凭据存储,调高仅影响新封装,老凭据用各自存的参数解。)。 */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = { m: 524288, t: 4, p: 1 };

/** 可接受的 Argon2id 参数边界:防止被篡改的本地凭据把 m 改到极大 → 解锁 OOM/卡死。
 *  下限保证仍有意义的成本,上限(m≤1GiB)容纳默认 512MB 又挡住放大攻击。 */
const ARGON2ID_BOUNDS = {
  m: { min: 8 * 1024, max: 1024 * 1024 }, // KiB:8MiB ~ 1GiB
  t: { min: 1, max: 16 },
  p: { min: 1, max: 4 },
} as const;

/** 校验 Argon2id 参数在安全范围内;越界即抛(凭据被篡改/损坏)。 */
export function assertArgon2idParams(params: Argon2idParams): void {
  for (const k of ["m", "t", "p"] as const) {
    const v = params[k];
    const { min, max } = ARGON2ID_BOUNDS[k];
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new Error(`Argon2id param ${k}=${v} out of accepted range [${min}, ${max}]`);
    }
  }
}

/** 生成密码包裹用的随机 salt(16 字节,每库独立、绝不复用)。 */
export function generateWrappingSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * 解锁密码 → Argon2id → non-extractable AES-256-GCM 包裹密钥。
 * 同 password+salt+params 稳定产出同一 key;密码先 NFKC 归一化,避免同字符不同码点。
 * 进入前校验 params 边界:被篡改的凭据想用超大 m 触发 OOM/卡死会在此被挡下。
 */
export async function deriveWrappingKey(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<CryptoKey> {
  assertArgon2idParams(params);
  const keyBytes = await argon2id({
    password: password.normalize("NFKC"),
    salt,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export {
  scorePassword,
  MIN_PASSWORD_LENGTH,
  type PasswordScore,
  type StrengthReason,
} from "./password-strength";

/** 口令校验块:加密已知标记。解锁时解密比对,判断助记词是否正确。
 *  aad(如 vault id|dir)必填 → 绑定上下文:描述符被恶意存储后端改 dir / 掉包时,
 *  重建的 AAD 与创建时不符 → 校验失败,从而检出篡改。 */
export async function makeVerifier(key: CryptoKey, aad: string): Promise<Uint8Array> {
  return encryptToEnvelope(key, VERIFIER_MARKER, aad);
}

export async function checkVerifier(
  key: CryptoKey,
  verifierBytes: Uint8Array,
  aad: string,
): Promise<boolean> {
  try {
    return (await decryptFromEnvelope(key, verifierBytes, aad)) === VERIFIER_MARKER;
  } catch {
    return false;
  }
}
