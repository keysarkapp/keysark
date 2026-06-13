// 构建期注入的版本 / 提交 / 仓库信息(见 next.config.ts 的 env 注入)。
// 用途:在导出的助记词备份(PDF / HTML)里记录「这份备份由哪份源码生成」,便于审计核对。
// 客户端可安全引用 —— 这些 NEXT_PUBLIC_* 值在构建时被内联为字符串字面量。

export const BUILD_VERSION = process.env.NEXT_PUBLIC_KEYSARK_VERSION ?? "0.0.0";
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_KEYSARK_COMMIT ?? "unknown";
export const BUILD_REPO = process.env.NEXT_PUBLIC_KEYSARK_REPO ?? "";

/** 形如 "https://github.com/org/keysark @ a1b2c3d · v0.0.1";无仓库地址时省略前段。 */
export function sourceLabel(): string {
  const left = BUILD_REPO ? `${BUILD_REPO} @ ${BUILD_COMMIT}` : BUILD_COMMIT;
  return `${left} · v${BUILD_VERSION}`;
}

/** 指向具体提交的链接(仅当仓库地址是 http(s) 且提交已知时);否则返回 null。 */
export function commitUrl(): string | null {
  if (!/^https?:\/\//.test(BUILD_REPO) || BUILD_COMMIT === "unknown") return null;
  const base = BUILD_REPO.replace(/\.git$/, "").replace(/\/$/, "");
  const sha = BUILD_COMMIT.replace(/-dirty$/, ""); // 链接里去掉 dirty 标记
  return `${base}/commit/${sha}`;
}
