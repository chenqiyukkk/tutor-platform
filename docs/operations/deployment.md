# Vercel + Neon 公网部署

## 1. 创建云资源

1. 在 Vercel 导入 GitHub 仓库 `chenqiyukkk/tutor-platform`，Framework Preset 保持 Next.js。
2. 在 Neon 创建 PostgreSQL 项目，分别准备 Production、Preview 和 Development 数据库或分支；不要让预览部署写生产数据。
3. 在 Vercel 为各环境设置 `DATABASE_URL`、`SESSION_SECRET` 和 `APP_URL`。生产 `APP_URL` 必须是唯一正式 HTTPS 地址。

Vercel 可直接构建 Next.js，不需要 Dockerfile。首次上线可先把 `APP_URL` 设为 Vercel 分配的生产域名。

## 2. 迁移与基础数据

在切换生产流量前，从与目标 commit 一致的受控发布环境执行：

```powershell
npx prisma migrate status --config prisma.config.ts
npx prisma migrate deploy --config prisma.config.ts
npm run db:seed
npx prisma migrate status --config prisma.config.ts
```

迁移失败必须停止发布；不要把 `migrate reset` 或 `db push --accept-data-loss` 连接生产数据库。详细恢复契约见 `docs/deployment.md`。

## 3. 绑定域名

在 Vercel Project → Settings → Domains 添加购买的域名，按界面提示在域名注册商配置 A/CNAME 记录。Vercel 验证成功并签发 HTTPS 证书后：

1. 将 Production 的 `APP_URL` 改为 `https://你的域名`，不带尾部斜杠；
2. 重新部署；
3. 验证登录、注销、密码重置链接和所有写 API 不出现 `FORBIDDEN_ORIGIN`；
4. 只保留一个 canonical（规范）生产域名，其他域名重定向到它。

## 4. 上线硬门

- SMTP：生产密码找回前必须配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM` 并验证 SPF/DKIM。
- 认证材料：当前 production adapter 不接受本地文件上传。只有私有对象存储、短效授权、恶意文件扫描、审计与删除策略完成后才能开放。
- 限流：当前内存限流是 MVP 保护，在 Vercel 多实例间不共享。正式放量前迁移到 Redis/Upstash 等共享限流存储，并仅信任平台提供的代理来源信息。
- 日志：不得记录密码、Cookie、Token、邮箱、认证证据 key 或完整数据库 URL。
- 审计：每次发布运行 unit/integration、E2E、typecheck、lint、build 和高危依赖审计。

中国大陆正式运营若未来迁移到境内服务器，应在开站前依法办理 ICP 备案；Vercel 路线用于快速公网验证，不等同于境内备案部署。
