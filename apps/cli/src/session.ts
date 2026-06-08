// 助记词来源与本机持久化。
// 优先级:KEYSARK_MNEMONIC 环境变量 > ~/.keysark/session.json(本机加密) > 交互输入。
//
// 本机加密:session.json 存的是用「设备密钥」(~/.keysark/device.key,32 随机字节,0600)
// AES-256-GCM 加密后的助记词。威胁模型同桌面「信任本机」—— 防的是裸读 session.json /
// 备份泄露,不防能同时读到两个文件的人。助记词绝不进网络、不进 :35291。
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { keysarkDir } from "./config";

function deviceKeyPath() {
  return join(keysarkDir(), "device.key");
}
function sessionPath() {
  return join(keysarkDir(), "session.json");
}

function ensureDir() {
  mkdirSync(keysarkDir(), { recursive: true });
}

function deviceKey(): Buffer {
  ensureDir();
  const p = deviceKeyPath();
  if (!existsSync(p)) {
    writeFileSync(p, randomBytes(32), { mode: 0o600 });
  }
  chmodSync(p, 0o600);
  return readFileSync(p);
}

/** 写本机加密的助记词会话。 */
export function saveSession(mnemonic: string): void {
  ensureDir();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deviceKey(), iv);
  const ct = Buffer.concat([cipher.update(mnemonic, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(
    sessionPath(),
    JSON.stringify({
      iv: iv.toString("base64"),
      ct: ct.toString("base64"),
      tag: tag.toString("base64"),
    }),
    { mode: 0o600 },
  );
}

export function clearSession(): void {
  rmSync(sessionPath(), { force: true });
}

export function hasSession(): boolean {
  return existsSync(sessionPath());
}

function loadSession(): string | null {
  try {
    const { iv, ct, tag } = JSON.parse(readFileSync(sessionPath(), "utf8")) as {
      iv: string;
      ct: string;
      tag: string;
    };
    const decipher = createDecipheriv("aes-256-gcm", deviceKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 取助记词:env > 已存会话 > 交互输入。allowPrompt=false 时不回退交互(非 TTY 脚本场景)。
 * 返回 null 表示无可用助记词。
 */
export async function acquireMnemonic(allowPrompt = true): Promise<string | null> {
  const env = process.env.KEYSARK_MNEMONIC?.trim();
  if (env) return env.replace(/\s+/g, " ");

  const sess = loadSession();
  if (sess) return sess;

  if (allowPrompt && process.stdin.isTTY) {
    const input = (await promptHidden("助记词(12 词,空格分隔):")).trim();
    return input ? input.replace(/\s+/g, " ") : null;
  }
  return null;
}
