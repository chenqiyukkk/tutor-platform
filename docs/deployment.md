# 部署与数据库迁移契约

本项目把 `prisma/migrations` 视为数据库变更历史的唯一源码。已在共享、测试或生产数据库执行过的 migration 不得改名、删除或修改；任何修正都必须新增 forward-only migration（只向前迁移）。

## 发布顺序：migrate before app

生产发布必须遵守以下顺序：

1. 确认目标 `DATABASE_URL`，创建可验证恢复的备份，并停止会写入待迁移表的旧任务；不兼容变更需要进入维护或只读窗口。
2. 使用与待发布应用相同的 commit / image 执行：

   ```powershell
   npx prisma migrate status --config prisma.config.ts
   npx prisma migrate deploy --config prisma.config.ts
   npx prisma migrate status --config prisma.config.ts
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```

3. 只有当 `migrate deploy` 成功、`migrate status` 无 pending / failed migration，且数据库到 `schema.prisma` 的 diff 为空后，才可启动新版本实例或把流量切到新版本。
4. 任一步失败都必须中止应用切换并保留日志。先判断 migration 是否未开始、已回滚或部分执行，再按审核后的恢复方案处理；不得用应用重启掩盖数据库失败。

因此，部署流水线必须把数据库 migration 设为应用 rollout 的硬前置条件。禁止先启动依赖新列、新约束或新数据不变量的应用，再“稍后补跑” migration。`migrate deploy` 不会生成 Prisma Client，也不会替代 build 阶段。

## 外部既有数据库的无损接入

外部数据库可能已经包含业务数据和一部分目标 schema，却没有本仓库完整的 `_prisma_migrations` 历史。此时只能 baseline（基线化），不能重建数据库。

1. 停止写入，完成备份与恢复演练；所有调查先在生产只读连接或完整克隆上进行。
2. 保存以下证据：数据库 schema dump、`_prisma_migrations` 全表、当前 migration 目录、每个发布制品中的 migration 目录，以及 `migrate status` / `migrate diff` 输出。
3. 用 `prisma db pull` 和 `prisma migrate diff` 核对实际 schema。人工复核 enum、index、constraint、trigger、自定义 SQL 与关键数据回填，不能只比较 Prisma model。
4. 对数据库中已经真实存在效果、但 migration history 缺失的历史前缀，逐个按时间顺序执行：

   ```powershell
   npx prisma migrate resolve --applied <migration_name> --config prisma.config.ts
   ```

   `resolve --applied` 只登记历史，不执行 SQL；仅当该 migration 的全部 schema 与 data effect 已被证明存在时才能使用。缺少任何效果时，应先编写并审核新的补偿 migration，而不是伪造“已应用”。
5. baseline 完成后重新执行 `migrate status`、DB→schema diff 和关键数据校验，再执行 pending forward migrations。

如果是一个从未使用 Prisma Migrate 的既有库，应在隔离分支中从实际 schema 生成并审核 baseline migration，再用 `migrate resolve --applied` 标记；baseline 和后续 migration 必须一并纳入版本控制。

## 旧 checksum 或失败 migration

当状态检查报告已应用 migration 的 checksum 与仓库文件不一致时：

- 首选从当时的 release artifact 或受保护的 source-control tag 恢复完全相同的历史 `migration.sql`。随后把期望变更放进新的 forward migration。
- 不得为了消除告警而编辑 `_prisma_migrations.checksum`，也不得把不同 SQL 冒充同一 migration。
- `migrate resolve --rolled-back <name>` 只能用于数据库已确认回滚或已人工还原的 failed migration；修复 SQL 后再由 `migrate deploy` 重试。
- `migrate resolve --applied <name>` 只能用于 failed / baseline 场景中，且全部 SQL effect 已经存在。它不是覆盖一个成功 migration checksum 的通用开关。
- 如果旧 SQL 已永久丢失，不能从 checksum 反推出原文件。必须停止自动发布，在克隆库中完成 schema、约束和数据 effect 审计，制定经评审的 baseline / compensation 方案；在证据不足时不得继续 `resolve`。

## 生产禁令

以下命令不得连接生产或任何包含不可丢失数据的数据库：

```powershell
npx prisma migrate reset
npx prisma migrate reset --force
npx prisma db push --accept-data-loss
```

`migrate reset` 会删除并重建 PostgreSQL schema，属于开发库专用命令。生产故障恢复必须使用备份、forward migration、经过验证的 compensation SQL，以及必要时严格受控的 `migrate resolve`；绝不以 reset 处理 checksum、drift 或 failed migration。

## 管理员首次引导

公开注册只允许老师和家长；管理员只能由有数据库发布权限的运维人员在受控终端显式创建。先完成 migration，再由 secret manager（密钥管理器）或 deployment orchestrator（部署编排器）在 `npm` 进程启动前注入 `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_EMAIL`、`ADMIN_BOOTSTRAP_PASSWORD`，并把 `npm run admin:create` 设为该一次性任务的固定命令。三项值不得出现在命令参数、任务定义明文或本地 `.env` 中；脚本会在加载 `.env` 前捕获三项变量，`.env` 只能补充 `DATABASE_URL` 等运行配置，其中的 bootstrap 值会被忽略。

无法使用 secret manager 时，可在受控 Windows 终端临时隐藏输入。以下示例不把密码写进命令行；`finally` 会清除子进程环境并零化非托管 BSTR 缓冲区：

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

PowerShell/Node 运行时仍可能短暂保留托管字符串副本，因此该方式只是受控终端兜底，不能替代 secret manager。CLI（command-line interface，命令行接口）的 `--password` 仅允许隔离开发环境使用 synthetic credential（合成凭据）；npm banner、shell history 和进程列表可能回显完整参数，真实管理员凭据禁止通过 CLI 传递。同一字段同时出现时 CLI 值优先。脚本没有默认凭据，只创建 `ADMIN/ACTIVE` 账号；若同为管理员角色的标准化用户名或邮箱已存在，则拒绝执行并且绝不更新密码。完整轮值与处置流程见 [`operations/moderation.md`](operations/moderation.md)。

## 认证证据存储是生产硬门

当前实现的 `VERIFICATION_UPLOAD_DIR` 只用于开发/测试私有目录，并在 `NODE_ENV=production` 时由代码硬关闭。生产环境即使配置该变量也不得开放上传；发布验收必须确认老师认证页不渲染文件输入，上传 API 返回“功能未开放”。

只有在以下能力全部落地、通过安全评审和恢复演练后，才能以新的 production storage adapter（生产存储适配器）显式开放：

- 私有对象存储默认拒绝公开访问，应用与管理员使用最小权限 IAM（identity and access management，身份与访问管理），静态与传输加密开启；
- 上传先完成 MIME/magic byte、大小、像素和安全解码校验，再经过恶意文件扫描；对象 key、路径和签名 URL 不进入列表、日志或公开 DTO；
- 管理员仅在 ACTIVE ADMIN 二次鉴权后按需下载，响应 `no-store`、`attachment`、`nosniff`，查看行为写 append-only（仅追加）审计；
- 明确保留期、删除任务、备份范围、密钥轮换、访问告警和孤儿对象对账，并完成故障与泄露响应演练。

任一项缺失，认证申请仍可展示“暂未开放”，不能以本地磁盘、公开 bucket（存储桶）或长效 URL 临时绕过。
