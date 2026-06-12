// 文件夹路径工具:名字路径 ("a/b/c") ↔ folderId。
import type { Vault } from "@keysark/vault";

/** 每个文件夹 id → "a/b/c" 全路径(沿 parentId 上溯;断链层级忽略)。 */
export function folderPathById(vault: Vault): Map<string, string> {
  const byId = new Map(vault.folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, seen: Set<string>): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const f = byId.get(id);
    if (!f || seen.has(id)) return "";
    seen.add(id);
    const parent = f.parentId ? pathOf(f.parentId, seen) : "";
    const p = parent ? `${parent}/${f.name}` : f.name;
    paths.set(id, p);
    return p;
  };
  for (const f of vault.folders) pathOf(f.id, new Set());
  return paths;
}

/** 只查不建:路径每一级都存在则返回 folderId(根目录为 null);任一级缺失返回 undefined。 */
export function lookupFolderPath(vault: Vault, path: string): string | null | undefined {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let parentId: string | null = null;
  for (const name of segments) {
    const f = vault.folders.find((x) => x.parentId === parentId && x.name === name);
    if (!f) return undefined;
    parentId = f.id;
  }
  return parentId;
}

/**
 * 把 "a/b/c" 文件夹路径解析成 folderId:逐级按 (name, parentId) 匹配已有文件夹,
 * 缺失层级自动创建。空路径 / "/" 表示根目录(返回 null)。
 */
export async function resolveFolderPath(vault: Vault, path: string): Promise<string | null> {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let parentId: string | null = null;
  for (const name of segments) {
    const existing = vault.folders.find((f) => f.parentId === parentId && f.name === name);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const res = await vault.addFolder(name, parentId);
    if (!res.synced) console.error(`! 文件夹「${name}」已本地创建,同步失败:${res.syncError}`);
    parentId = res.id;
  }
  return parentId;
}
