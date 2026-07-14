# Docker + VPS 公网部署

部署完成后，访客只需打开 `https://你的域名`。Docker、PostgreSQL 和 Caddy 都只运行在云服务器内部。

## 架构与前置条件

- 一台安装 Docker Engine 与 Docker Compose Plugin 的 Linux VPS；
- 域名的 A/AAAA 记录指向服务器公网 IP；
- 防火墙仅向公网开放 SSH、80 和 443，禁止开放 3000 与 5432；
- 一处与服务器分离的加密备份存储。

`compose.production.yaml` 启动四个服务：`db` 保存数据，`prepare` 在每次发布前执行 migration 和幂等 seed，`app` 运行非 root 的 Next.js standalone 镜像，`caddy` 反向代理并自动申请和续期 HTTPS 证书。只有 Caddy 直接接收公网流量。

## 首次部署

在服务器克隆公开仓库并切换到发布分支：

```bash
git clone https://github.com/chenqiyukkk/tutor-platform.git
cd tutor-platform
git switch codex/development
cp .env.production.example .env.production
chmod 600 .env.production
```

编辑 `.env.production`：

- `DOMAIN` 是不含协议的域名，例如 `tutor.example.com`；
- `APP_URL` 必须是对应的唯一 HTTPS 地址，例如 `https://tutor.example.com`；
- `POSTGRES_PASSWORD` 使用 `openssl rand -hex 24` 生成；
- `DATABASE_URL` 使用相同密码，格式为 `postgresql://tutor:密码@db:5432/tutor_platform?schema=public`；
- `SESSION_SECRET` 使用 `openssl rand -base64 48` 生成；
- `TLS_EMAIL` 用于证书到期与安全通知。

确认 DNS 已指向服务器，再执行：

```bash
docker compose --env-file .env.production -f compose.production.yaml config
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 prepare app caddy
```

`prepare` 必须以状态 0 退出，`app` 必须 healthy，Caddy 日志必须显示证书签发成功。随后访问正式域名，验证注册、登录、注销、地区目录和写请求。

## 更新发布

```bash
git fetch origin
git switch codex/development
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d
```

应用只有在 `prepare` 的 migration 与 seed 成功后才会启动。migration 失败时查看日志、停止发布并按 `docs/deployment.md` 的恢复契约处理；禁止对生产库执行 `migrate reset`。

## 备份和恢复

至少每日执行 PostgreSQL 自定义格式备份，并把备份复制到另一台服务器或私有对象存储。定期在隔离数据库演练恢复；没有恢复演练的备份不视为可用备份。

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T db \
  pg_dump -U tutor -d tutor_platform -Fc > tutor-platform.dump
```

恢复前必须停止应用写入、保留当前库快照并核对目标数据库。不要在未确认目标的情况下覆盖生产库。

## 上线硬门

- 密码找回：配置全部 `SMTP_*` 变量并验证 SPF、DKIM 后再开放。
- 认证材料：当前生产环境继续关闭本地磁盘上传；私有对象存储、扫描、审计和删除链路完成前不得绕过。
- 限流：当前内存限流适合单应用实例；扩容为多实例前换成共享 Redis 限流。
- 运维：使用 SSH key，关闭密码登录，安装安全更新，轮换密钥，并监控磁盘、数据库、容器重启和证书状态。
- 日志：不得记录密码、Cookie、Token、邮箱、认证证据 key 或完整数据库 URL。

若服务器位于中国大陆，正式开站前仍需依法完成 ICP 备案及适用的其他手续。
