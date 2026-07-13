# 受控站内消息设计

聊天只服务于已经接受打招呼的老师与家长。服务端始终从 realm session 得到 actor，不接受 senderId；每次读取或写入都重新确认账号 ACTIVE、角色匹配、Conversation 成员关系，以及 Greeting/Request/参与者的一致性。历史消息在双方屏蔽后仍可读取，但发送在共享的 sorted account-pair advisory lock 内重新检查双向 Block，避免发送与屏蔽竞态。

消息正文按 Unicode code point 计数，trim 后为 1..1000，内部换行原样保留。`clientMessageId` 是严格 UUID，并以 `(conversationId, clientMessageId)` 实现幂等：同一发送人和正文返回原 DTO，任何载荷或发送人冲突返回 `CONFLICT`。发送成功同时更新 `Conversation.lastMessageAt`。

历史分页使用 `{sentAt,id}` Base64URL cursor，`before` 向旧消息翻页，数据库降序取数后以 chronological asc 返回；轮询使用 `after` 只取新消息。会话列表按 `COALESCE(lastMessageAt,createdAt) DESC,id` 稳定分页，未读数只统计对方发送且 `readAt IS NULL` 的消息。read endpoint 只用服务器时间标记对方消息。

前端延续米白纸张、墨绿墨迹、朱红印章的公共布告栏语言，不用渐变。桌面为会话索引与信笺线程双栏，移动端一次显示一栏并提供返回列表。页面可见时以 2 秒短轮询；隐藏暂停，恢复立即拉取。AbortController 与 generation 隔离过期响应，网络失败按 2/4/8 秒递增到 30 秒，成功复位。optimistic 消息以 clientMessageId 对账替换，失败状态可重试且不重复。
