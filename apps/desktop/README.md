# @keysark/desktop

Tauri 桌面外壳 + Node sidecar(本地跑 Next.js)。**v1 仅 Google Drive。**

## 架构

```
Tauri (Rust)  ──spawn──▶  node sidecar/launch.mjs  ──▶  Next.js standalone :35291
   │ 等端口就绪                    │ 写 ~/.keysark/local.json {port,token}
   └─ 窗口指向 http://127.0.0.1:{port}   绑 127.0.0.1(loopback only)
                                          token 存储 = JSON 文件(~/.keysark/tokens.json)
CLI ──读 ~/.keysark/local.json──▶ 同一本地接口 /api/files*(带 x-keysark-token)
```

- 本地接口 = **密文中转**(沿用 `/api/files*`)。明文/助记词/主密钥从不经手(硬规则 #3)。
- 端口可配:`~/.keysark/desktop.json` 的 `port` > `KEYSARK_LOCAL_PORT` > 35291。改后重启。

## 状态(本轮交付)

**已实现并验证(TS):**
- 可插拔 token 存储:`@keysark/db` 按 `KEYSARK_TOKEN_STORE=json` 切到本地 JSON 文件(`token-store-json.ts`),web 仍 Postgres。
- 本地接口无 cookie 鉴权:`getStorageForRequest()`(`apps/web/src/lib/storage.ts`)先 cookie 后 `x-keysark-token`,按桌面唯一 Google 账号解析。`/api/files*` 已接入。
- sidecar 启动器 `sidecar/launch.mjs`:定端口 + 生成 token + 写 `local.json` + 配 `GOOGLE_REDIRECT_URI` + 起 standalone。
- `next.config.ts`:`KEYSARK_STANDALONE=1` 时输出 standalone;打包脚本 `scripts/bundle-sidecar.mjs`。

**脚手架,需在开发机用 Tauri CLI 收尾(本环境无法构建 GUI):**
- `src-tauri/`(Cargo.toml / tauri.conf.json / src/lib.rs 进程管理 + 窗口导航 / capabilities)。
- 缺图标与 `gen/` schema → 跑 `pnpm --filter @keysark/desktop exec tauri icon <png>` 生成图标;首次 `tauri build`/`tauri dev` 会生成 schema。

## 构建(开发机)

```bash
pnpm --filter @keysark/desktop build:web        # KEYSARK_STANDALONE=1 next build
pnpm --filter @keysark/desktop bundle:sidecar    # 收拢 standalone + launcher 到 src-tauri/sidecar
pnpm --filter @keysark/desktop exec tauri build  # 出桌面包(需 Rust + 平台依赖)
```

## Google OAuth(重要)

桌面必须用 Google **「桌面应用 / Desktop app」** 客户端类型(非 Web 应用):它允许 `http://127.0.0.1:{任意端口}` loopback 回调,**可配端口无需逐端口登记 redirect**。把该 client 的 `GOOGLE_CLIENT_ID/SECRET` 提供给 sidecar(打进桌面构建的 env 或 `~/.keysark/desktop.json`)。
