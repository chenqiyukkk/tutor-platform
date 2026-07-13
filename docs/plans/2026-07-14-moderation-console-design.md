# 家教平台治理与认证设计

**日期：** 2026-07-14

**状态：** 已根据总设计、Task 12 实施要求和现有代码审计确认

**范围：** 举报、通用屏蔽、老师自愿认证、管理员治理后台和不可变审计

## 1. 目标与边界

Task 12 要把现有的举报、屏蔽、认证和管理员数据骨架变成可用的治理闭环，同时坚持“免费双向选择、隐私优先、不向用户收信息费”的产品原则。

本阶段包含：

- 老师和家长从自己有权查看的资料、需求、招呼、会话或消息发起举报/屏蔽。
- 老师自愿提交学生身份、学历或教师资格材料；未提交不影响浏览、匹配和沟通。
- 管理员处理用户、举报和认证队列，可下架内容或停用账号。
- 所有管理员变更在同一事务内写入一条幂等、仅追加的审计记录。
- 管理员页面提供密集但清晰的桌面表格和移动卡片视图。

本阶段不包含：

- 举报后自动处罚、自动拉黑或机器判责。
- 管理员细分 RBAC、批量处罚、站内警告通知系统。
- 生产环境本地证件存储。未接入私有对象存储和恶意文件扫描时，生产上传必须关闭。
- 图片以外的认证材料。MVP 只接收 JPEG/PNG，最大 5 MiB；PDF 留待生产扫描链路完成后再开放。

## 2. 选择的方案

### 2.1 举报目标：服务端派生，而不是信任账号 ID

客户端只提交判别式目标：

- `teacher_profile(profileId)`
- `tutoring_request(requestId)`
- `greeting(greetingId)`
- `conversation(conversationId)`
- `message(messageId)`

API 不接受 `reportedAccountId` 或 `blockedAccountId`。服务端验证当前账号能否看到目标后，从真实关系记录派生对方账号、规范化外键和安全快照。对不存在与无权访问统一返回 404，防止 IDOR 和账号枚举。举报自己的资料、需求或消息必须拒绝。

举报只创建待审记录，不自动拉黑；屏蔽只创建 `Block`，不自动创建举报。响应只返回举报 ID、状态或 `blocked: true`，不暴露对方账号 ID。

### 2.2 管理后台：独立队列页，而不是大一统收件箱

沿用现有 `(portal)` 路由组：

- `/admin/dashboard`
- `/admin/users`
- `/admin/reports`
- `/admin/verifications`

桌面使用侧栏、语义化表格和路由化筛选；移动端使用横向导航和 `<ol>/<dl>` 卡片。详情与破坏性操作使用原生 `<dialog>`，原因必填，提交时禁用重复操作，关闭后恢复触发按钮焦点。

管理操作带 `clientRequestId` 和 `expectedUpdatedAt`：同一网络请求重试只生成一条审计；并发审核只有一方成功，另一方得到 409 并刷新。

### 2.3 认证材料：开发私有本地存储，生产硬关闭

老师认证独立放在 `/teacher/verification`，不塞进公开简历表单。页面明确说明“完全自愿、原件永不公开”。

开发/测试环境可使用 `VERIFICATION_UPLOAD_DIR` 指向 `public/` 和 Git 工作树之外的私有目录。上传后在服务端解码并重新编码图片，去除 EXIF/定位信息，再使用随机 key 保存。数据库只保存私有 evidence metadata；老师 DTO 和管理员列表均不返回路径、对象 key 或签名 URL。

`NODE_ENV=production` 时不得回退到本地目录。没有私有对象存储适配器时，服务端返回功能未开放，页面不渲染文件输入。管理员主动下载证据时重新校验 ACTIVE ADMIN，响应使用 `no-store`、attachment 和 `nosniff`。

## 3. 数据模型与数据库约束

新增一个前向 migration，不修改已推送 migration。

`Report` 墽量字段：

- `targetType`：`ACCOUNT | TEACHER_PROFILE | TUTORING_REQUEST | GREETING | CONVERSATION | MESSAGE`
- `targetId`：规范化 UUID
- `clientRequestId`：用户请求幂等键（旧记录可空）
- `targetSnapshot`：举报时用户实际可见内容的安全快照
- `resolutionAction`：`NONE | CONTENT_TAKEDOWN | ACCOUNT_SUSPENSION`

数据库回填既有 greeting report 的 target type/id；增加 `(reporterAccountId, clientRequestId)` 唯一约束和“同一举报人、同一目标只能有一条 PENDING/REVIEWING”部分唯一索引。CHECK 约束保证 target type 与规范化外键一致，但允许 message 同时带 conversation、request 等上下文外键。

`Verification` 增加可空 `clientRequestId` 并建立账号内唯一约束；建立 `(accountId, type) WHERE status='PENDING'` 部分唯一索引，关闭并发重复提交。

`AdminAuditLog` 增加唯一 `requestId`。数据库触发器拒绝 UPDATE/DELETE，确保审计 append-only。每个管理员 API 请求只写一条顶层审计，内部包含白名单化结果摘要，不复制邮箱、证件信息、完整举报正文或文件 key。

`TeacherProfile` 和 `TutoringRequest` 增加私有 `moderationRejectedAt`、`moderationReason`。管理员下架时清除公开状态并置安全版本为 0；原拥有者必须先保存一次编辑，repository 才清除 hold，之后才能重新发布。直接对被下架内容调用 publish 返回冲突。

## 4. 服务与锁顺序

### 4.1 公共治理服务

`createReport` 在 Repeatable Read 事务中：

1. 校验 ACTIVE teacher/parent actor。
2. 解析目标并验证可见性/成员关系。
3. 派生被举报账号与规范化关系。
4. 拒绝自我举报。
5. 生成只含当时可见字段的 snapshot。
6. 按 `clientRequestId` 幂等创建 Report。

`createBlock` 必须先取得现有 `greeting-pair:<sorted UUIDs>` advisory lock，再验证双方仍有效并 upsert Block。举报和屏蔽相互独立。

现有 greeting pending report 继续保持“创建 Report + Greeting 变为 REPORTED”的原子事务，但补齐新的 target 字段与 snapshot。聊天 message report 不改变 Message，也不把举报内容广播给对方。

### 4.2 管理服务

所有读取和变更都重新验证 ACTIVE ADMIN，不能只依赖 layout。

- 用户状态：锁 Account，禁止管理员停用自己；停用时同事务更新状态、撤销 Session、下架公开资料/需求并写审计。ACTIVE 恢复不会恢复旧 Session。
- 举报：通过 `expectedUpdatedAt` 防并发覆盖。状态为 PENDING → REVIEWING → RESOLVED/DISMISSED；允许从 PENDING 直接结束。
- 内容下架：老师资料或需求设置 moderation hold；消息删除必须先取得 account pair lock，再锁 Message，写 `deletedAt/updatedAt`，由现有 trigger 自动推进 `changeVersion`。
- 账号停用：Report 解决、账号状态与 Session 撤销在一个事务完成，只写一个幂等审计请求。
- 认证：锁 Verification；APPROVE 时验证老师账号/档案有效并让同类型旧 APPROVED 变为 EXPIRED；REJECT 必须写 review note。

全局锁序继续遵守：account pair advisory lock → interaction/context → public graph rows → target row。任何管理员消息下架不得先锁 Report 后再等待 pair lock；必须在事务前读取不可变目标定位，先拿 pair lock，再锁 Report/Message。

## 5. API 与隐私

公共 API：

- `POST /api/reports?realm=teacher|parent`
- `POST /api/blocks?realm=teacher|parent`
- `GET/POST /api/teacher/verifications`

管理员 API：

- `PATCH /api/admin/reports/[id]`
- `PATCH /api/admin/users/[id]`
- `PATCH /api/admin/verifications/[id]`
- `GET /api/admin/verifications/[id]/evidence`

JSON 请求统一使用现有 `readLimitedJson`；multipart 先检查 Content-Length，再校验 File.size、magic bytes、解码像素上限和重新编码结果。所有治理与认证响应 `Cache-Control: no-store`。Task 13 将统一加入 Origin/CSRF 校验、限流和安全 headers；Task 12 不复制一套临时安全中间件。

## 6. 页面与可访问性

后台不使用无意义图表。Dashboard 只显示待办计数、最老待办和最近审计。

列表要求：

- URL 中只放 status/role/page 等非敏感筛选。
- 桌面 `<table>` 有 caption 和 `th scope`；移动卡片与表格信息一致，隐藏的一套从 accessibility tree 移除。
- 状态包含文字，不只依赖颜色。
- 空状态区分“队列清空”和“筛选无结果”。
- 整张表不设 live region；操作结果使用单独 `aria-live=polite`。
- 操作成功导致行消失时，把焦点移到结果标题并播报。

认证证据不生成缩略图、不默认预取。管理员必须主动打开详情后才能下载；查看证据也写审计。

## 7. 测试与完成标准

- 每一种 public target 都验证所有权、成员关系、self-report 和 DTO 脱敏。
- 举报不自动屏蔽；屏蔽后 greeting/chat 发送继续由已有 pair-lock 规则阻止。
- 相同 clientRequestId 重试不重复 Report/Audit/副作用；冲突 payload 返回 409。
- 并发审核只有一方成功。
- 停用账号同事务撤 Session、隐藏内容、写审计；现有 Session 立即失效。
- 消息下架被 change polling 捕获且不会破坏 pair-lock 顺序。
- Production 禁止 local storage；伪造 MIME、错误 magic、超限、路径穿越和 DB 失败清理都有测试。
- 列表/DOM/响应中不存在账号 ID、邮箱、证据路径或对象 key。
- Admin dialog、焦点恢复、loading/error/empty、桌面表格和移动卡片通过组件测试。
- Migration upgrade、Prisma validate/status/diff、全量测试、typecheck、lint、build 全绿。
