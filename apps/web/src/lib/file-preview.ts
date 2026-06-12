// 文件在线预览的格式判定与体积分级。纯函数,无副作用,可在任何环境调用。
// 判定一律用「文件名后缀」,不用 mimeType —— .env/.toml 上传时 file.type 多为空或
// application/octet-stream,据此分流会失败(见 proposal 关键决策)。

export type PreviewKind = "pdf" | "markdown" | "code" | "text" | "unsupported";

// highlight.js 语言 id;code 类必带,text 类为 null(纯文本不高亮)。
export type HighlightLang = "json" | "yaml" | "ini";

export interface PreviewSpec {
  kind: PreviewKind;
  lang?: HighlightLang | null;
}

// 后缀 → 预览规格。.env/.toml 复用 highlight.js 的 ini grammar(KEY=value / [section])。
const EXT_MAP: Record<string, PreviewSpec> = {
  pdf: { kind: "pdf" },
  md: { kind: "markdown" },
  markdown: { kind: "markdown" },
  json: { kind: "code", lang: "json" },
  yaml: { kind: "code", lang: "yaml" },
  yml: { kind: "code", lang: "yaml" },
  toml: { kind: "code", lang: "ini" },
  env: { kind: "code", lang: "ini" },
  txt: { kind: "text", lang: null },
};

// 取最后一段后缀(小写),先剥掉路径前缀。".env" → "env"(dotfile 也能命中)。
export function extOf(filename: string): string {
  const base = filename.toLowerCase().split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1);
}

export function previewSpecOf(filename: string): PreviewSpec {
  // 条目标题可能是带路径的(ark save 存仓库相对路径,如 apps/web/.env.local),按末段判定。
  const base = filename.toLowerCase().split("/").pop() ?? "";
  // .env 家族:.env / .env.local / .env.production / foo.env / env.local —— 任一点分段为 env 即命中
  if (base.split(".").filter(Boolean).includes("env")) {
    return { kind: "code", lang: "ini" };
  }
  return EXT_MAP[extOf(base)] ?? { kind: "unsupported" };
}

// 体积分级:先看字节数再决定是否解码/高亮,避免对超大文件做无谓的大字符串分配。
export const HIGHLIGHT_MAX_BYTES = 1024 * 1024; // ≤1MB 才高亮
export const TEXT_MAX_BYTES = 5 * 1024 * 1024; // 1–5MB 纯文本不高亮;>5MB 仅下载

// 体积上限的人类可读串,供超限提示复用。
export const TEXT_MAX_LABEL = "5MB";
