# 平台治理运维手册

本文供获得授权的管理员与值班运维使用。治理操作遵循最小权限、人工复核、证据最少查看和审计仅追加原则；平台不向老师或家长收取信息费，认证完全自愿，未认证不影响浏览、匹配或沟通。账号注册与处置均不使用手机号。

## 1. 上线前检查与管理员引导

1. 按 [`../deployment.md`](../deployment.md) 完成备份、migration 和 schema diff；确认应用使用生产 `SESSION_SECRET` 与受限数据库身份。
2. 认证证据 production storage adapter（生产存储适配器）尚未完成时，必须确认生产上传关闭。`VERIFICATION_UPLOAD_DIR` 不能解除生产硬门。
3. 通过 secret manager（密钥管理器）或 deployment orchestrator（部署编排器）在进程启动前注入三个 `ADMIN_BOOTSTRAP_*` 变量，把 `npm run admin:create` 作为固定的一次性任务命令。不要把值写入 `.env`：脚本在加载 `.env` 前捕获 bootstrap 变量，之后只使用 `.env` 补充的 `DATABASE_URL` 等运行配置，`.env` 中新增或覆盖的 bootstrap 值会被忽略。

   无 secret manager 时，在受控 Windows 终端使用隐藏输入，并在 `finally` 中清除环境变量与 BSTR：

   ```powershell
   $username = Read-Host "管理员用户名"
   $email = Read-Host "管理员邮箱"
   $securePassword = Read-Host "管理员密码" -AsSecureString
   $passwordBstr = [IntPtr]::Zero
   try {
     $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
     $env:ADMIN_BOOTSTRAP_USERNAME = $username
     $env:ADMIN_BOOTSTRAP_EMAIL = $email
     $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
     npm run admin:create
   } finally {
     Remove-Item Env:ADMIN_BOOTSTRAP_USERNAME, Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
     if ($passwordBstr -ne [IntPtr]::Zero) {
       [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
     }
     $securePassword.Dispose()
     $username = $null
     $email = $null
   }
   ```

   PowerShell/Node 仍可能短暂保留托管字符串副本，因此生产优先使用 secret manager。CLI 的 `--password` 仅限隔离开发环境的 synthetic credential（合成凭据）；npm banner、shell history（命令历史）和进程列表会暴露完整参数，真实凭据禁止使用。CLI 与启动前环境变量逐字段合并且 CLI 优先；三项缺一即失败。
4. 脚本只创建 `ADMIN/ACTIVE`，密码使用与登录相同的 Argon2id helper（哈希工具）。发现同角色标准化用户名或邮箱时会拒绝，不会重置既有管理员密码。创建后由账号所有者立即登录验证，再清除临时 secret；不要用脚本轮换密码。

## 2. 值班基本规则

- 每次处置先确认自己仍是 ACTIVE ADMIN，并核对目标、当前状态和更新时间；看到并发冲突时刷新后重新判断，不覆盖另一位管理员的结果。
- 每个提交使用新的 `clientRequestId`。网络重试且意图、目标、`expectedUpdatedAt` 均未改变时复用原 ID；修改理由或决定后生成新 ID。
- 只记录完成判断所需的最少内容。不要把邮箱、证件对象 key、下载 URL、完整私聊正文或无关个人信息复制到备注和外部工单。
- 处置原因使用固定分类（虚假信息、骚扰、收费诈骗、其他）并按需增加简短内部备注；备注写事实、时间和依据，不写推测或侮辱性描述。
- 任何自动处罚、批量处罚或站外联系都不在当前范围内；异常高风险事件先限制访问并升级给两人复核。

## 3. 举报处理 runbook（运行手册）

1. 在举报队列核对举报类型、安全快照、举报人与目标的公开用户名，不通过其他查询扩展收集隐私。
2. `PENDING` 需要调查时转为 `REVIEWING`；事实已清楚时可直接结束。避免让举报长期停留而无负责人。
3. 根据最小必要原则选择结果：
   - 证据不足、重复或不构成违规：`DISMISSED`，`resolutionAction=NONE`，备注说明核对范围。
   - 违规但无需附加措施：`RESOLVED` + `NONE`。
   - 公开老师资料、家教需求或消息本身违规：`RESOLVED` + `CONTENT_TAKEDOWN`。不要对不支持的目标类型使用内容下架。
   - 账号存在明确且持续的严重风险：`RESOLVED` + `ACCOUNT_SUSPENSION`。停用会撤销现有 Session，并下架其公开资料/需求；不得停用当前操作管理员自己。
4. 涉及收费诈骗时保存平台内可验证事实，避免复制支付账号等额外敏感信息。平台不代替警方或支付机构；需要外部协调时按组织事件响应流程升级。
5. 完成后在审计时间线核对出现一条 `REPORT_DECISION`，目标、管理员、时间和结果摘要正确；不要编辑或删除历史审计。

## 4. 自愿认证处理 runbook

1. 认证类型仅为 `STUDENT_STATUS`、`EDUCATION`、`TEACHER_QUALIFICATION`；认证是免费、自愿的，不能因未提交而限制账号功能或降低人工服务等级。
2. 列表不展示证据缩略图。只有确实需要判定时才主动打开证据；每次读取必须重新验证 ACTIVE ADMIN，并产生 `VERIFICATION_EVIDENCE_VIEW` 审计。
3. 核对材料类型与申请类型一致、图片可读且没有明显篡改迹象。不要下载到个人设备、转发或复制对象 key/路径。
4. 符合要求则 `APPROVE`；同类型旧 `APPROVED` 会转为 `EXPIRED`。不符合要求则 `REJECT` 并写清可操作的简短原因，不能暴露内部存储信息。
5. 核对审计中出现 `VERIFICATION_DECISION`。若材料读取失败，不要猜测结论；记录工单编号并交由受限运维排查存储一致性。

## 5. 账号停用、恢复与申诉

- 停用前核对目标不是自己，确认理由分类与证据能支持账号级措施。`SUSPENDED` 会撤销 Session、隐藏公开资料和需求，但保留历史关系与审计。
- 申诉成立、误停或人工复核确认安全后可恢复 `ACTIVE`。恢复不会恢复旧 Session，也不会自动重新发布曾隐藏或被 moderation hold（治理保留）拦截的内容；用户需要重新登录，并按页面要求编辑后再发布。
- `DISABLED` 是停用状态而非删除。不要直接修改数据库绕过后台状态机，不要硬删除账号或历史关联。
- 纠错必须通过新的受控操作和新的审计记录表达；不可回写、删除或伪造旧审计。

## 6. 审计、告警与交接

- `AdminAuditLog` 是 append-only（仅追加）记录，数据库约束拒绝 UPDATE/DELETE。关键动作包括 `USER_STATUS`、`REPORT_DECISION`、`VERIFICATION_DECISION`、`VERIFICATION_EVIDENCE_VIEW`。
- 每班交接核对：未处理举报/认证的最老时间、处于 `REVIEWING` 的举报、当班账号停用/恢复、证据查看异常峰值、重复冲突和失败请求。
- 审计 metadata（元数据）只应包含 payload hash（载荷摘要）与白名单结果摘要。发现邮箱、完整举报正文、密码、密码哈希、数据库 URL、证据 key 或签名 URL 进入日志时，立即限制日志访问并启动隐私事件响应。
- 审计数据库备份与主库一并保护；导出用于调查时加密、限时授权，并登记导出人、目的、范围和销毁时间。

## 7. 安全回滚与故障处理

1. 发布异常先停止新治理写入或回滚应用流量，不运行 `migrate reset`，不删除 migration，不修改 `_prisma_migrations` checksum。
2. 若操作请求超时，先按相同 `clientRequestId` 查询/重试同一意图，让幂等审计判定是否已提交；不要凭 UI 超时重复生成不同 ID。
3. 误停账号用新的恢复操作纠正；旧 Session 保持撤销。误下架内容不直接清空数据库字段，由内容所有者完成一次安全编辑后再发布。错误举报/认证结论需要受权人员复核并以新记录说明，不篡改旧审计。
4. 出现 `COMMIT_UNKNOWN` 或 `CLEANUP_FAILED` 时，把相关申请列入受限对账队列：核对数据库引用与私有对象是否一一对应。在确认未被引用前不得删除对象；修复后记录工单和校验结果。
5. 数据库 schema 故障按部署文档使用备份、forward migration 或经审核的 compensation SQL；恢复演练必须在隔离克隆完成后才可用于生产。

## 8. 测试与演练数据

- 只能在隔离的开发/测试数据库使用 synthetic data（合成数据）。用户名、邮箱、对话、举报、证件图片都必须是虚构内容；禁止复制真实手机号、身份证、学生证、教师证、聊天截图或生产对象。
- 测试私有目录必须是仓库、Git metadata 和公开静态目录之外的绝对路径；Windows 需通过 ACL 仅授权测试进程身份。测试结束清理合成对象与临时 secret。
- 上线前至少演练：举报并发冲突与幂等重试、消息下架变更同步、账号停用后 Session 失效、认证拒绝备注、证据查看审计、production 上传硬关闭、备份恢复与孤儿对象对账。
- 演练记录只保留合成标识、预期/实际结果和非敏感日志；不得为截图方便降低生产权限或开放 bucket。
