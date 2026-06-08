# `@keysark/cli` 命令行

> 来自 proposal: proposals/20260607175426-tauri-desktop-and-cli/

## 目标

- 提供 `keysark` 命令行(`apps/cli`,包名 `@keysark/cli`),装到本地即得 `keysark` 命令;默认访问 `localhost:35291` 的密文中转,**自带 E2E**:从 `~/.keysark` / 环境变量取助记词派生密钥,本地加解密,通过命令管理 items。

## 改动范围

- **新增**:`apps/cli`(bin: `keysark`)
  - 数据层用 `@keysark/vault` + HTTP `StorageTransport`(→ `localhost:{port}/api/files*`,带本地鉴权 token);`CacheStore` 用 `~/.keysark` 文件实现或 no-op。
  - 密钥来源:`KEYSARK_MNEMONIC` 环境变量 / 交互输入;`keysark login` 用 verifier 校验后,把派生密钥(或加密的助记词)落 `~/.keysark`(本机加密态);`keysark logout` 清除。
  - 命令(聚焦 items):`login` / `logout` / `vaults`(列+选)/ `ls` / `get <id>` / `new` / `set <id>`(改标题/内容)/ `rm <id>` / `sync`。
  - 选项:`--port` / `KEYSARK_PORT`、`--vault`;端口与本地鉴权 token 默认读 **`~/.keysark/local.json`**(桌面写出,与 002 对齐),缺失时回退 35291 并提示"桌面未运行"。`--port` 显式覆盖。

## 验收

- [ ] `keysark ls` 列出当前保险库条目(标题 + id)。
- [ ] `keysark new` / `get` / `rm` 往返一致;新建/改动后桌面 UI 可见同一条目(同密文、解密一致)。
- [ ] 助记词错误时 verifier 校验失败,拒绝任何读写。
- [ ] `localhost:{port}` 不可达 / 鉴权失败时报清晰错误,不静默。
- [ ] CLI 发往 `:35291` 的请求体只含密文 —— 明文/助记词/派生密钥从不离开 CLI 进程。

## 关键点

- CLI 进程是唯一接触明文与密钥的地方,**绝不**把它们发往 `:35291`(只发 envelope 密文)—— 这是 E2E 不变量在 CLI 侧的落点。
- 多保险库:用各库 verifier 对派生密钥做匹配来选库;`--vault` 显式指定。
- 端口/本地鉴权 token 从 `~/.keysark/local.json` 读取,路径/字段必须与 002 严格一致,否则 CLI 连不上。
- v1 仅 Google Drive(经 :35291 中转,CLI 无需感知具体后端)。
- `~/.keysark` 落盘的密钥/助记词需本机加密,避免明文驻留磁盘。

---

## 实施日志

- **执行时间**:2026-06-07 18:55
- **整体状态**:已完成(逻辑全验;活 Google 跨端互见留手动)

### 做了什么
- 新增 `apps/cli`(`@keysark/cli`,bin `keysark`),esbuild bundle 到 `dist/keysark.mjs`(带 shebang,纯 Node 可跑):
  - `config.ts`:读 `~/.keysark/local.json` 取 `{port, token}`,`--port`/`KEYSARK_PORT` 覆盖,缺失回退 35291 + 提示桌面未运行;`KEYSARK_HOME` 可改 keysark 目录(测试用)。
  - `transport.ts`:`httpTransport(baseUrl, token)` 实现 `StorageTransport`,打 `/api/files*` 带 `x-keysark-token`,401/错误有清晰中文提示。
  - `session.ts`:助记词来源 env(`KEYSARK_MNEMONIC`)> 本机会话 > 交互输入;会话用「设备密钥」(`~/.keysark/device.key`,32 随机字节 0600)AES-256-GCM 加密助记词存 `session.json`(0600)。
  - `vault-select.ts`:读 `keysark.json`(兼容 legacy `.keysark.json`),按 verifier 把派生密钥匹配到保险库;内存缓存。
  - `cli.ts`:命令 `login/logout/vaults/ls/get/new/set/rm/sync` + `--port/--vault/--title/--content/--folder`,id 支持前缀匹配,`new`/`set` 内容支持 stdin。
- 依赖仅 `@keysark/crypto` + `@keysark/vault`(复用 001 数据层),零 CLI 框架。

### 验收核对
- [x] `keysark ls` 列出条目(短 id + 时间 + 标题)—— mock relay E2E 实测。
- [x] `new`/`get`/`rm` 往返一致:built bin 对内存中转跑通,`get` 正确解密多行中文内容;`rm` 后 `ls` 为空。
- [x] 助记词错误 → verifier 校验失败,拒绝读写(实测「不匹配任何保险库」)。
- [x] 本机会话:`saveSession`→`acquireMnemonic` 解回同一助记词,`logout` 清除(实测)。
- [x] localhost 不可达/鉴权失败 → 清晰错误(transport 401 提示 + `ready()` 失败信息;401 路径在 002 实测)。
- [x] CLI 发往 :35291 只含密文:`Vault.save` 先加密再 upload(transport 只传 envelope;001 已证 index/items 为信封且不泄明文)。
- [~] 与桌面 UI 真实 Google 互见(同密文解密一致)—— **需手动验证**(需活 Google 账号)。

### 偏差与遗留
- E2E 验证用内存 mock relay 代替活 Google(pre-flight ④ 约定):证明了 CLI↔transport↔vault↔crypto 全链路;唯一未跑的是真实 Google 中转。
- `dist/` 为 esbuild 产物;发布前可加 `prepublishOnly` 跑 build。esbuild postinstall 被 pnpm 拦截但 bundle 正常(走平台 optional-dep 二进制)。
