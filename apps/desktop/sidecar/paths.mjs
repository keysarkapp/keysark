// 桌面端共享路径与默认值。CLI 与 Tauri 约定同一套 ~/.keysark 布局。
import { homedir } from "node:os";
import { join } from "node:path";

/** 本地接口默认端口(可被配置 / KEYSARK_LOCAL_PORT 覆盖)。 */
export const DEFAULT_LOCAL_PORT = 35291;

export function keysarkDir() {
  return join(homedir(), ".keysark");
}
/** 桌面写、CLI 读:本地接口 { port, token }。 */
export function localConfigPath() {
  return join(keysarkDir(), "local.json");
}
/** JSON token 后端落盘文件。 */
export function tokensPath() {
  return join(keysarkDir(), "tokens.json");
}
/** 桌面用户设置(端口等)。 */
export function desktopConfigPath() {
  return join(keysarkDir(), "desktop.json");
}
