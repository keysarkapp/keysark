// 落地页登录入口开关(纯服务端,读 process.env)。
//   KEYSARK_ENABLE_GOOGLE  默认开(留空=开,显式 "0"/"false" 关)
//   KEYSARK_ENABLE_BAIDU   默认关(留空=关,显式 "1"/"true" 开)
// 桌面 sidecar(KEYSARK_DESKTOP=1)强制仅 Google;两者都被关时回退仅 Google,
// 避免落地页没有任何登录入口。默认即「仅 Google Drive」。

export type ProviderFlags = { google: boolean; baidu: boolean };

const isOn = (v: string | undefined) => v === "1" || v === "true";
const isOff = (v: string | undefined) => v === "0" || v === "false";

export function providerFlags(): ProviderFlags {
  if (process.env.KEYSARK_DESKTOP === "1") return { google: true, baidu: false };
  let google = !isOff(process.env.KEYSARK_ENABLE_GOOGLE); // 默认开
  const baidu = isOn(process.env.KEYSARK_ENABLE_BAIDU); // 默认关
  if (!google && !baidu) google = true; // 回退:至少留一个入口
  return { google, baidu };
}

/** 启用的存储后端的展示名(用于联动主页文案)。
 *  仅 Google → "Google Drive";仅百度 → "百度网盘";两者 → "百度网盘 / Google Drive"。 */
export function storageLabel(
  flags: ProviderFlags,
  names: { google: string; baidu: string },
): string {
  if (flags.google && flags.baidu) return `${names.baidu} / ${names.google}`;
  return flags.baidu ? names.baidu : names.google;
}
