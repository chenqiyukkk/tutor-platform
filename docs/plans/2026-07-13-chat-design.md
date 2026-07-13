# 受控站内消息设计

聊天只服务于已经接受打招呼的老师与家长。服务端始终从 realm session 得到 actor，不接受 senderId；每次读取或写入都重新确认账号 ACTIVE、角色匹配、Conversation 成员关系，以及 Greeting/Request/参与者的一致性。历史消息在双方屏蔽后仍可读取，但发送在共享的 sorted account-pair advisory lock 内重新检查双向 Block，避免发送与屏蔽竞态。

消息正文按 Unicode code point 计数，trim 后为 1..1000，内部换行原样保留。`clientMessageId` 是严格 UUID，并以 `(conversationId, clientMessageId)` 实现幂等：同一发送人和正文返回原 DTO，任何载荷或发送人冲突返回 `CONFLICT`。发送成功同时更新 `Conversation.lastMessageAt`。

历史分页使用 `{sentAt,id}` Base64URL cursor，`before` 向旧消息翻页，数据库降序取数后以 chronological asc 返回；原有 `after` 规格保留，空历史以 Epoch + nil UUID 建立不会漏掉延迟提交消息的游标。UI 的 canonical 轮询改用互斥的 `changesAfter={updatedAt,id}`：初始 history 在 account-pair lock 事务内、锁后建立 server-time + nil UUID watermark，后续按 `updatedAt,id` 顺序返回完整安全 DTO，因此新增、已读、编辑和删除状态都可收敛。所有未来 edit/delete 写入必须沿用相同 pair lock 并显式更新 `Message.updatedAt`。

会话列表按 `COALESCE(lastMessageAt,createdAt) DESC,id` 稳定分页，未读数只统计对方发送且 `readAt IS NULL` 的消息，并返回任一方向的 `blocked` 状态。read endpoint 接受本次页面实际呈现的 1..100 个唯一 message UUID，只在 pair lock 内用服务器时间更新这些会话内、由对方发送且仍未读的消息；未呈现的并发消息不会被误标。Conversation block endpoint 在同一 pair lock 内幂等 upsert actor→counterpart，历史继续可读、composer 禁用。

前端延续米白纸张、墨绿墨迹、朱红印章的公共布告栏语言，不用渐变。桌面为会话索引与信笺线程双栏，移动端一次显示一栏并提供返回列表，select/back 明确转移焦点，消息记录使用 polite live region。消息 change poll 与会话首 100 条 poll 各自拥有独立 timer/controller/generation；页面隐藏分别 abort 并暂停，恢复立即拉取，失败按 2/4/8 秒递增到 30 秒，成功复位。会话 poll 与已加载旧页按 ID 去重合并后重新排序，不重置 selected/thread。optimistic 消息与 change DTO 都以 clientMessageId 对账替换，失败状态可重试且不重复；旧消息分页错误单独呈现，不影响 composer。
