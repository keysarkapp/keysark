# Feedback

执行 proposal 期间冒出的、未在当前会话处理的事项。收尾后由用户决定要不要新开 proposal / plan 处理。

---

## [plans/001-shared-vault-package] StorageTransport 缺 delete 原语

- **类型**:范围外发现 / 设计调整
- **位置**:`packages/vault/src/types.ts`(StorageTransport)、`packages/vault/src/vault.ts`(remove)、`apps/web/src/app/api/files/route.ts`
- **描述**:`Vault.remove()` 只从 index 摘除条目,网盘上的条目文件成为孤儿(不再被引用,但占空间且仍是密文驻留)。当前 transport 只有 list/upload/download,无 delete;`/api/files` 也无 DELETE,百度/Google 客户端是否暴露删除未确认。
- **建议**:给 `StorageTransport` 加 `delete(path|fileId)`,`/api/files` 加 DELETE,baidupan/googledrive 各补删除实现,`remove()` 真正清除条目文件。待决策:删除失败的回退策略(标记 pending-delete?)。
