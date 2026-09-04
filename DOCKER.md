# AI 数字化咨询中心 - Docker 部署说明

本目录提供一个**容器化**部署版本，封装 PostgreSQL/pgvector + Node/Express API + 静态前端，使单台主机即可跑起整个系统。

> 与 `DEPLOYMENT.md` 的 systemd 部署并行存在，互不冲突；Docker 版本专注于**自包含、可移植**。

## 1. 环境要求

- Docker Engine **20.10+**
- Docker Compose **v2** （`docker compose` 命令，不是 `docker-compose`）
- 主机端口：默认 3001（应用）、5432（数据库，可改）

## 2. 一键启动

```bash
cd /opt/ai-consulting-center          # 项目根目录
cp .env.example config/.env           # 把生产配置放到 ./config/.env（已挂载进容器）
docker compose up -d --build
```

启动过程：

1. 构建镜像（首次约 3-8 分钟，含 `npm ci` + tsc + vite）。
2. Postgres 启动并自动应用 `data/migrations/*.sql`，启用 `uuid-ossp` / `pg_trgm` / `pgvector`。
3. App 容器等到 postgres healthy 后启动，监听 `0.0.0.0:3001`。
4. 健康检查 `curl http://localhost:3001/health`。

访问：

- 应用 API：`http://localhost:3001/api/...`
- 前端静态资源（由 Express 托管，已 build）：访问 `http://localhost:3001/` 或配反向代理 `/ai/`。

## 3. 配置

### 3.1 容器外 `.env` 路径

`docker-compose.yml` 默认从 `./config/.env` 挂载到 `/app/.env`：

```
config/.env      # chmod 600
```

### 3.2 模板

```bash
cp .env.example config/.env
chmod 600 config/.env
# 至少需要 DATABASE_URL / JWT_SECRET，参考 .env.example
```

### 3.3 容器编排侧变量（`docker-compose.yml` 顶部）

可覆盖：

| 变量 | 默认 | 说明 |
|------|------|------|
| `POSTGRES_PORT` | 5432 | Postgres 主机端口 |
| `POSTGRES_PASSWORD` | change_me_strong_password | **必须**修改 |
| `APP_PORT` | 3001 | App 暴露给主机的端口 |
| `JWT_SECRET` | please_change_to_a_long_random_secret | **必须**长随机串 |
| `DEFAULT_MODEL` | demo | demo / openai / ollama |
| `OPENAI_*` / `OLLAMA_*` | 见文件 | 模型网关 |

## 4. 数据持久化

卷命名空间（由 Compose 自动管理）：

| 卷 | 容器内路径 | 内容 |
|----|-------------|------|
| `pgdata` | `/var/lib/postgresql/data` | Postgres 数据 |
| `app-data` | `/app/data` | 运行时数据 / JSON fallback |
| `app-uploads` | `/app/data/uploads` | 上传文件 |
| `app-templates` | `/app/templates` | DOCX/PPTX 模板 |

查看与备份：

```bash
docker volume ls | grep ai-consulting-center
docker run --rm -v ai-consulting-center_pgdata:/data -v $(pwd):/backup alpine \
  tar czf /backup/pgdata-$(date +%F).tgz -C /data .
```

## 5. 迁移与升级

### 5.1 数据库迁移

迁移文件位于 `data/migrations/*.sql`，按文件名字典序执行。
新镜像构建时**不会**重复执行（容器首次创建 PG 才跑 initdb）。
后续增量迁移需手工执行：

```bash
docker compose exec -T postgres psql -U ai_center -d ai_consult \
  -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/migrations/036_xxx.sql
```

### 5.2 应用升级

```bash
git pull
docker compose build app
docker compose up -d app
```

健康检查通过即视为升级完成。

## 6. 与 systemd 版的差异

| 能力 | systemd 版 | Docker 版 |
|------|------------|------------|
| `AI_CENTER_RUNTIME_OWNER` | 必须是 `systemd` | 已设为 `docker` 绕过 |
| 反向代理 | Apache/Nginx (`/ai/`) | 由用户自配；也可用 Caddy/Traefik |
| 持久化 | `/opt/ai-consulting-center/{data,templates}` | 命名卷（可挂到主机目录） |
| 数据库 | 同机 Postgres | 同 compose 容器化 |
| 录像/导入 YoooClaw | `/mnt/renz` | 默认不挂；按需 mount |

## 7. 常用命令

```bash
# 查看日志
docker compose logs -f app
docker compose logs -f postgres

# 进入容器
docker compose exec app sh
docker compose exec postgres psql -U ai_center -d ai_consult

# 停止 / 删除容器（保留卷）
docker compose down

# 停止并清除全部数据
docker compose down -v
```

## 8. 生产前清单

- 替换 `POSTGRES_PASSWORD` / `JWT_SECRET` 为长随机串。
- HTTPS 反代下把 `COOKIE_SECURE=true`、`WEB_ORIGIN` 设为真实域名。
- 启用备份：`pgdata` + `app-uploads` + `app-templates` 周期归档。
- 若需 OpenAI/Ollama 网关，配置相应变量并允许出站。

## 9. 故障排查

| 现象 | 排查 |
|------|------|
| App 反复重启，日志有 `DATABASE_URL is required` | 检查 `./config/.env` 是否挂载（路径区分大小写） |
| 健康检查 502 | `docker compose logs app`，多见 `JWT_SECRET is required` |
| Postgres 启动失败 | 端口 5432 被占用？`lsof -i:5432` |
| 迁移失败 / 部分应用 | `docker compose down -v` 后再 `up -d --build`（**会清除数据**） |
| AI_CENTER_RUNTIME_OWNER 报错 | 容器内已自动注入 `docker`，如报请升级镜像 |
