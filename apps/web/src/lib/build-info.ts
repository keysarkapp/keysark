// 构建期注入的版本 / 提交 / 仓库 / 构建环境信息(见 next.config.ts 的 env 注入),
// 外加运行期(导出当下)的浏览器环境与固定的加密方案规格,合成一份「出处清单(provenance)」。
//
// 用途:写进导出的助记词备份(PDF / HTML),让用户即便多年以后,也能据此还原
//「生成这份备份的软件运行环境」并复现解密 —— 检出对应源码、对齐依赖、核对加密算法与参数。
// 客户端可安全引用:NEXT_PUBLIC_* 在构建时被内联为字符串字面量;运行期字段读 navigator/Intl。
import { DEFAULT_ARGON2ID_PARAMS } from "@keysark/crypto";
import type { Locale } from "@/lib/i18n";

export const BUILD_VERSION = process.env.NEXT_PUBLIC_KEYSARK_VERSION ?? "0.0.0";
/** ark CLI(@keysark/cli)版本;构建期从 apps/cli/package.json 注入,展示在文档/落地页。 */
export const CLI_VERSION = process.env.NEXT_PUBLIC_KEYSARK_CLI_VERSION ?? "0.0.0";
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_KEYSARK_COMMIT ?? "unknown";
export const BUILD_REPO = process.env.NEXT_PUBLIC_KEYSARK_REPO ?? "";

interface BuildManifest {
  buildTime: string;
  node: string;
  deps: Record<string, string>;
}

const BUILD: BuildManifest = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_KEYSARK_BUILD ?? "") as BuildManifest;
  } catch {
    return { buildTime: "", node: "", deps: {} };
  }
})();

/** 形如 "https://github.com/org/keysark @ a1b2c3d · ark v1.0.3";无仓库地址时省略前段。
 *  版本统一用 ark CLI 版本(对外的产品版本号);web 自身的 package.json 版本不对外展示。 */
export function sourceLabel(): string {
  const left = BUILD_REPO ? `${BUILD_REPO}@${BUILD_COMMIT}` : BUILD_COMMIT;
  return `${left} · ark v${CLI_VERSION}`;
}

/** 指向具体提交的链接(仅当仓库地址是 http(s) 且提交已知时);否则返回 null。 */
export function commitUrl(): string | null {
  if (!/^https?:\/\//.test(BUILD_REPO) || BUILD_COMMIT === "unknown") return null;
  const base = BUILD_REPO.replace(/\.git$/, "").replace(/\/$/, "");
  const sha = BUILD_COMMIT.replace(/-dirty$/, ""); // 链接里去掉 dirty 标记
  return `${base}/commit/${sha}`;
}

// 加密方案规格(与 @keysark/crypto 实现一致;参数取自同一常量,避免漂移)。
// 即便源码失传,凭这几行也足以重新实现解密。
const A = DEFAULT_ARGON2ID_PARAMS;
const CRYPTO_SPEC = {
  mnemonic: "BIP39 · 24 words (legacy vaults 12) · English wordlist (256/128-bit entropy)",
  vaultKey:
    "BIP39 seed (PBKDF2-HMAC-SHA512) → HKDF-SHA256 (info=keysark-aes-gcm-v1, 32B) → AES-256-GCM, 96-bit IV",
  backupKdf: `Argon2id (m=${A.m} KiB, t=${A.t}, p=${A.p}, 32B, NFKC) → AES-256-GCM, 96-bit IV`,
};

/** 运行期(导出当下)的浏览器/系统环境;SSR 下各字段回退空串。 */
function runtimeContext(): {
  language: string;
  timeZone: string;
  userAgent: string;
  platform: string;
} {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* ignore */
  }
  // userAgentData 为渐进特性,标准 DOM 类型里未必有,缺失时回退到(已弃用但仍在的)platform。
  const uaData = (nav as unknown as { userAgentData?: { platform?: string } } | undefined)
    ?.userAgentData;
  return {
    language: nav?.language ?? "",
    timeZone,
    userAgent: nav?.userAgent ?? "",
    platform: uaData?.platform ?? nav?.platform ?? "",
  };
}

export interface Provenance {
  app: {
    version: string;
    cliVersion: string;
    commit: string;
    repo: string;
    source: string;
    commitUrl: string | null;
  };
  build: { time: string; node: string; deps: Record<string, string> };
  crypto: typeof CRYPTO_SPEC;
  runtime: {
    exportedAt: string;
    locale: Locale;
    language: string;
    timeZone: string;
    platform: string;
    userAgent: string;
  };
}

/** 汇总完整出处清单(机器可读;HTML 备份内嵌进 JSON payload)。 */
export function collectProvenance(locale: Locale): Provenance {
  const rt = runtimeContext();
  return {
    app: {
      version: BUILD_VERSION,
      cliVersion: CLI_VERSION,
      commit: BUILD_COMMIT,
      repo: BUILD_REPO,
      source: sourceLabel(),
      commitUrl: commitUrl(),
    },
    build: { time: BUILD.buildTime, node: BUILD.node, deps: BUILD.deps },
    crypto: CRYPTO_SPEC,
    runtime: {
      exportedAt: new Date().toISOString(),
      locale,
      language: rt.language,
      timeZone: rt.timeZone,
      platform: rt.platform,
      userAgent: rt.userAgent,
    },
  };
}

// 出处清单的展示标签(随导出语言切换;技术值本身保持英文/数字,跨语言通用)。
interface LabelSet {
  title: string;
  cliVersion: string;
  source: string;
  built: string;
  node: string;
  framework: string;
  pdflib: string;
  cryptolibs: string;
  mnemonic: string;
  vaultkey: string;
  backupkdf: string;
  exported: string;
  locale: string;
  brlang: string;
  tz: string;
  platform: string;
  ua: string;
}

const LABELS: Record<Locale, LabelSet> = {
  zh: {
    title: "构建环境上下文",
    cliVersion: "ark CLI 版本",
    source: "源码",
    built: "构建时间",
    node: "构建运行时",
    framework: "框架",
    pdflib: "PDF 库",
    cryptolibs: "加密库",
    mnemonic: "助记词",
    vaultkey: "保险库密钥派生",
    backupkdf: "备份口令 KDF",
    exported: "导出时间",
    locale: "界面语言",
    brlang: "浏览器语言",
    tz: "时区",
    platform: "平台",
    ua: "浏览器标识",
  },
  en: {
    title: "Build environment context",
    cliVersion: "ark CLI version",
    source: "Source",
    built: "Built",
    node: "Build runtime",
    framework: "Framework",
    pdflib: "PDF lib",
    cryptolibs: "Crypto libs",
    mnemonic: "Mnemonic",
    vaultkey: "Vault key derivation",
    backupkdf: "Backup password KDF",
    exported: "Exported",
    locale: "UI language",
    brlang: "Browser language",
    tz: "Time zone",
    platform: "Platform",
    ua: "User agent",
  },
};

export interface ProvenanceRow {
  label: string;
  value: string;
}

/** 出处清单 → 有序 [标签, 值] 行(PDF 第二页与 HTML 环境区共用渲染)。 */
export function provenanceRows(locale: Locale): { title: string; rows: ProvenanceRow[] } {
  const L = LABELS[locale];
  const p = collectProvenance(locale);
  const d = p.build.deps;
  const dep = (n: string) => d[n] ?? "n/a";
  const exportedLocal = new Date(p.runtime.exportedAt).toLocaleString(
    locale === "zh" ? "zh-CN" : "en-US",
  );
  const builtLocal = p.build.time
    ? new Date(p.build.time).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")
    : "n/a";

  const rows: ProvenanceRow[] = [
    { label: L.cliVersion, value: `ark v${p.app.cliVersion}` },
    { label: L.source, value: p.app.source },
    { label: L.built, value: builtLocal },
    { label: L.node, value: `Node ${p.build.node || "n/a"}` },
    { label: L.framework, value: `Next.js ${dep("next")} · React ${dep("react")}` },
    { label: L.pdflib, value: `jsPDF ${dep("jspdf")}` },
    {
      label: L.cryptolibs,
      value: `hash-wasm ${dep("hash-wasm")} · @scure/bip39 ${dep("@scure/bip39")} · @noble/hashes ${dep("@noble/hashes")}`,
    },
    { label: L.mnemonic, value: p.crypto.mnemonic },
    { label: L.vaultkey, value: p.crypto.vaultKey },
    { label: L.backupkdf, value: p.crypto.backupKdf },
    { label: L.exported, value: exportedLocal },
    { label: L.locale, value: p.runtime.locale },
    { label: L.brlang, value: p.runtime.language || "n/a" },
    { label: L.tz, value: p.runtime.timeZone || "n/a" },
    { label: L.platform, value: p.runtime.platform || "n/a" },
    { label: L.ua, value: p.runtime.userAgent || "n/a" },
  ];
  return { title: L.title, rows };
}
