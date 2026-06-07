// 轻量 i18n:中/英双语词典 + 取词函数。
// locale 与 theme 都用 cookie 持久化,服务端在 layout 里读取以保证 SSR 与客户端一致(无闪烁)。
export type Locale = "zh" | "en";
export type Theme = "system" | "light" | "dark";

export const LOCALE_COOKIE = "keysark_locale";
export const THEME_COOKIE = "keysark_theme";

export const LOCALES: Locale[] = ["zh", "en"];
export const THEMES: Theme[] = ["system", "light", "dark"];

type Msg = string | ((...args: never[]) => string);

const zh = {
  // 头部控制
  lang_zh: "中文",
  lang_en: "EN",
  theme_label: "主题",
  theme_system: "跟随系统",
  theme_light: "浅色",
  theme_dark: "深色",
  account_connected: "已连接百度网盘",
  sign_out: "退出登录",
  user_fallback: "百度用户",

  // 落地页
  nav_connect: "连接百度网盘",
  nav_connect_google: "用 Google 登录",
  cta_google: "用 Google 登录,存进 Google Drive",
  hero_badge: "零知识 · 端到端加密",
  hero_title_1: "你的秘密,",
  hero_title_2: "只有你能打开。",
  hero_subtitle:
    "KeysArk 是端到端加密的文本保管库。用一组助记词守护一切,密文存进你自己的百度网盘——除了你,没有人能读到里面的内容。",
  cta_primary: "连接百度网盘,免费开始",
  cta_secondary: "了解工作原理",
  footer_tagline: "端到端加密 · 百度网盘为唯一存储后端",
  err_state: "登录校验失败,请重试。",
  err_exchange: "授权交换失败,请重试。",
  err_default: "登录出错,请重试。",
  feat_1_title: "端到端加密",
  feat_1_body:
    "内容在你的浏览器里用 AES-256-GCM 加密后才离开设备。服务端与百度网盘只经手不透明密文,永远看不到明文。",
  feat_2_title: "助记词即主密钥",
  feat_2_body:
    "12 词 BIP39 助记词在本地派生密钥,对齐 MetaMask。助记词只属于你,绝不上传——丢失即无法恢复,也无人能替你解密。",
  feat_3_title: "存在你的网盘",
  feat_3_body:
    "密文保存在你自己的百度网盘 /apps/Keyper/ 沙盒目录。数据归属清晰,随时可迁移,不被平台绑架。",

  // 创建保险库
  create_title: "创建你的保险库",
  create_desc_a: "KeysArk 会生成 12 词助记词作为主密钥。它",
  create_desc_strong: "只显示一次、只存在你这里",
  create_desc_b: "。",
  create_warn_a: "请准备好纸笔。生成后请抄写并妥善保管——",
  create_warn_strong: "丢失即数据永久无法恢复",
  create_warn_b: ",没有任何人(包括我们)能替你找回。",
  btn_generate: "生成助记词",
  copy_hint: "抄写完成后继续,下一步会抽查几个词以确认你已备份。",
  btn_copied: "我已抄写,继续",
  confirm_prompt: "请按编号填入对应的词以确认备份:",
  word_nth: (n: number) => `第 ${n} 个`,
  btn_confirm_create: "确认并创建",
  btn_review_again: "再看一遍助记词",

  // 选择保险库
  select_title: "选择保险库",
  select_desc: "你有多个保险库,选择一个并输入它的助记词。",
  select_enter_phrase: "输入助记词以解锁",
  default_vault: "未命名保险库",

  // 创建保险库 — 名称
  create_label: "保险库名称",
  create_label_ph: "例如:个人 / 工作(可留空)",

  // 解锁
  unlock_title: "解锁保险库",
  unlock_desc: "输入 12 词助记词,在本地派生密钥以解密内容。",
  unlock_desc_named: (name: string) =>
    `输入「${name}」的 12 词助记词,在本地派生密钥以解密内容。`,
  switch_vault: "切换其他保险库",
  btn_unlock: "解锁",
  new_vault: "用新助记词创建保险库",
  back_to_unlock: "返回解锁现有保险库",

  // 工作台
  sidebar_vaults: "保管库",
  all_items: "全部条目",
  folders_label: "文件夹",
  new_folder: "新建文件夹",
  new_item: "新建条目",
  more_actions: "更多操作",
  drag_to_move: "拖动到文件夹",
  add_subfolder: "新建子文件夹",
  folder_name_ph: "文件夹名称",
  rename: "重命名",
  delete: "删除",
  confirm_delete_folder: (name: string) =>
    `删除文件夹「${name}」?其中的条目与子文件夹会移动到上级目录。`,
  btn_lock: "锁定保险库",
  btn_unlock_remembered: "用本设备解锁",
  remember_device: "在此设备记住(下次免输助记词)",
  btn_forget_device: "忘记本设备",
  search_placeholder: "搜索条目…",
  empty_vault: "保险库还是空的,点「+ 新建」开始。",
  empty_search: "没有匹配的条目。",
  bytes_cipher: (n: number) => `${n} 字节(密文)`,
  detail_new: "新建条目",
  field_title: "标题",
  field_title_ph: "给这条起个标题",
  untitled: "未命名",
  field_content: "内容",
  content_ph: "在这里编辑文本(保存时在本地加密)…",
  content_empty: "(空)",
  preview_empty: "从左侧选择一个条目,或点「+ 新建」",
  stored_at: (provider: string) => `存于 ${provider}:`,
  storage_label: "存储位置",
  last_edited: (d: string) => `最后编辑 ${d}`,
  open_in_netdisk: "在网盘中打开",
  provider_baidu: "百度网盘",
  provider_google: "Google Drive",
  btn_edit: "编辑",
  btn_cancel: "取消",
  btn_save: "保存",
  btn_clear: "清空",
  btn_sync: "同步到网盘",
  synced: "已同步",
  pending_count: (n: number) => `${n} 项待同步`,
  loading_entries: "加载条目中…",

  // 状态提示
  st_invalid_mnemonic: "助记词无效(请检查 12 个词与拼写)",
  st_missing_meta: "缺少保险库元数据",
  st_unlocking: "解锁中 …",
  st_mismatch: "助记词不匹配此保险库",
  st_unlock_fail: (e: string) => `解锁失败: ${e}`,
  st_word_mismatch: (n: number) => `第 ${n} 个词不匹配,请核对备份`,
  st_creating: "创建保险库 …",
  st_create_fail: (e: string) => `创建失败: ${e}`,
  st_decrypting: (name: string) => `解密 ${name} …`,
  st_open_fail: (e: string) => `打开失败: ${e}`,
  st_saving: "加密保存中 …",
  st_saved: "已加密保存并同步到网盘",
  st_saved_local: (e: string) => `已存本地,网盘同步失败:${e}`,
  st_save_fail: (e: string) => `保存失败: ${e}`,
  st_syncing: "同步中 …",
  st_sync_ok: "已全部同步到网盘",
  st_sync_fail: (e: string) => `同步失败: ${e}`,
  st_load_fail: (e: string) => `加载列表失败: ${e}`,
} satisfies Record<string, Msg>;

const en: typeof zh = {
  lang_zh: "中文",
  lang_en: "EN",
  theme_label: "Theme",
  theme_system: "System",
  theme_light: "Light",
  theme_dark: "Dark",
  account_connected: "Connected to Baidu",
  sign_out: "Sign out",
  user_fallback: "Baidu user",

  nav_connect: "Connect Baidu",
  nav_connect_google: "Sign in with Google",
  cta_google: "Sign in with Google — store in Google Drive",
  hero_badge: "Zero-knowledge · End-to-end encrypted",
  hero_title_1: "Your secrets,",
  hero_title_2: "openable only by you.",
  hero_subtitle:
    "KeysArk is an end-to-end encrypted text vault. Guard everything with one recovery phrase, with ciphertext stored in your own Baidu netdisk — no one but you can read what's inside.",
  cta_primary: "Connect Baidu — start free",
  cta_secondary: "How it works",
  footer_tagline: "End-to-end encrypted · Baidu netdisk as the only storage backend",
  err_state: "Login verification failed, please try again.",
  err_exchange: "Authorization exchange failed, please try again.",
  err_default: "Login error, please try again.",
  feat_1_title: "End-to-end encrypted",
  feat_1_body:
    "Content is encrypted with AES-256-GCM in your browser before it ever leaves the device. The server and Baidu only ever handle opaque ciphertext — never plaintext.",
  feat_2_title: "Your phrase is the master key",
  feat_2_body:
    "A 12-word BIP39 phrase derives the key locally, aligned with MetaMask. The phrase is yours alone and never uploaded — lose it and it's unrecoverable; no one can decrypt for you.",
  feat_3_title: "Stored in your netdisk",
  feat_3_body:
    "Ciphertext lives in your own Baidu /apps/Keyper/ sandbox folder. Ownership is clear, portable anytime, never locked to a platform.",

  create_title: "Create your vault",
  create_desc_a: "KeysArk generates a 12-word recovery phrase as your master key. It is ",
  create_desc_strong: "shown once and lives only with you",
  create_desc_b: ".",
  create_warn_a: "Have pen and paper ready. After generating, write it down and store it safely — ",
  create_warn_strong: "lose it and your data is gone forever",
  create_warn_b: "; no one (including us) can recover it for you.",
  btn_generate: "Generate phrase",
  copy_hint: "Continue once you've written it down; next we'll spot-check a few words.",
  btn_copied: "I've written it down, continue",
  confirm_prompt: "Enter the words by number to confirm your backup:",
  word_nth: (n: number) => `Word ${n}`,
  btn_confirm_create: "Confirm & create",
  btn_review_again: "Show the phrase again",

  select_title: "Choose a vault",
  select_desc: "You have multiple vaults. Pick one and enter its recovery phrase.",
  select_enter_phrase: "Enter phrase to unlock",
  default_vault: "Untitled vault",

  create_label: "Vault name",
  create_label_ph: "e.g. Personal / Work (optional)",

  unlock_title: "Unlock vault",
  unlock_desc: "Enter your 12-word phrase to derive the key locally and decrypt.",
  unlock_desc_named: (name: string) =>
    `Enter the 12-word phrase for “${name}” to derive the key locally and decrypt.`,
  switch_vault: "Switch to another vault",
  btn_unlock: "Unlock",
  new_vault: "Create a vault with a new phrase",
  back_to_unlock: "Back to unlocking the existing vault",

  sidebar_vaults: "Vaults",
  all_items: "All Items",
  folders_label: "Folders",
  new_folder: "New folder",
  new_item: "New item",
  more_actions: "More actions",
  drag_to_move: "Drag into a folder",
  add_subfolder: "New subfolder",
  folder_name_ph: "Folder name",
  rename: "Rename",
  delete: "Delete",
  confirm_delete_folder: (name: string) =>
    `Delete folder "${name}"? Its items and subfolders will move to the parent.`,
  btn_lock: "Lock vault",
  btn_unlock_remembered: "Unlock with this device",
  remember_device: "Remember on this device (skip phrase next time)",
  btn_forget_device: "Forget this device",
  search_placeholder: "Search items…",
  empty_vault: "Your vault is empty — hit “+ New” to start.",
  empty_search: "No matching items.",
  bytes_cipher: (n: number) => `${n} bytes (ciphertext)`,
  detail_new: "New item",
  field_title: "Title",
  field_title_ph: "Give this entry a title",
  untitled: "Untitled",
  field_content: "Content",
  content_ph: "Edit text here (encrypted locally on save)…",
  content_empty: "(empty)",
  preview_empty: "Select an item on the left, or hit “+ New”",
  stored_at: (provider: string) => `Stored in ${provider}:`,
  storage_label: "Stored at",
  last_edited: (d: string) => `Last edited ${d}`,
  open_in_netdisk: "Open in netdisk",
  provider_baidu: "Baidu netdisk",
  provider_google: "Google Drive",
  btn_edit: "Edit",
  btn_cancel: "Cancel",
  btn_save: "Save",
  btn_clear: "Clear",
  btn_sync: "Sync to netdisk",
  synced: "Synced",
  pending_count: (n: number) => `${n} pending`,
  loading_entries: "Loading entries…",

  st_invalid_mnemonic: "Invalid phrase (check the 12 words and spelling)",
  st_missing_meta: "Missing vault metadata",
  st_unlocking: "Unlocking…",
  st_mismatch: "Phrase doesn't match this vault",
  st_unlock_fail: (e: string) => `Unlock failed: ${e}`,
  st_word_mismatch: (n: number) => `Word ${n} doesn't match, please re-check your backup`,
  st_creating: "Creating vault…",
  st_create_fail: (e: string) => `Create failed: ${e}`,
  st_decrypting: (name: string) => `Decrypting ${name}…`,
  st_open_fail: (e: string) => `Open failed: ${e}`,
  st_saving: "Encrypting & saving…",
  st_saved: "Encrypted, saved & synced to netdisk",
  st_saved_local: (e: string) => `Saved locally, netdisk sync failed: ${e}`,
  st_save_fail: (e: string) => `Save failed: ${e}`,
  st_syncing: "Syncing…",
  st_sync_ok: "All synced to netdisk",
  st_sync_fail: (e: string) => `Sync failed: ${e}`,
  st_load_fail: (e: string) => `Failed to load list: ${e}`,
};

export type MsgKey = keyof typeof zh;

const messages: Record<Locale, typeof zh> = { zh, en };

export function translate(locale: Locale, key: MsgKey, ...args: unknown[]): string {
  const m = messages[locale][key] as Msg;
  return typeof m === "function" ? (m as (...a: unknown[]) => string)(...args) : m;
}

export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}
