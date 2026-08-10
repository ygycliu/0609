# AI数字化咨询中心部署说明

本说明适用于单家公司正式试用版本。生产环境以 PostgreSQL/pgvector、React/Express 和 systemd user service 运行。

## 环境要求

- Linux、Node.js 20+、npm 10+。
- PostgreSQL 15+，启用 pgvector。
- Apache 或 Nginx 反向代理。
- 可访问的本地 Ollama或 OpenAI 兼容模型服务。

## 必需配置

复制 `.env.example` 为 `.env`，权限设为 `600`。至少配置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
WEB_ORIGIN=http://your-host:8080
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/ai_consult
JWT_SECRET=replace-with-a-long-random-secret
COOKIE_SECURE=false
DEFAULT_MODEL=demo
```

真实密码、JWT密钥、数据库URI和模型密钥不得进入 Git 或发布包。HTTPS 启用后将 `COOKIE_SECURE` 改为 `true`。

`AI_CENTER_RUNTIME_OWNER` 不属于业务配置，不得写入 `.env`。它只由正式 systemd 单元注入；Linux 生产进程还必须位于 `ai-consulting-center.service` cgroup，直接执行 Node 或 `npm start` 会在监听端口前失败。

## 构建与数据库

```bash
cd /opt/ai-consulting-center
npm ci
npm run build
npm run test
```

执行 `data/migrations/` 中尚未应用的迁移前，先备份数据库并在测试库验证。不得对正式库重复执行破坏性迁移。

## systemd user service

服务定义参考 `deploy/ai-consulting-center.service`：

```bash
mkdir -p ~/.config/systemd/user
cp deploy/ai-consulting-center.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ai-consulting-center.service
systemctl --user status ai-consulting-center.service
```

健康检查：

```bash
curl -fsS http://127.0.0.1:3001/health
```

不得用 Hermes、OpenClaw 或后台 shell 直接启动生产 Node 进程。正式发布和重启一律通过 `systemctl --user` 操作 `ai-consulting-center.service`。

## 反向代理

将 `/ai/` 页面和 `/ai/api/` API 转发到应用，保留 `Host`、`X-Real-IP`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。上传限制至少为 20MB。

反向代理修改后先执行配置检查，再 reload，不要直接停止其他站点：

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

## 发布验收

发布后至少验证：

- `/ai/` 和 `/ai/health` 返回 200。
- 未登录业务接口返回 401。
- 管理员和普通用户权限差异符合预期。
- 跨企业读取被阻断。
- 咨询 DOCX/PPTX、认证报价 DOCX 均为有效 OpenXML。
- 文档分析、知识反馈、人工审核和版本记录可用。
- 模型输出不包含 `<think>` 或调试内容。
- 日志不记录 Cookie、JWT、数据库URI和模型密钥。
- 测试数据完全清理，Hermes/OpenClaw 服务未受影响。

核心自动验收脚本：`deploy/core-acceptance.sh`。

## 正式公网发布前置项

- HTTPS 与 `COOKIE_SECURE=true`。
- 登录限流、账号锁定和完整审计日志。
- 生产依赖漏洞治理。
- 自动备份、恢复演练和监控告警。
- 去除数据库异常时的共享 JSON 数据回退。
