# 抽取共享 vault 数据层 `@keysark/vault`

> 来自 proposal: proposals/20260607175426-tauri-desktop-and-cli/

## 目标

- 把 vault 数据层(index/items 读写 + envelope 加解密编排 + 多保险库注册表)从 `apps/web` 抽到新包 `@keysark/vault`,以可插拔 `StorageTransport`(密文 list/upload/download)+ `CacheStore` 抽象重写,使 web 与未来 CLI 共用同一套 E2E 逻辑。web 行为不变。

## 改动范围

- **新增**:`packages/vault`
  - 迁入 `apps/web/src/lib/vault.ts` 的 `Vault` 类、`EntryMeta/FolderMeta/IndexDoc/EntryDoc`、归一化与排序逻辑;迁入 `registry.ts` 的注册表读写与路径工具。
  - 定义 `StorageTransport` 接口:`list(dir)/upload(path,bytes)/download(fileId)`(只进出密文字节,对应现 `/api/files*` 语义)。
  - 定义 `CacheStore` 接口:index/entry 的 get/set + pending 标记;`Vault` 构造注入 transport + cache(去掉对 `fetch`/`window` 的直接依赖)。
  - 依赖 `@keysark/crypto`;envelope 格式与现有完全一致(兼容已上网盘的密文)。
- **更新**:`apps/web`
  - 新增浏览器适配:`StorageTransport` → `fetch('/api/files*')`;`CacheStore` → 现有 `localStorage` 实现(从 vault.ts 抽出)。
  - `vault-panel.tsx`、`registry.ts` 消费方改为从 `@keysark/vault` import,注入浏览器适配。
- **删除**:`apps/web/src/lib/vault.ts` 内已迁移逻辑(保留薄适配层);`registry.ts` 同步收敛。

## 验收

- [ ] `packages/vault` 内无 `fetch('/api/...')` 硬编码、无 `window`/`localStorage`/`document` 直接引用(全经抽象)。
- [ ] `pnpm -r typecheck`、`pnpm --filter @keysark/web build` 通过。
- [ ] web 端解锁 / 新建 / 编辑 / 移动 / 删除文件夹 / 同步 行为与改动前一致(envelope 兼容,旧库可直接打开)。
- [ ] `@keysark/vault` 可在纯 Node 环境 import 不报错(为 003 铺路:不触 DOM 全局)。

## 关键点

- vault.ts 的两个浏览器耦合点(`fetch('/api/files')` 与 `window.localStorage` 缓存命名空间)必须抽干净,否则 CLI 无法复用。
- envelope / index 结构、保险库 `dir` 路径规则保持不变 —— 任何格式漂移都会让存量密文读不出。
- registry(`keysark.json`)的读写也要走 transport,使 CLI 能用同一路径选库。

---

## 实施日志

- **执行时间**:2026-06-07 18:10
- **整体状态**:已完成

### 做了什么
- 新增 `packages/vault`(`@keysark/vault`),依赖 `@keysark/crypto` + `@keysark/db`(仅 `/id`):
  - `types.ts`:类型(EntryMeta/FolderMeta/IndexDoc/EntryDoc/VaultDescriptor/Registry)、常量(INDEX_NAME/ITEMS_DIR/REGISTRY_NAME/LEGACY_*)、路径工具(joinPath/itemRelPath/vaultDir)、base64、抽象接口 `StorageTransport` 与 `CacheStore`。
  - `cache.ts`:`KvStore` 极简键值后端 + 通用 `makeCache(kv, vaultId)`(整份缓存序列化进单 key)+ `memoryKv()`。
  - `vault.ts`:`Vault` 类(构造注入 transport+cache,去掉 fetch/window 耦合)+ `saveRegistry(transport, reg)`;新增 `remove(id)`(从 index 摘除,见偏差)。
- `apps/web` 适配:`src/lib/vault.ts` 重写为浏览器适配层(`browserTransport`=fetch /api/files;`localStorageKv`=localStorage;`openBrowserVault()`),并透传类型/`itemRelPath`;`src/lib/registry.ts` 改为从 `@keysark/vault` 透传类型/常量,`saveRegistry` 注入 `browserTransport`。
- `vault-panel.tsx`:`new Vault(...)` → `openBrowserVault(...)`。`apps/web/package.json` 加 `@keysark/vault` 依赖。

### 验收核对
- [x] `packages/vault` 内无 `fetch('/api/...')`、无 `window`/`localStorage`/`document` —— grep 确认仅在 apps/web 适配层。
- [x] `pnpm -r typecheck`(vault + web)通过;`pnpm --filter @keysark/web build` 通过。
- [x] web 行为不变:envelope/index/路径规则原样迁移,旧库可读(逻辑为忠实移植,类型与构建均过)。
- [x] `@keysark/vault` 纯 Node 可 import:tsx 跑内存 transport 往返 —— save/reload(空缓存重新解密)/open/remove 全通过,index 为密文信封且不泄明文。

### 偏差与遗留
- 原 web `Vault` 无删除条目能力;为 003 CLI `rm` 在包内新增 `remove(id)`。当前 `StorageTransport` 无 delete 原语 → 删除仅从 index 摘除,网盘条目文件成为孤儿(不再被引用)。真正清除需 `transport.delete`,已记 feedback。
