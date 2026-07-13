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
