// `ark save <source> [target]` 的目标解析:
//   - 显式 target:"a/b/标题";末尾 "/" 表示文件夹,标题用源文件名;单段 = 根目录下条目。
//   - 省略 target:在 git 仓库内按 origin 推导(github.com/me/repo/<仓库内相对路径>),否则根目录 + 文件名。
import { basename, dirname, relative } from "node:path";
import { providerForHost } from "@keysark/vault";
import { gitContext } from "./git";

export interface SaveTarget {
  folderPath?: string; // 文件夹路径;undefined = 根目录
  title: string;
  provider?: string; // 来源服务 id / 原始域名;undefined = 不设置(更新时保留原值)
  note?: string; // 推导来源说明(展示用)
}

/** 解析显式 target。无效(空/全斜杠且无源文件名兜底)返回 null。 */
export function parseSaveTarget(target: string, sourceFile: string): SaveTarget | null {
  const segs = target
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let title: string;
  let folderPath: string | undefined;
  if (target.endsWith("/")) {
    // "a/b/" → 文件夹 a/b,标题用源文件名;"/" → 根目录
    title = basename(sourceFile);
    folderPath = segs.length ? segs.join("/") : undefined;
  } else {
    if (segs.length === 0) return null;
    title = segs.pop()!;
    folderPath = segs.length ? segs.join("/") : undefined;
  }
  // 文件夹首段恰好是已知服务域名(如 github.com/...)→ 顺带打 provider 标
  const provider = folderPath ? providerForHost(folderPath.split("/")[0]!)?.id : undefined;
  return { folderPath, title, provider };
}

/** 按源文件所在 git 仓库的 origin 域名识别 provider;非仓库/无 origin 返回 undefined。 */
export function detectSourceProvider(sourceFile: string): string | undefined {
  const git = gitContext(dirname(sourceFile));
  if (!git) return undefined;
  const host = git.originPath.split("/")[0]!;
  return providerForHost(host)?.id ?? host;
}

/** 省略 target 时的自动推导:git 仓库 → origin 路径 + 仓库内相对路径;否则根目录 + 文件名。 */
export function proposeSaveTarget(sourceFile: string): SaveTarget {
  const git = gitContext(dirname(sourceFile));
  if (git) {
    const host = git.originPath.split("/")[0]!;
    return {
      folderPath: git.originPath,
      title: relative(git.repoRoot, sourceFile),
      provider: providerForHost(host)?.id ?? host,
      note: "由 git origin 推导",
    };
  }
  return { title: basename(sourceFile), note: "非 git 仓库,存根目录" };
}

/** 展示用完整目标路径。 */
export function targetDisplay(t: SaveTarget): string {
  return t.folderPath ? `${t.folderPath}/${t.title}` : t.title;
}
