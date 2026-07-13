# Chat Task 11 质量修复实施计划

> 日期：2026-07-13
> 范围：仅修复 Task 11 聊天质量问题，不引入新依赖或 WebSocket。

## 目标架构

后端继续以 PostgreSQL + Prisma 为唯一事实源。所有会改变双方消息可见状态的写操作都在 canonical account-pair lock 内完成；历史分页保留 `sentAt,id` 游标，状态变更轮询新增 `updatedAt,id` 游标。聊天页面分别运行消息变更轮询和会话列表轮询，两者都遵守可见性、AbortController、generation 与指数退避规则。

> 后续修订：`20260713133800_chat_message_change_version` 已用 trigger 内 pair lock 后分配的 `BIGINT changeVersion` 取代本计划中的 `updatedAt,id` 状态游标；最终契约以 `2026-07-13-chat-design.md` 和 `2026-07-13-chat-change-version-plan.md` 为准。

## 提交一：数据库、service 与 API

### RED

- 在 schema 测试中规定 `changesAfter` canonical cursor，以及 `before/after/changesAfter` 三选一。
- 在 service 单元测试中规定空历史 `nextAfterCursor` 永远为 Epoch + nil UUID，且 `loadConversation` 关系校验合并为一条参数化 raw JOIN；单次消息读取预算约为 actor + context + message 三条 SQL。
- 在 PostgreSQL integration 测试中用真实未提交事务证明：旧 `sentAt` 消息在初始空查询之后提交，仍可经 `after` 取到。
- 在 integration 测试中规定精准 `messageIds` 已读、未呈现并发消息不得误标、change polling 可看到新增/已读/删除状态，以及 block/send 通过产品 service 串行化。
- 在 route 测试中规定 read/block 的 16KB strict JSON、UUID 数组 1..100 去重和稳定错误映射。
- 在 migration 测试中规定 `Message.updatedAt`、回填表达式、三列索引，以及删除 Conversation 旧普通索引。

### GREEN

- 新增 forward migration `20260713133700_chat_message_change_polling`；Prisma schema 同步 `updatedAt` 和索引。
- 抽取共享 conversation relation raw query / safe DTO helper；保留既有错误语义。
- 初始历史读取在 pair lock 事务内建立安全 `nextChangesCursor`；`changesAfter` 返回完整安全 DTO，`hasMore` 用于立即续拉。
- `sendMessage` 与精准 `markRead` 在 pair lock 后显式写同一 server time 到 `updatedAt`；保留原 `after` 规格。
- 新增幂等 `blockConversation` service 与 `/api/conversations/[id]/block`；会话 DTO 返回任一方向 `blocked`。

## 提交二：轮询 UI、可访问性与文案

### RED

- 页面测试规定 read 请求只携带本次实际返回且未读的对方消息 UUID，并覆盖 initial / poll / older。
- 页面测试规定消息 UI 使用 `changesAfter`，按 `clientMessageId` 合并 full DTO，立即续拉 `hasMore`，更新“已读”和删除正文。
- 页面测试规定会话首 100 条每 2 秒轮询；hidden 暂停、resume 立即、失败 2/4/8/16/30 秒退避；与已加载旧页去重、按 activity/id 重排且不重置当前 thread。
- 页面测试规定 load older 独立报错不禁用 composer，消息区域 `aria-live`，mobile select/back 恢复正确焦点。
- 页面测试规定 header 屏蔽 dialog 的原因、确认、焦点恢复与成功后 composer 禁用/历史可读。
- greeting 测试规定 ACCEPTED 文案链接到正确 realm 的站内消息；空聊天安全文案允许确认后自主交换联系方式，但禁止信息费与站外付费。

### GREEN

- 抽取小型可复用 polling/merge helper，控制 ChatWorkspace 体积。
- UI 使用 change cursor；精准提交 read IDs；conversation polling 合并并稳定排序。
- 独立呈现旧消息错误；补齐 aria-live 与 focus 管理。
- 增加可访问 block dialog；成功后保留历史并禁用 composer。
- 更新 greeting、空态和设计文档。

## 验证

- chat schema/service/route/UI unit tests。
- chat PostgreSQL integration tests、greeting tests。
- 完整 migration upgrade；`prisma validate`、`migrate status`、`migrate diff`。
- `npm run typecheck`、`npm run lint`、`npm run build`、工作树与 diff 检查。
