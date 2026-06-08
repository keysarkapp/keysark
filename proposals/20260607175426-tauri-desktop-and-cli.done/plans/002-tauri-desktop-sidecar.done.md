# Tauri 桌面版 + Node sidecar + 本地接口

> 来自 proposal: proposals/20260607175426-tauri-desktop-and-cli/

## 目标

- 提供 Tauri 桌面版(**v1 仅 Google Drive**):内置 Node sidecar 运行现有 Next.js 于**可配端口(默认 35291)**,token 存储 Postgres→**JSON 文件**本地化(无外部 DB);本地接口(`/api/files*`)绑 loopback + 本地 token 鉴权,供 webview 与 CLI 共同访问。

## 改动范围

- **新增**:`apps/desktop`(Tauri)
  - Rust shell:启动时拉起 Node sidecar(Next.js standalone 产物 + 随包 Node 运行时),监听配置端口;webview 指向 `localhost:{port}`。
  - 端口配置:配置文件 / 设置页可改,默认 35291;读取顺序 配置 > `KEYSARK_LOCAL_PORT` > 35291;改动需重启 sidecar。
  - 启动后把 `{ port, token }` 写到 **`~/.keysark/local.json`**(loopback 鉴权 token,供 CLI 读 —— 与 003 对齐)。
- **更新**:`packages/db`
  - 在 `storage-accounts.ts` 三函数(`get/upsert/update`)这一层抽 token 存储接口;新增 **JSON 文件实现**(按 `(provider, accountKey)` 存,落本机配置目录);按环境注入(桌面=JSON 文件,web=Postgres)。
- **更新**:`apps/web`(作为 sidecar 运行)
  - 支持 next standalone / 独立 Node server 启动,端口取配置;仅启用 **Google 登录**(百度入口在桌面 v1 隐藏)。
  - OAuth:用 Google「桌面应用」客户端类型,redirect 走 `http://127.0.0.1:{port}/api/google/callback`;loopback 任意端口被 Google 接受,**可配端口无需逐端口登记**。
  - 本地接口鉴权中间件:仅 loopback + 校验本地 token,拒绝跨源/无 token 请求(防本地他进程与 DNS-rebinding 滥用中转)。鉴权层只保护密文中转端点,**不引入任何明文/密钥**。

## 验收

- [ ] 桌面应用启动后 webview 可完成 Google 登录并正常读写保险库。
- [ ] `curl -H '<local-token>' localhost:35291/api/files?dir=` 通过鉴权返回密文文件列表;无 token 被拒。
- [ ] `~/.keysark/local.json` 在桌面启动后存在且含 `{ port, token }`。
- [ ] 改端口配置并重启后,webview、本地接口、`local.json` 都切到新端口。
- [ ] 桌面运行不依赖 Postgres(token 落 JSON 文件)。
- [ ] `pnpm -r typecheck` 通过。

## 关键点

- Node sidecar 打包是最易翻车点:`next build`(standalone)产物 + Node 运行时需随 Tauri 分发并由 Rust 正确拉起 / 退出回收。
- Google OAuth 需用「桌面应用」客户端类型才允许 loopback 动态端口;沿用 web 的「Web 应用」客户端会因 redirect 不匹配失败。
- token 存储接口要抽干净,避免 `db` import 散落各处导致 web/desktop 走岔实现。
- `~/.keysark/local.json` 的路径/字段必须与 003 CLI 严格一致。

---

## 实施日志

- **执行时间**:2026-06-07 18:40
- **整体状态**:已完成(GUI/native 构建按 pre-flight 约定留手动)

### 做了什么
- **可插拔 token 存储**(`packages/db`):`db.ts` 改惰性 `getDb()`(无 DATABASE_URL 不再 import 即抛);新增 `token-store.ts`(接口 + 按 `KEYSARK_TOKEN_STORE` 分派)、`token-store-postgres.ts`(原 Drizzle 逻辑,惰性连接)、`token-store-json.ts`(本地 JSON 文件,0600,`KEYSARK_TOKEN_FILE` 或 `~/.keysark/tokens.json`);`storage-accounts.ts` 改为委托,新增 `listStorageAccounts()`;`index.ts` 导出 `getDb`/`listStorageAccounts`。
- **本地接口无 cookie 鉴权**(`apps/web`):`google.ts` 抽出 `getConnectedGoogleBySub()`;`storage.ts` 抽出 `wrapGoogle()` + 新增 `getConnectedStorageByLocalAuth(request)`(校验 `x-keysark-token` → 按唯一 Google 账号解析)+ `getStorageForRequest(request)`(先 cookie 后本地 token);`/api/files` 与 `/api/files/content` 改用 `getStorageForRequest`。
- **桌面 v1 隐藏百度**:`Landing` 加 `hideBaidu`,`page.tsx` 按 `KEYSARK_DESKTOP===1` 传入;launcher 设该环境变量。
- **sidecar**:`next.config.ts` 加 `KEYSARK_STANDALONE` 触发 standalone(+ transpile `@keysark/vault`);`apps/desktop/sidecar/launch.mjs`(定端口 desktop.json>env>35291、生成 token、写 `~/.keysark/local.json`、配 `GOOGLE_REDIRECT_URI`/`HOSTNAME=127.0.0.1`、起 server.js)、`paths.mjs`、`scripts/bundle-sidecar.mjs`。
- **Tauri 外壳脚手架**:`apps/desktop/src-tauri/`(Cargo.toml、tauri.conf.json、build.rs、`src/lib.rs` 拉起 sidecar+等就绪+导航窗口、main.rs、capabilities/default.json)+ README。

### 验收核对
- [x] 本地接口鉴权(实测 standalone sidecar HTTP):无 token / 错 token → 401;有效 token + 伪造 Google 账号 → 502(Google「Invalid Credentials」)证明 token→唯一账号→client→中转 全链路打通。
- [x] `~/.keysark/local.json` 由 launcher 写出含 `{port, token}`(实测:KEYSARK_LOCAL_PORT=40000 → port=40000 + 随机 token,0600)。
- [x] 不依赖 Postgres:standalone server 在 `KEYSARK_TOKEN_STORE=json` 下启动、首页 200、token 存储 JSON 往返(实测,全程无 DATABASE_URL)。
- [x] standalone 产物:`KEYSARK_STANDALONE=1 next build` 产出 `.next/standalone/apps/web/server.js`;launcher/bundle 路径对齐。
- [x] `pnpm -r typecheck` 通过;云端 `next build`(非 standalone)回归通过。
- [~] 桌面 GUI 启动 + 真实 Google 登录 + 改端口重启后 webview 同步切换 —— **需手动验证**(无 GUI/交互式 OAuth;按 pre-flight 约定)。

### 偏差与遗留
- Tauri Rust 外壳为**脚手架,未 cargo check**:缺图标(`icons/icon.png`)与 `gen/` schema,`tauri::generate_context!` 会因此失败。开发机用 `tauri icon <png>` 生成图标 + 首次 `tauri build`/`dev` 生成 schema 后即可构建。`src/lib.rs` 进程管理与窗口导航逻辑已按 Tauri v2 API 写就。README 已记完成步骤。
- `resolvePort`/端口切换的「webview 同步」由 Rust 侧 `resolve_port()` 读同一 `desktop.json` 保证(代码已写),但需 GUI 运行验证。
- baidu 仍保留在 web/packages(云端双后端不变);桌面仅在落地页隐藏入口 + 本地鉴权只解析 google。
