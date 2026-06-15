// 轻量 i18n:中/英双语词典 + 取词函数。
// 语言由 URL 决定(默认英文在根路径,其它语言走 /<locale> 前缀,见 proxy.ts);主题仍用 cookie 持久化。
export type Locale = "zh" | "en";
export type Theme = "system" | "light" | "dark";

export const THEME_COOKIE = "keysark_theme";

// 默认英文(根路径无前缀);其它语言放到路由里(如 /zh)。顺序即语言切换器里的展示顺序。
export const LOCALES: Locale[] = ["en", "zh"];
export const THEMES: Theme[] = ["system", "light", "dark"];

export const DEFAULT_LOCALE: Locale = "en";
export const NON_DEFAULT_LOCALES: Locale[] = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

/** 非默认语言加 `/<locale>` 前缀;默认语言(英文)在根路径无前缀。 */
export function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/** 把「默认语言下的应用路径」(如 "/docs")改写成当前语言对应的 URL。 */
export function localeHref(path: string, locale: Locale): string {
  const clean = path === "/" ? "" : path;
  return `${localePrefix(locale)}${clean}` || "/";
}

/** 从带前缀的 pathname 剥出 { 语言, 去前缀后的基础路径 }。 */
export function splitLocale(pathname: string): { locale: Locale; basePath: string } {
  const seg = pathname.split("/")[1] ?? "";
  if ((NON_DEFAULT_LOCALES as string[]).includes(seg)) {
    return { locale: seg as Locale, basePath: pathname.slice(seg.length + 1) || "/" };
  }
  return { locale: DEFAULT_LOCALE, basePath: pathname || "/" };
}

type Msg = string | ((...args: never[]) => string);

const zh = {
  // 头部控制
  lang_zh: "中文",
  lang_en: "EN",
  theme_label: "主题",
  theme_system: "跟随系统",
  theme_light: "浅色",
  theme_dark: "深色",
  account_connected: (store: string) => `已连接${store}`,
  sign_out: "退出登录",
  user_fallback: (store: string) => `${store}用户`,

  // 落地页
  store_baidu: "百度网盘",
  store_google: "Google Drive",
  nav_connect: "连接百度网盘",
  nav_connect_google: "使用 Google 继续",
  cta_google: "使用 Google 继续",
  hero_badge: "零知识 · 端到端加密",
  hero_title_1: "你的秘密,",
  hero_title_2: "只有你能打开。",
  hero_subtitle: (store: string) =>
    `KeysArk 是端到端加密的文本保管库。用一组助记词守护一切,密文存进你自己的${store}——除了你,没有人能读到里面的内容。`,
  cta_primary: "连接百度网盘,免费开始",
  cta_secondary: "了解工作原理",
  // 工作原理示意图
  how_title: "工作原理",
  how_subtitle: "明文与密钥只在你的浏览器里;离开设备的,永远只有密文。",
  how_browser_label: "你的浏览器",
  how_browser_note: "助记词、派生密钥、明文都只存在于此,永不上传。",
  how_s1_title: "写下助记词",
  how_s1_body: "生成或输入 BIP39 助记词,它就是你的主密钥。",
  how_s2_title: "本地派生密钥",
  how_s2_body: "助记词在浏览器里派生出 AES-256 密钥。",
  how_s3_title: "浏览器内加密",
  how_s3_body: "明文用 AES-256-GCM 封成密文。",
  how_crossing_label: "仅密文",
  how_cloud_label: "你的网盘",
  how_cloud_note: "只有你的助记词能解开。",
  footer_tagline: (store: string) => `端到端加密 · 存储后端 ${store}`,
  err_state: "登录校验失败,请重试。",
  err_exchange: "授权交换失败,请重试。",
  err_default: "登录出错,请重试。",
  feat_1_tag: "安全",
  feat_1_title: "端到端加密",
  feat_1_body: (store: string) =>
    `内容在浏览器里用 AES-256-GCM 加密后才离开设备,${store}与服务端全程只经手密文——就算被脱库,也读不到一个字。`,
  feat_2_tag: "易用",
  feat_2_title: "助记词即主密钥",
  feat_2_body:
    "只需记住 12 个单词,就能在任何设备解锁——无需注册账号,也没有密钥文件要保管。沿用 BIP39 标准,和 MetaMask 一致。",
  feat_3_tag: "免费",
  feat_3_title: "存在你的网盘",
  feat_3_body: (store: string) =>
    `密文直接存进你自己的${store},用你已有的免费空间——我们不碰你的存储,也不向你收一分钱。`,
  feat_os_tag: "开源",
  feat_os_title: "代码全部公开",
  feat_os_body:
    "全栈代码公开可审计,端到端加密实现可逐行核对,不留后门;无账号、无订阅,还能自行托管。",

  // 开源介绍
  nav_repo: "在 GitHub 上查看",
  os_badge: "开源 · 免费",
  os_title: "一个开源的密钥保管库",
  os_body: (store: string) =>
    `KeysArk 完全开源、永久免费。加密只在你的浏览器里发生,密文存进你自己的${store},代码全部公开可审计——你可以自行托管,也可以用 ark 命令行把 .env、密钥等机密按 GitHub 路径备份再取回。`,
  os_point_open_title: "开放可审计",
  os_point_open_body: "全栈代码公开,端到端加密实现可逐行核对,不留后门。",
  os_point_free_title: "免费无账号",
  os_point_free_body: "没有订阅、没有付费墙;助记词即身份,无需注册。",
  os_point_selfhost_title: "可自行托管",
  os_point_selfhost_body: "整套服务都在仓库里,接上你自己的 OAuth 应用与数据库即可自建。",
  os_cta_repo: "在 GitHub 上查看",
  os_cta_selfhost: "自行托管指南",

  // SEO 元信息
  meta_title: "KeysArk — 开源的端到端加密密码与密钥保管库",
  meta_description: (store: string) =>
    `KeysArk 是开源免费的端到端加密保管库。用 BIP39 助记词在浏览器里派生密钥加密,密文存进你自己的${store};服务端只经手密文,可自行托管。`,
  meta_keywords:
    "密码管理器, 密钥管理, 开源, 端到端加密, 零知识, BIP39, 助记词, Google Drive, 百度网盘, 自托管, 私钥保管, .env 备份",

  // 创建保险库
  create_title: "创建你的保险库",
  create_desc_a: "KeysArk 会生成 24 词助记词作为主密钥。它",
  create_desc_strong: "只显示一次、只存在你这里",
  create_desc_b: "。",
  create_warn_a: "请准备好纸笔。生成后请抄写并妥善保管——",
  create_warn_strong: "丢失即数据永久无法恢复",
  create_warn_b: ",没有任何人(包括我们)能替你找回。",
  btn_generate: "生成助记词",
  copy_hint: "抄写完成后继续,下一步会抽查几个词以确认你已备份。",
  btn_copied: "我已保存,继续",
  confirm_prompt: "请按编号填入对应的词以确认备份:",
  word_nth: (n: number) => `第 ${n} 个`,
  btn_confirm_create: "确认并创建",
  // 助记词遮挡 + PDF 导出
  reveal_hint_obscured: "完整助记词不在屏幕上显示——请下载 PDF 备份并妥善离线保管。",
  pdf_download_btn: "下载 PDF 备份",
  pdf_downloading: "生成中…",
  pdf_downloaded_note: "已下载。请确认安全保存后再继续。",
  pdf_doc_title: "保险库备份",
  pdf_url_label: "访问网址",
  pdf_name_label: "保险库名称",
  pdf_phrase_label: "助记词(主密钥)",
  pdf_risk_title: "风险提示 · 务必阅读",
  pdf_risk_1:
    "这 12 个词是打开保险库的唯一主密钥;任何人拿到它,就能解密你的全部内容。",
  pdf_risk_2: "我们不保存、也无法找回你的助记词。一旦丢失,数据将永久无法恢复。",
  pdf_risk_3:
    "请离线保管本文件:打印或存入加密磁盘。切勿截图、上传云端,或通过聊天、邮件发送。",
  pdf_risk_4: "输入助记词前,务必确认网址与上方一致,谨防钓鱼网站。",
  pdf_generated: (d: string) => `生成时间:${d}`,
  pdf_source: "源码",
  btn_review_again: "再看一遍助记词",
  // 加密 HTML 备份
  backup_more_options: "更多备份方式",
  backup_html_option: "加密 HTML 备份(需备份密码)",
  backup_html_title: "加密 HTML 备份",
  backup_html_desc:
    "生成可离线打开的单文件备份:任意浏览器双击打开,输入备份密码即可查看助记词。加密用 Argon2id + AES-256-GCM,全程在你的浏览器内完成。",
  backup_pw_label: "备份密码",
  backup_html_warn: "丢失备份密码 = 此备份作废,没有任何人(包括我们)能找回。",
  btn_download_html: "加密并下载",
  st_html_export_fail: (e: string) => `加密备份生成失败: ${e}`,
  bk_title: "KeysArk 加密备份",
  bk_prompt: "输入备份密码以解密助记词:",
  bk_btn: "解密",
  bk_decrypting: "解密中 …(约 1 秒)",
  bk_wrong: "密码错误或文件已损坏",
  bk_offline_note: "本文件完全离线工作,不会发出任何网络请求。解密只在你的浏览器内进行。",
  bk_exported_at: (d: string) => `导出时间:${d}`,
  bk_hover_hint: "单词默认遮挡,鼠标悬停(或触摸)逐个查看,谨防旁人窥屏。",
  bk_copy_hint: "分 3 组复制,整条助记词不会一次性进入剪贴板。",
  bk_copy_group: "复制 {a}–{b} 词",
  bk_copied: "已复制 ✓",
  bk_relock: "重新锁定",

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
  unlock_desc: "输入助记词,在本地派生密钥以解密内容。",
  unlock_desc_named: (name: string) =>
    `输入「${name}」的助记词,在本地派生密钥以解密内容。`,
  switch_vault: "切换其他保险库",
  btn_unlock: "解锁",
  new_vault: "新建保险库",
  back_to_unlock: "返回解锁现有保险库",

  // 解锁密码(每库一个,本机凭据)
  pw_set_title: "设置解锁密码",
  pw_set_desc:
    "为本设备设置解锁密码:下次打开时输入密码即可解锁,无需再输助记词。密码经 Argon2id 派生密钥加密保存助记词,绝不以明文存储。",
  pw_new_label: "新密码",
  pw_confirm_label: "确认密码",
  pw_rule_hint: "至少 12 位,含小写/大写/数字/符号中至少 3 类",
  pw_mismatch: "两次输入的密码不一致",
  btn_set_password: "设置密码并进入",
  btn_phrase_continue: "验证并继续",
  pw_unlock_desc: (name: string) => `输入「${name}」的解锁密码。`,
  pw_input_ph: "解锁密码",
  forgot_password: "用助记词解锁",
  back_to_password: "返回密码解锁",
  st_wrong_password: "密码错误",
  st_setting_password: "设置密码中 …",
  st_password_save_failed: "无法在本浏览器保存解锁密码(可能是隐私模式或存储被禁用);请改用普通窗口重试。",
  lock_scope_note: "锁定只清除本机的解密状态;云端登录仍然有效。要彻底断开云端,请用右上角「退出登录」。",
  st_changing_password: "修改密码中 …",
  st_encrypting_backup: "加密中 …",
  pw_strength_0: "太弱",
  pw_strength_1: "弱",
  pw_strength_2: "一般",
  pw_strength_3: "强",
  pw_strength_4: "很强",
  pw_reason_short: "至少 12 位",
  pw_reason_classes: "需含小写/大写/数字/符号中至少 3 类",
  pw_reason_pattern: "过于规律(重复/连续/常见密码),请换一个",

  // CLI 设备码授权页
  cli_auth_title: "CLI 授权",
  cli_auth_desc:
    "一个命令行正在请求访问你的保管库(仅密文搬运权限,等同一份浏览器登录态;你的助记词与明文仍只在本地)。",
  cli_auth_verify_hint: "请核对下方代码与终端里显示的一致,再确认授权:",
  cli_auth_approve: "授权",
  cli_auth_deny: "拒绝",
  cli_auth_login_hint: "请先登录,登录后会自动回到本页继续授权。",
  cli_auth_invalid: "链接无效或已过期。请回到终端重新执行 ark login。",
  cli_auth_approved: "已授权 ✓ 回到终端继续,本页可以关闭。",
  cli_auth_denied: "已拒绝该请求。本页可以关闭。",
  cli_auth_error: "操作失败,请重试。",

  // 内容页导航 + 博客
  nav_about: "关于",
  nav_privacy: "隐私",
  nav_blog: "博客",
  blog_title: "博客",
  blog_subtitle: "关于加密设计、开源理念,以及 KeysArk 背后的种种思考。",
  blog_back: "← 返回博客",

  // 首页 CLI 区 + 命令行客户端
  nav_docs: "文档",
  cli_home_tag: "命令行",
  cli_home_title: "ark —— 终端里的保险库",
  cli_home_body:
    "ark 是 KeysArk 的命令行客户端:在终端登录、导入助记词后即可读写保险库——把 .env、API 密钥、配置直接存取。和网页端一样,加解密只在你的设备上完成,云端只见密文。最适合开发者与脚本 / CI。",
  cli_home_install_hint: "一行安装,跨平台:",
  cli_home_cta: "查看 CLI 文档",

  // CLI 使用文档页
  docs_nav_back: "返回首页",
  docs_title: "ark CLI 使用文档",
  docs_subtitle:
    "在终端里读写你的端到端加密保险库。明文与助记词只留在本地,离开设备的永远只有密文。",
  docs_intro_title: "这是什么",
  docs_intro_body:
    "ark 是 KeysArk 的官方命令行客户端,把网页保险库的能力带到终端:列出条目、按路径读取、保存本地文件、创建与更新条目。所有加解密都在本地用你的助记词完成——服务端与网盘后端全程只经手不透明密文。",
  docs_install_title: "安装",
  docs_install_note: "需要 Node.js 18+。安装后即可使用 ark(以及别名 keysark)命令。",
  docs_setup_title: "首次配置",
  docs_setup_body: "两步:授权这台设备,再导入你的助记词。",
  docs_setup_login_note:
    "ark login 走设备码授权:终端给出一个链接与代码,在浏览器里核对代码并确认。授权态等同一次浏览器登录,只能搬运密文,拿不到你的助记词或明文。",
  docs_setup_import_note:
    "ark import 让你输入助记词,并为本机设置一个解锁密码。助记词经 Argon2id 派生密钥加密后存在本地(~/.keysark),绝不上传;解锁缓存连续 5 分钟无操作即失效,期间无需重复输入密码。",
  docs_commands_title: "命令一览",
  docs_cmd_login: "设备码授权这台设备(会打开浏览器核对)。",
  docs_cmd_import: "导入助记词并设置本机解锁密码。",
  docs_cmd_status: "查看登录与助记词状态。",
  docs_cmd_info: "查看版本、服务端来源与配置目录。",
  docs_cmd_vaults: "列出账号下的所有保险库,并标注助记词是否匹配。",
  docs_cmd_ls: "列出当前保险库里的所有条目。",
  docs_cmd_get: "按路径或 ID 解密读取条目;不带文件名打印到标准输出,带文件名写入文件。",
  docs_cmd_save: "把本地文件(文本或二进制)存进保险库,二进制按文件条目加密存储;在 git 仓库里会按 origin 自动推断目标路径。",
  docs_cmd_sync: "把 vault 文件夹与本地目录按修改时间双向同步(较新的一方覆盖较旧的)。git 仓库里可省略目录,用 origin 匹配;执行前展示方向并确认,保持相对路径。",
  docs_cmd_reset_anchor: "清除某库的回滚保护锚点。仅在你确属有意重置/恢复了该库、且因「index rollback detected」导致读被警告或写被拦时使用;下次载入会以网盘当前版本重新锚定。",
  docs_cmd_logout: "清除本机登录态(保留助记词凭据)。",
  docs_cmd_forget: "删除本机保存的助记词凭据与解锁缓存。",
  docs_options_title: "全局选项",
  docs_opt_server: "覆盖服务端地址(默认 https://keysark.com)。",
  docs_opt_vault: "按 ID 或名称选择保险库(默认取第一个匹配助记词的库)。",
  docs_opt_no_browser: "登录时不自动打开浏览器。",
  docs_examples_title: "常用示例",
  docs_ex_get: "把一个条目解密写到本地文件:",
  docs_ex_save: "在项目目录里把 .env 存进保险库(自动按 git origin 推断路径):",
  docs_ex_ci: "在 CI / 脚本里免交互使用(用环境变量提供助记词):",
  docs_env_title: "环境变量",
  docs_env_server: "服务端地址(等同 --server)。",
  docs_env_mnemonic: "直接提供助记词,跳过本机凭据——适合 CI / 脚本。",
  docs_env_home: "配置目录,默认 ~/.keysark。",
  docs_env_no_browser: "设置后登录时不自动打开浏览器。",
  docs_security_title: "安全说明",
  docs_security_body:
    "助记词、派生主密钥与明文永远不离开你的设备:ark 在本地加解密,只把密文发往服务端与网盘。设备授权态只能搬运密文;即便被泄露,也读不到你保险库里的任何内容。",

  // 修改密码 / 闲置自动锁定
  pw_change_title: "修改密码",
  pw_change_desc: "输入当前密码与新密码。改完后旧密码立即失效,助记词不变。",
  pw_current_label: "当前密码",
  btn_change_password: "确认修改",
  pw_changed: "密码已修改",
  autolock_title: "自动锁定时长",
  autolock_desc: "闲置超过该时长后自动锁定保险库,需重新输入密码解锁。",
  autolock_minutes: (n: number) => `${n} 分钟`,
  autolock_custom_ph: "自定义分钟数",
  btn_apply: "确定",

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
  delete_folder_title: "删除文件夹",
  confirm_delete_folder: (name: string) =>
    `删除文件夹「${name}」?其中的条目与子文件夹会移动到上级目录。`,
  delete_item_title: "删除条目",
  confirm_delete_item: (name: string) =>
    `删除条目「${name}」?此操作不可撤销,删除后无法找回(含全部历史版本)。`,
  delete_confirm_hint: "请输入 delete 以确认此操作。",
  delete_confirm_placeholder: "delete",
  btn_lock: "锁定保险库",
  search_placeholder: "搜索条目…",
  empty_vault: "保险库还是空的,点「+ 新建」开始。",
  empty_search: "没有匹配的条目。",

  // 显示方式 / 排序
  view_flat: "铺平",
  view_folder: "目录",
  view_flat_hint: "所有条目按时间铺平",
  view_folder_hint: "按文件夹分组",
  sort_label: "排序",
  sort_updated_desc: "最近修改",
  sort_updated_asc: "最早修改",
  sort_created_desc: "最近创建",
  sort_created_asc: "最早创建",
  sort_title_asc: "标题 A→Z",
  sort_title_desc: "标题 Z→A",
  bytes_cipher: (n: number) => `${n} 字节(密文)`,
  detail_new: "新建条目",
  field_title: "标题",
  field_title_ph: "给这条起个标题",
  untitled: "未命名",
  field_content: "内容",
  content_ph: "在这里编辑文本(保存时在本地加密)…",
  content_empty: "(空)",
  content_reveal: "点击显示内容",
  content_hide: "重新遮住",
  cli_access: "通过 CLI 下载",
  cli_dialog_title: "用 ark CLI 下载此条目",
  cli_dialog_desc: "ark 是 KeysArk 的命令行客户端:登录 + 导入助记词后即可在终端读写保险库,解密同样只在你的设备上进行。",
  cli_step_install: "安装",
  cli_step_setup: "首次配置(登录 + 导入助记词)",
  cli_step_download: "下载本条目",
  btn_close: "关闭",
  preview_empty: "从左侧选择一个条目,或点「+ 新建」",
  stored_at: (provider: string) => `存于 ${provider}:`,
  storage_label: "存储位置",
  last_edited: (d: string) => `最后编辑 ${d}`,
  open_in_netdisk: (name: string) => `在 ${name} 里打开`,
  provider_baidu: "百度网盘",
  provider_google: "Google Drive",
  btn_edit: "编辑",
  btn_cancel: "取消",
  btn_save: "保存",
  btn_clear: "清空",
  btn_sync: (store: string) => `同步到${store}`,
  sync_now: "立即同步",
  synced: "已同步",
  pending_count: (n: number) => `${n} 项待同步`,
  loading_entries: "加载条目中…",

  // 状态提示
  st_invalid_mnemonic: "助记词无效(请检查每个词与拼写)",
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
  st_saved: (store: string) => `已加密保存并同步到${store}`,
  st_saved_local: (store: string, e: string) => `已存本地,${store}同步失败:${e}`,
  st_save_fail: (e: string) => `保存失败: ${e}`,
  st_deleting: (name: string) => `删除 ${name} …`,
  item_deleted: "条目已删除",
  st_syncing: "同步中 …",
  st_sync_fail: (e: string) => `同步失败: ${e}`,

  // 相对时间(顶栏「已同步 · x 分钟前」)
  time_just_now: "刚刚",
  time_sec_ago: (n: number) => `${n} 秒前`,
  time_min_ago: (n: number) => `${n} 分钟前`,
  time_hour_ago: (n: number) => `${n} 小时前`,
  time_day_ago: (n: number) => `${n} 天前`,
  st_load_fail: (e: string) => `加载列表失败: ${e}`,

  // 文件加密上传
  upload_file: "上传文件",
  file_max_hint: "单文件上限 100MB",
  file_too_large: (max: string) => `文件超过 ${max} 上限,未上传`,
  file_section: "文件",
  file_download: "下载",
  file_size_label: (size: string) => `大小:${size}`,
  st_uploading: (name: string) => `加密上传 ${name} …`,
  st_uploaded: (store: string) => `文件已加密并同步到${store}`,
  st_uploaded_local: (store: string, e: string) => `文件已存本地,${store}同步失败:${e}`,
  st_upload_fail: (e: string) => `上传失败: ${e}`,
  st_downloading: "下载解密中 …",
  st_download_fail: (e: string) => `下载失败: ${e}`,

  // 文件在线预览
  preview_loading: "预览加载中 …",
  preview_unsupported: "该文件类型暂不支持预览,可下载查看",
  preview_too_large: (max: string) => `文件超过 ${max},不预览,可下载查看`,
  preview_decode_fail: "无法以文本解码(可能是二进制文件),可下载查看",
  preview_load_fail: (e: string) => `预览加载失败: ${e}`,
  pdf_page: (n: number, total: number) => `第 ${n} / ${total} 页`,
  pdf_prev: "上一页",
  pdf_next: "下一页",
  pdf_render_fail: "PDF 渲染失败,可下载查看",

  // 历史版本
  history_title: "历史版本",
  history_open: "历史",
  history_close: "关闭",
  history_load_fail: (e: string) => `加载历史失败: ${e}`,
  history_empty: "暂无历史版本",
  version_current: "当前",
  version_restore: "还原此版本",
  version_restored: "已还原为新版本",
  version_count: (n: number) => `${n} 个版本`,
} satisfies Record<string, Msg>;

const en: typeof zh = {
  lang_zh: "中文",
  lang_en: "EN",
  theme_label: "Theme",
  theme_system: "System",
  theme_light: "Light",
  theme_dark: "Dark",
  account_connected: (store: string) => `Connected to ${store}`,
  sign_out: "Sign out",
  user_fallback: (store: string) => `${store} user`,

  store_baidu: "Baidu netdisk",
  store_google: "Google Drive",
  nav_connect: "Connect Baidu",
  nav_connect_google: "Continue with Google",
  cta_google: "Continue with Google",
  hero_badge: "Zero-knowledge · End-to-end encrypted",
  hero_title_1: "Your secrets,",
  hero_title_2: "openable only by you.",
  hero_subtitle: (store: string) =>
    `KeysArk is an end-to-end encrypted text vault. Guard everything with one recovery phrase, with ciphertext stored in your own ${store} — no one but you can read what's inside.`,
  cta_primary: "Connect Baidu — start free",
  cta_secondary: "How it works",
  how_title: "How it works",
  how_subtitle:
    "Your plaintext and key stay in your browser. Only ciphertext ever leaves the device.",
  how_browser_label: "In your browser",
  how_browser_note: "Your phrase, derived key and plaintext live only here — never uploaded.",
  how_s1_title: "Write down your phrase",
  how_s1_body: "Generate or enter a BIP39 recovery phrase — that's your master key.",
  how_s2_title: "Derive the key locally",
  how_s2_body: "The phrase derives an AES-256 key, right in the browser.",
  how_s3_title: "Encrypt in the browser",
  how_s3_body: "Plaintext is sealed with AES-256-GCM.",
  how_crossing_label: "Ciphertext only",
  how_cloud_label: "Your cloud drive",
  how_cloud_note: "Only your recovery phrase can unlock it.",
  footer_tagline: (store: string) => `End-to-end encrypted · Storage backend: ${store}`,
  err_state: "Login verification failed, please try again.",
  err_exchange: "Authorization exchange failed, please try again.",
  err_default: "Login error, please try again.",
  feat_1_tag: "Secure",
  feat_1_title: "End-to-end encrypted",
  feat_1_body: (store: string) =>
    `Content is sealed with AES-256-GCM in your browser before it leaves the device; ${store} and our servers only ever see ciphertext — a breach reveals nothing.`,
  feat_2_tag: "Easy",
  feat_2_title: "Your phrase is the key",
  feat_2_body:
    "Just remember your recovery phrase to unlock on any device — no accounts, no key files to manage. Standard BIP39, importable into MetaMask.",
  feat_3_tag: "Free",
  feat_3_title: "Stored in your netdisk",
  feat_3_body: (store: string) =>
    `Ciphertext goes straight into your own ${store}, using free space you already have — we never touch your storage or charge you.`,
  feat_os_tag: "Open source",
  feat_os_title: "Fully open source",
  feat_os_body:
    "The whole stack is public and auditable — verify the end-to-end crypto line by line, no backdoors. No account, no subscription, and self-hostable.",

  nav_repo: "View on GitHub",
  os_badge: "Open source · Free",
  os_title: "An open-source key vault",
  os_body: (store: string) =>
    `KeysArk is fully open source and free forever. Encryption happens only in your browser, ciphertext is stored in your own ${store}, and every line is public and auditable — self-host it, or use the ark CLI to back up secrets like .env files by their GitHub path and pull them back.`,
  os_point_open_title: "Open & auditable",
  os_point_open_body: "The whole stack is public; the end-to-end crypto can be reviewed line by line. No backdoors.",
  os_point_free_title: "Free, no account",
  os_point_free_body: "No subscription, no paywall. Your recovery phrase is your identity — nothing to sign up for.",
  os_point_selfhost_title: "Self-hostable",
  os_point_selfhost_body: "The entire service lives in the repo. Point it at your own OAuth apps and database and run it yourself.",
  os_cta_repo: "View on GitHub",
  os_cta_selfhost: "Self-hosting guide",

  meta_title: "KeysArk — Open-source end-to-end encrypted password & key vault",
  meta_description: (store: string) =>
    `KeysArk is a free, open-source, end-to-end encrypted vault. Keys are derived from a BIP39 recovery phrase and encryption happens in your browser; ciphertext is stored in your own ${store}. The server only ever handles ciphertext, and you can self-host.`,
  meta_keywords:
    "password manager, key management, open source, end-to-end encryption, zero-knowledge, BIP39, mnemonic, Google Drive, Baidu netdisk, self-hosted, secret storage, .env backup",

  create_title: "Create your vault",
  create_desc_a: "KeysArk generates a 24-word recovery phrase as your master key. It is ",
  create_desc_strong: "shown once and lives only with you",
  create_desc_b: ".",
  create_warn_a: "Have pen and paper ready. After generating, write it down and store it safely — ",
  create_warn_strong: "lose it and your data is gone forever",
  create_warn_b: "; no one (including us) can recover it for you.",
  btn_generate: "Generate phrase",
  copy_hint: "Continue once you've written it down; next we'll spot-check a few words.",
  btn_copied: "I've saved it, continue",
  confirm_prompt: "Enter the words by number to confirm your backup:",
  word_nth: (n: number) => `Word ${n}`,
  btn_confirm_create: "Confirm & create",
  reveal_hint_obscured:
    "The full phrase isn't shown on screen — download the PDF backup and keep it safe offline.",
  pdf_download_btn: "Download PDF backup",
  pdf_downloading: "Generating…",
  pdf_downloaded_note: "Downloaded. Make sure it's safely stored before continuing.",
  pdf_doc_title: "Vault Backup",
  pdf_url_label: "Access URL",
  pdf_name_label: "Vault name",
  pdf_phrase_label: "Recovery phrase (master key)",
  pdf_risk_title: "Important — please read",
  pdf_risk_1:
    "Your recovery phrase is the only master key to your vault; anyone who gets it can decrypt everything you store.",
  pdf_risk_2:
    "We never store and cannot recover your phrase. If you lose it, your data is gone forever.",
  pdf_risk_3:
    "Keep this file offline: print it or store it on an encrypted disk. Never screenshot, upload to the cloud, or send it via chat or email.",
  pdf_risk_4:
    "Before entering your phrase, make sure the URL matches the one above — beware of phishing.",
  pdf_generated: (d: string) => `Generated: ${d}`,
  pdf_source: "Source",
  btn_review_again: "Show the phrase again",
  // Encrypted HTML backup
  backup_more_options: "More backup options",
  backup_html_option: "Encrypted HTML backup (needs a password)",
  backup_html_title: "Encrypted HTML backup",
  backup_html_desc:
    "Generates a single offline file: open it in any browser, enter the backup password to reveal the phrase. Encrypted with Argon2id + AES-256-GCM, entirely in your browser.",
  backup_pw_label: "Backup password",
  backup_html_warn: "Lose the backup password and this backup is useless — no one (including us) can recover it.",
  btn_download_html: "Encrypt & download",
  st_html_export_fail: (e: string) => `encrypted backup failed: ${e}`,
  bk_title: "KeysArk Encrypted Backup",
  bk_prompt: "Enter the backup password to decrypt your phrase:",
  bk_btn: "Decrypt",
  bk_decrypting: "Decrypting… (~1 second)",
  bk_wrong: "Wrong password or corrupted file",
  bk_offline_note: "This file works fully offline and makes no network requests. Decryption happens only in your browser.",
  bk_exported_at: (d: string) => `Exported: ${d}`,
  bk_hover_hint: "Words are masked by default — hover (or tap) to reveal one at a time, beware of shoulder surfing.",
  bk_copy_hint: "Copy in 3 groups so the full phrase never enters the clipboard at once.",
  bk_copy_group: "Copy {a}–{b}",
  bk_copied: "Copied ✓",
  bk_relock: "Lock again",

  select_title: "Choose a vault",
  select_desc: "You have multiple vaults. Pick one and enter its recovery phrase.",
  select_enter_phrase: "Enter phrase to unlock",
  default_vault: "Untitled vault",

  create_label: "Vault name",
  create_label_ph: "e.g. Personal / Work (optional)",

  unlock_title: "Unlock vault",
  unlock_desc: "Enter your recovery phrase to derive the key locally and decrypt.",
  unlock_desc_named: (name: string) =>
    `Enter the recovery phrase for “${name}” to derive the key locally and decrypt.`,
  switch_vault: "Switch to another vault",
  btn_unlock: "Unlock",
  new_vault: "Create new vault",
  back_to_unlock: "Back to unlocking the existing vault",

  // Unlock password (per-vault, local credential)
  pw_set_title: "Set an unlock password",
  pw_set_desc:
    "Set an unlock password for this device: next time, enter it instead of your recovery phrase. The password encrypts your phrase via an Argon2id-derived key — it is never stored in plaintext.",
  pw_new_label: "New password",
  pw_confirm_label: "Confirm password",
  pw_rule_hint: "12+ chars, with 3+ of: lowercase / uppercase / digits / symbols",
  pw_mismatch: "Passwords don't match",
  btn_set_password: "Set password & enter",
  btn_phrase_continue: "Verify & continue",
  pw_unlock_desc: (name: string) => `Enter the unlock password for “${name}”.`,
  pw_input_ph: "Unlock password",
  forgot_password: "Unlock with phrase",
  back_to_password: "Back to password",
  st_wrong_password: "wrong password",
  st_setting_password: "setting password…",
  st_password_save_failed: "Couldn't save the unlock password in this browser (private mode or storage disabled). Try a normal window.",
  lock_scope_note: "Locking only clears this device's decrypted state; your cloud sign-in stays active. Use Sign out (top-right) to fully disconnect.",
  st_changing_password: "changing password…",
  st_encrypting_backup: "encrypting…",
  pw_strength_0: "Too weak",
  pw_strength_1: "Weak",
  pw_strength_2: "Fair",
  pw_strength_3: "Strong",
  pw_strength_4: "Very strong",
  pw_reason_short: "At least 12 characters",
  pw_reason_classes: "Use 3+ of: lowercase / uppercase / digits / symbols",
  pw_reason_pattern: "Too predictable (repeats / sequences / common passwords) — pick another",

  // CLI device authorization page
  cli_auth_title: "Authorize CLI",
  cli_auth_desc:
    "A command line is requesting access to your vault (ciphertext transport only, equivalent to a browser session; your phrase and plaintext stay local).",
  cli_auth_verify_hint: "Confirm the code below matches what your terminal shows, then approve:",
  cli_auth_approve: "Approve",
  cli_auth_deny: "Deny",
  cli_auth_login_hint: "Sign in first — you'll return to this page to continue.",
  cli_auth_invalid: "This link is invalid or expired. Re-run ark login in your terminal.",
  cli_auth_approved: "Approved ✓ Return to your terminal — you can close this page.",
  cli_auth_denied: "Request denied. You can close this page.",
  cli_auth_error: "Something went wrong, please retry.",

  // Content nav + blog
  nav_about: "About",
  nav_privacy: "Privacy",
  nav_blog: "Blog",
  blog_title: "Blog",
  blog_subtitle: "On encryption design, the case for open source, and the thinking behind KeysArk.",
  blog_back: "← Back to blog",

  // Home CLI section + command-line client
  nav_docs: "Docs",
  cli_home_tag: "Command line",
  cli_home_title: "ark — your vault in the terminal",
  cli_home_body:
    "ark is the KeysArk command-line client. Log in and import your phrase, then read and write your vault from the terminal — pull .env files, API keys and configs in and out. Just like the web app, all encryption and decryption happen on your device; the cloud only ever sees ciphertext. Built for developers and scripts / CI.",
  cli_home_install_hint: "One line, cross-platform:",
  cli_home_cta: "Read the CLI docs",

  // CLI documentation page
  docs_nav_back: "Back to home",
  docs_title: "ark CLI documentation",
  docs_subtitle:
    "Read and write your end-to-end encrypted vault from the terminal. Your plaintext and phrase stay local — only ciphertext ever leaves the device.",
  docs_intro_title: "What is it",
  docs_intro_body:
    "ark is the official KeysArk command-line client. It brings the web vault to your terminal: list items, read by path, save local files, create and update entries. All encryption and decryption happen locally with your recovery phrase — the server and cloud backend only ever handle opaque ciphertext.",
  docs_install_title: "Install",
  docs_install_note: "Requires Node.js 18+. Installs the ark command (aliased as keysark).",
  docs_setup_title: "First-time setup",
  docs_setup_body: "Two steps: authorize this device, then import your phrase.",
  docs_setup_login_note:
    "ark login uses device-code authorization: the terminal shows a link and a code; open it in your browser, confirm the code matches, and approve. The grant is equivalent to a browser session — it can only move ciphertext, never your phrase or plaintext.",
  docs_setup_import_note:
    "ark import asks for your recovery phrase and sets a local unlock password. The phrase is encrypted with an Argon2id-derived key and stored locally (~/.keysark) — never uploaded. The unlock stays cached until 5 minutes of inactivity so you needn't retype the password.",
  docs_commands_title: "Command reference",
  docs_cmd_login: "Authorize this device via device code (opens the browser to confirm).",
  docs_cmd_import: "Import a recovery phrase and set a local unlock password.",
  docs_cmd_status: "Show login and phrase status.",
  docs_cmd_info: "Show version, server source and config directory.",
  docs_cmd_vaults: "List all vaults on the account, flagging which match your phrase.",
  docs_cmd_ls: "List all items in the current vault.",
  docs_cmd_get: "Decrypt an item by path or ID; prints to stdout, or writes to a file if one is given.",
  docs_cmd_save: "Save a local file (text or binary; binary is stored as an encrypted file item) into the vault; infers the target path from git origin inside a repo.",
  docs_cmd_sync: "Two-way sync a vault folder with a local directory by mtime (the newer side wins). In a git repo the folder is optional (matched from origin); shows the plan and confirms first, preserving relative paths.",
  docs_cmd_reset_anchor: "Clear a vault's rollback guard. Use only when you intentionally reset/restored the vault and an \"index rollback detected\" warning (reads) or block (writes) appears; the next load re-anchors to the current remote version.",
  docs_cmd_logout: "Clear the local login (keeps the phrase credential).",
  docs_cmd_forget: "Remove the locally stored phrase credential and unlock cache.",
  docs_options_title: "Global options",
  docs_opt_server: "Override the server URL (default https://keysark.com).",
  docs_opt_vault: "Select a vault by ID or label (defaults to the first one matching your phrase).",
  docs_opt_no_browser: "Don't auto-open the browser during login.",
  docs_examples_title: "Common examples",
  docs_ex_get: "Decrypt an item to a local file:",
  docs_ex_save: "From a project directory, save .env into the vault (path inferred from git origin):",
  docs_ex_ci: "Non-interactive use in CI / scripts (phrase supplied via an env var):",
  docs_env_title: "Environment variables",
  docs_env_server: "Server URL (same as --server).",
  docs_env_mnemonic: "Supply the recovery phrase directly, bypassing the local credential — for CI / scripts.",
  docs_env_home: "Config directory, defaults to ~/.keysark.",
  docs_env_no_browser: "When set, login won't auto-open the browser.",
  docs_security_title: "Security",
  docs_security_body:
    "Your phrase, derived master key and plaintext never leave your device: ark encrypts and decrypts locally and only sends ciphertext to the server and cloud. The device grant can only move ciphertext — even if leaked, it reveals nothing inside your vault.",

  // Change password / idle auto-lock
  pw_change_title: "Change password",
  pw_change_desc:
    "Enter your current and new password. The old password stops working immediately; your phrase is unchanged.",
  pw_current_label: "Current password",
  btn_change_password: "Change password",
  pw_changed: "password changed",
  autolock_title: "Auto-lock timeout",
  autolock_desc: "After this long without activity, the vault locks and asks for your password again.",
  autolock_minutes: (n: number) => `${n} min`,
  autolock_custom_ph: "Custom minutes",
  btn_apply: "Apply",

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
  delete_folder_title: "Delete folder",
  confirm_delete_folder: (name: string) =>
    `Delete folder "${name}"? Its items and subfolders will move to the parent.`,
  delete_item_title: "Delete item",
  confirm_delete_item: (name: string) =>
    `Delete item "${name}"? This cannot be undone — it is gone for good, including all version history.`,
  delete_confirm_hint: "Type delete to confirm this action.",
  delete_confirm_placeholder: "delete",
  btn_lock: "Lock vault",
  search_placeholder: "Search items…",
  empty_vault: "Your vault is empty — hit “+ New” to start.",
  empty_search: "No matching items.",

  view_flat: "Flat",
  view_folder: "Folders",
  view_flat_hint: "All items, flattened by time",
  view_folder_hint: "Grouped by folder",
  sort_label: "Sort",
  sort_updated_desc: "Last edited",
  sort_updated_asc: "Oldest edited",
  sort_created_desc: "Newest created",
  sort_created_asc: "Oldest created",
  sort_title_asc: "Title A→Z",
  sort_title_desc: "Title Z→A",
  bytes_cipher: (n: number) => `${n} bytes (ciphertext)`,
  detail_new: "New item",
  field_title: "Title",
  field_title_ph: "Give this entry a title",
  untitled: "Untitled",
  field_content: "Content",
  content_ph: "Edit text here (encrypted locally on save)…",
  content_empty: "(empty)",
  content_reveal: "Click to reveal",
  content_hide: "Hide content",
  cli_access: "Get via CLI",
  cli_dialog_title: "Download this item with the ark CLI",
  cli_dialog_desc: "ark is the KeysArk command-line client. After login + mnemonic import you can read and write your vault from the terminal — decryption still happens only on your device.",
  cli_step_install: "Install",
  cli_step_setup: "One-time setup (login + import mnemonic)",
  cli_step_download: "Download this item",
  btn_close: "Close",
  preview_empty: "Select an item on the left, or hit “+ New”",
  stored_at: (provider: string) => `Stored in ${provider}:`,
  storage_label: "Stored at",
  last_edited: (d: string) => `Last edited ${d}`,
  open_in_netdisk: (name: string) => `Open in ${name}`,
  provider_baidu: "Baidu netdisk",
  provider_google: "Google Drive",
  btn_edit: "Edit",
  btn_cancel: "Cancel",
  btn_save: "Save",
  btn_clear: "Clear",
  btn_sync: (store: string) => `Sync to ${store}`,
  sync_now: "Sync now",
  synced: "Synced",
  pending_count: (n: number) => `${n} pending`,
  loading_entries: "Loading entries…",

  st_invalid_mnemonic: "invalid phrase (check the words and spelling)",
  st_missing_meta: "missing vault metadata",
  st_unlocking: "unlocking…",
  st_mismatch: "phrase doesn't match this vault",
  st_unlock_fail: (e: string) => `unlock failed: ${e}`,
  st_word_mismatch: (n: number) => `word ${n} doesn't match, please re-check your backup`,
  st_creating: "creating vault…",
  st_create_fail: (e: string) => `create failed: ${e}`,
  st_decrypting: (name: string) => `decrypting ${name}…`,
  st_open_fail: (e: string) => `open failed: ${e}`,
  st_saving: "encrypting & saving…",
  st_saved: (store: string) => `encrypted, saved & synced to ${store}`,
  st_saved_local: (store: string, e: string) => `saved locally, ${store} sync failed: ${e}`,
  st_save_fail: (e: string) => `save failed: ${e}`,
  st_deleting: (name: string) => `deleting ${name}…`,
  item_deleted: "item deleted",
  st_syncing: "syncing…",
  st_sync_fail: (e: string) => `sync failed: ${e}`,

  // Relative time (header "Synced · x min ago")
  time_just_now: "just now",
  time_sec_ago: (n: number) => `${n}s ago`,
  time_min_ago: (n: number) => `${n} min ago`,
  time_hour_ago: (n: number) => `${n}h ago`,
  time_day_ago: (n: number) => `${n}d ago`,
  st_load_fail: (e: string) => `failed to load list: ${e}`,

  // Encrypted file upload
  upload_file: "Upload file",
  file_max_hint: "Max 100MB per file",
  file_too_large: (max: string) => `File exceeds the ${max} limit, not uploaded`,
  file_section: "File",
  file_download: "Download",
  file_size_label: (size: string) => `Size: ${size}`,
  st_uploading: (name: string) => `encrypting & uploading ${name} …`,
  st_uploaded: (store: string) => `file encrypted and synced to ${store}`,
  st_uploaded_local: (store: string, e: string) => `file saved locally, ${store} sync failed: ${e}`,
  st_upload_fail: (e: string) => `upload failed: ${e}`,
  st_downloading: "downloading & decrypting …",
  st_download_fail: (e: string) => `download failed: ${e}`,

  // File preview
  preview_loading: "Loading preview …",
  preview_unsupported: "Preview not supported for this file type — download to view",
  preview_too_large: (max: string) => `File exceeds ${max} — download to view`,
  preview_decode_fail: "Cannot decode as text (likely binary) — download to view",
  preview_load_fail: (e: string) => `Preview failed to load: ${e}`,
  pdf_page: (n: number, total: number) => `Page ${n} / ${total}`,
  pdf_prev: "Previous",
  pdf_next: "Next",
  pdf_render_fail: "PDF failed to render — download to view",

  // Version history
  history_title: "Version history",
  history_open: "History",
  history_close: "Close",
  history_load_fail: (e: string) => `Failed to load history: ${e}`,
  history_empty: "No previous versions",
  version_current: "Current",
  version_restore: "Restore this version",
  version_restored: "restored as a new version",
  version_count: (n: number) => `${n} version${n === 1 ? "" : "s"}`,
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
