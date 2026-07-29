# 邻师到家

面向老师和家长的免费双向家教选择平台。双方可按地区生活圈浏览公开资料与需求，通过结构化招呼建立联系，再进入站内聊天；公开页面不会展示手机号、邮箱等直接联系方式。

## 技术栈

Next.js 16、React 19、TypeScript、PostgreSQL、Prisma、Vitest 和 Playwright。

## 本地开发

需要 Node.js、npm、Docker Desktop（仅用于本地 PostgreSQL，可用已有 PostgreSQL 替代）和 Git。

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

浏览器打开 `http://localhost:3000`。环境变量含义及故障处理见 [本地开发手册](docs/operations/local-development.md)。

## 行政区划数据

省—市—区县三级选择使用精确锁定的 `@province-city-china/level@8.5.8` 数据快照，上游提交为 `ca2ada5ea608b57c7b0178aa568ced6e363b57f7`。执行 `npm run db:seed` 会幂等写入 33 个可完成三级选择的省级入口、343 个城市层和 3034 个区县/授课圈；快照中已经移除的旧地区只会被停用，不会删除或破坏已有业务记录。

转换规则位于 `prisma/region-data.ts`：过滤“市辖区”占位项；为直辖市、港澳补齐界面需要的城市层；东莞、中山、儋州等不设县级行政区的城市提供“全市”授课圈。上游对台湾只提供省级代码而没有区县明细，因此当前不展示无法完成三级选择的台湾入口。

## 验证

```powershell
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Playwright 首次运行前执行 `npx playwright install chromium`。端到端测试会创建并注销临时账号，必须连接隔离的测试数据库，不得指向生产库。

## 公网发布

生产环境使用 Docker Compose 在一台 Linux VPS 上运行 Next.js、PostgreSQL 和 Caddy。Caddy 自动配置 HTTPS，部署完成后访客只需打开正式域名，不需要安装 Docker。完整步骤见 [Docker 部署手册](docs/operations/deployment.md)。

生产发布前必须配置高强度 `SESSION_SECRET`、独立生产数据库、准确的 HTTPS `APP_URL`，并建立异机备份；密码找回需要 SMTP，认证材料上传需要私有对象存储，缺失时相关能力应保持关闭。

管理员不能公开注册。数据库迁移完成后，通过受控环境变量执行：

```powershell
npm run admin:create
```

迁移恢复契约见 [数据库部署说明](docs/deployment.md)，审核操作见 [审核手册](docs/operations/moderation.md)。
