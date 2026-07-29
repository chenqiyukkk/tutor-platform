# Docker 单服务器发布设计

## 目标

平台部署在一台云服务器上，最终用户只访问 HTTPS 域名。服务器内部使用 Docker Compose 管理应用、PostgreSQL 和 Caddy，避免用户或运营人员在个人电脑安装运行环境。

## 组件与数据流

公网请求先到 Caddy，由 Caddy 自动管理 TLS 证书并转发给只绑定本机端口的 Next.js app。app 通过 Docker 私有网络连接 PostgreSQL；数据库不映射宿主机公网端口。每次发布先运行一次性 prepare 容器，只有 migration 和基础数据 seed 成功，app 才允许启动。

应用镜像使用 multi-stage build（多阶段构建）：builder 生成 Next.js standalone 制品，runner 只携带运行文件并以非 root 用户启动。migration 阶段保留 Prisma CLI，但不进入最终 app 镜像。

## 安全与运维边界

生产密钥放入权限为 600 的 `.env.production`，该文件不进入 Git 或镜像。公网只开放 80/443 与受控 SSH；3000 仅绑定 `127.0.0.1`，5432 完全不映射。PostgreSQL 数据、Caddy 证书使用独立 volume，数据库备份必须复制到服务器外并定期恢复演练。

域名和 VPS 仍需由用户购买；部署完成后访客无需理解 Docker。SMTP 和生产认证材料对象存储仍是独立上线门槛。
