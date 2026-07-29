# 本地开发手册

## 环境准备

复制 `.env.example` 为 `.env`，至少设置 `DATABASE_URL`、32 字符以上随机 `SESSION_SECRET` 和 `APP_URL=http://localhost:3000`。开发认证文件目录必须位于仓库外部，不能提交真实材料。

```powershell
docker compose up -d db
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

修改 Prisma schema 后创建新的 forward-only migration，不得编辑已经应用的 migration。重置数据库只允许用于确认无重要数据的隔离开发库。

## 常用检查

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx prisma migrate status --config prisma.config.ts
```

端到端测试使用独立数据库，先迁移和 seed，再执行 `npx playwright install chromium` 与 `npm run test:e2e`。也可设置 `PLAYWRIGHT_BASE_URL` 对已经运行的预览环境执行只读烟雾测试。

## 常见问题

- 数据库连接失败：确认 PostgreSQL healthcheck、端口 5432 和 `DATABASE_URL`。
- 登录后立即失效：确认 `SESSION_SECRET` 稳定且所有实例一致。
- API 返回 `FORBIDDEN_ORIGIN`：确认浏览器访问地址与 `APP_URL` 的协议、域名和端口完全一致。
- 邮件未发送：开发环境默认不会替代真实 SMTP 投递；核对全部 `SMTP_*` 变量。
- 认证上传不可用：生产环境按设计关闭本地磁盘上传，不要用公开目录绕过。
