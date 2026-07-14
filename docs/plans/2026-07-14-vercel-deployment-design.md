# Vercel 公网发布设计

## 目标

平台通过 GitHub 自动发布到 Vercel，先使用 Vercel 提供的 HTTPS 公网地址，购买域名后再绑定为正式入口。最终用户只需打开链接；不把 Docker、服务器命令或数据库操作暴露给用户。

## 架构

- Next.js 应用运行在 Vercel，GitHub 的 `codex/development` 或后续 `main` 分支触发部署。
- PostgreSQL 使用 Neon；Production、Preview、Development 使用不同数据库或分支，禁止预览部署写生产库。
- `DATABASE_URL`、`SESSION_SECRET`、`APP_URL` 和 SMTP 凭据放在 Vercel Environment Variables（环境变量）中，不提交到 Git。
- 数据库 migration（迁移）在应用发布前显式执行；失败时不得切换生产流量。
- 首次上线使用 `*.vercel.app` 地址。购买域名后在 Vercel Domains 中添加域名、配置 DNS，并将 `APP_URL` 改为唯一 HTTPS 正式地址。

## 上线边界

首版不依赖 Docker。认证材料上传在生产环境继续关闭，直到私有对象存储和扫描链路完成；密码找回只有配置 SMTP 后才开放。平台内存限流适合单实例 MVP，正式放量前应换成共享限流存储，并确认可信代理头配置。
