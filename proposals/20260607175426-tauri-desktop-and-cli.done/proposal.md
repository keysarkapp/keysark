# Tauri 桌面版 + keysark CLI

> Created: 2026-06-07

## 结论

- 一句话方案:把 vault 数据层抽成 `@keysark/vault`(可插拔 transport + cache,E2E 逻辑共用),桌面端用 Tauri 内置 Node sidecar 跑现有 Next.js 于可配端口(默认 35291)、token 存储本地化为 JSON 文件;`@keysark/cli` 作为**自带 E2E 的密文中转客户端**,默认访问 localhost:35291 管理 items。**桌面 / CLI v1 仅支持 Google Drive,百度后置。**
- 完成的可观测信号:`keysark ls` 在终端列出当前保险库条目标题;`keysark new/get/rm` 与桌面 UI 互见(同一密文、解密一致);本地接口 `:35291/api/files` 只经手密文(明文/助记词/密钥从不出现在 sidecar 与 CLI↔sidecar 流量里);桌面无 Postgres、无外部 DB 依赖。

## 约束(推导依据)

- 硬规则 #3(E2E):主密钥/助记词/明文禁止出现在任何**服务端代码**(含本地接口 :35291)、API 请求/响应体。→ 本地接口只能是**密文中转**(沿用 `/api/files*` 形态);CLI 必须自带 crypto、自派生密钥。**B 方案(桌面持密钥、本地接口发明文 item)被宪法排除**。
- `@keysark/crypto`(`packages/crypto/src/index.ts`)只用 `globalThis.crypto.subtle` + `@noble`/`@scure`,无 `node:crypto` → Node 20+ 直接可跑,CLI 端 crypto 零改动。
- 现有中转/登录逻辑全是 TS:`packages/baidupan`、`packages/googledrive`、`apps/web/src/lib/storage.ts`、`/api/files*`、OAuth 回调(`apps/web/src/app/api/*/callback`)。token 经 `packages/db/src/storage-accounts.ts` 三函数(`get/upsert/update`)走 Drizzle+postgres-js。→ 桌面复用全部 TS,仅在 token 存储这一层换 SQLite。
- vault 数据层现耦合浏览器:`apps/web/src/lib/vault.ts` 硬编码 `fetch('/api/files')` + `window.localStorage` 缓存;`registry.ts` 同理。→ 共用前必须抽 transport/cache 抽象。
- 助记词派生的「记住本设备」存的是浏览器 IndexedDB 里 non-extractable CryptoKey(`apps/web/src/lib/key-store.ts`),CLI 读不到 → CLI 自管 `~/.keysark`。

## 关键决策

- 本地接口 = 密文中转,非明文 item API —— 因硬规则 #3 排除 B;CLI 升格为与浏览器对等的第二个 E2E 客户端。
- 桌面后端 = Node sidecar 复用 Next.js(选 A 不选 Rust 重写)—— 中转/OAuth/网盘逻辑已是 TS,Rust 重写=重复实现 `googledrive`/OAuth;代价(打包 Node 运行时)< 重写成本。
- **v1 仅 Google Drive,百度后置** —— 缩小首版面;且 Google OAuth「桌面应用」客户端类型允许 `http://127.0.0.1:{任意端口}` loopback 回调(端口不参与校验),**可配端口无需逐端口登记 redirect**,直接化解端口/回调冲突。
- token 存储 Postgres→**JSON 文件**(非 SQLite)—— 桌面不能分发 Postgres;v1 只存单个 Google 账号 token,JSON 文件够用且零原生依赖。在 `storage-accounts.ts` 三函数这一层抽接口、注入实现,web 仍 Postgres。
- CLI 密钥自管 `~/.keysark`(选 A 不选共享 keychain)—— 职责清晰、不依赖桌面解锁态;助记词经 `KEYSARK_MNEMONIC`/交互输入,`keysark login` 后落本机加密态。
- 本地接口鉴权约定文件 = **`~/.keysark/local.json`**(桌面写 `{ port, token }`,CLI 读)—— 单一周知路径,两端对齐;CLI 默认端口与 token 都从此文件取,缺失时回退 35291 并报"桌面未运行"。

## Plans 拆分

| 编号 | 标题 | 路径 | 依赖 | 状态 |
|---|---|---|---|---|
| 001 | 抽取共享 vault 数据层 `@keysark/vault` | `plans/001-shared-vault-package.done.md` | - | 已完成 |
| 002 | Tauri 桌面版 + Node sidecar + 本地接口 | `plans/002-tauri-desktop-sidecar.done.md` | 001 | 已完成 |
| 003 | `@keysark/cli` 命令行 | `plans/003-keysark-cli.done.md` | 001, 002 | 已完成 |
