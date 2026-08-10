# AI数字化咨询中心运行手册

更新日期：2026-08-10
部署路径：`/opt/ai-consulting-center`
正式试用入口：`http://10.168.1.105:8080/ai/`
应用服务：`ai-consulting-center.service`（systemd user unit）

## 1. 用户操作

1. 浏览器打开正式试用入口并登录。
2. 管理员可维护本企业用户、客户、知识、审核任务和成果状态。
3. 普通用户可发起咨询、生成报价、分析文档、查看本企业资料和提交知识纠正。
4. 咨询成果可导出原生 DOCX/PPTX；认证报价可导出 DOCX。
5. 对外发送前由管理员完成人工审核。AI 输出不得替代认证专业判断。

系统不提供公开默认密码。管理员创建或重置用户后，应通过安全渠道传递临时密码；用户登录后立即修改。

## 2. 服务检查

```bash
systemctl --user status ai-consulting-center.service
systemctl --user show ai-consulting-center.service -p MainPID --value
curl -fsS http://127.0.0.1:3001/health
curl -I http://127.0.0.1:8080/ai/
```

查看应用日志：

```bash
journalctl --user -u ai-consulting-center.service -n 100 --no-pager
```

日志必须对 `Authorization`、`Cookie` 和 `Set-Cookie` 显示为 `[REDACTED]`。不得复制或传播日志中的凭据。

## 3. 受控重启

```bash
old=$(systemctl --user show ai-consulting-center.service -p MainPID --value)
systemctl --user restart ai-consulting-center.service
sleep 3
new=$(systemctl --user show ai-consulting-center.service -p MainPID --value)
printf 'app_pid=%s->%s\n' "$old" "$new"
curl -fsS http://127.0.0.1:3001/health
systemctl --user is-active hermes-gateway.service
systemctl --user is-active openclaw-gateway.service
```

只操作 `ai-consulting-center.service`。不要为了应用发布停止 Hermes、OpenClaw、Embedding、FRP、Apache 或 Ollama。

生产实例只能由 `ai-consulting-center.service` 启动。禁止使用 `node apps/server/dist/index.js`、`npm start`、Hermes/OpenClaw 工具或后台脚本直接拉起生产 Node 进程。服务单元固定注入 `AI_CENTER_RUNTIME_OWNER=systemd`，应用还会校验自身 Linux cgroup；该变量不得写入 `.env`。

确认进程归属和监听范围：

```bash
pid=$(systemctl --user show ai-consulting-center.service -p MainPID --value)
cat "/proc/$pid/cgroup"
ss -ltnp 'sport = :3001'
```

验收标准是 cgroup 包含 `ai-consulting-center.service`，且 3001 只监听 `127.0.0.1`。

## 4. 发布流程

发布顺序固定为：检查、备份、变更、构建测试、提交、重启、烟雾测试、回滚确认。

```bash
cd /opt/ai-consulting-center
git status --short
git rev-parse --short HEAD
npm run build
npm run test
git diff --check
```

发布后验证：

```bash
curl -fsS http://127.0.0.1:8080/ai/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/ai/
git status --short
```

前端生产文件由 Apache 的 `/ai/` 入口提供；Node 3001 端口主要承载 API 和健康检查，不以 `/ai/` 作为页面入口。

## 5. 数据与备份

正式数据包括：

- PostgreSQL 数据库 `ai_consult`。
- `data/uploads/` 原始上传文件。
- `templates/` DOCX/PPTX 模板。
- `.env` 生产配置。

升级、迁移或恢复前必须同时备份数据库和文件，并分别验证 `pg_restore --list` 与 `tar -tzf`。代码回滚与数据回滚是两件事，不得用旧数据库覆盖新业务数据。

原始认证资料目录和 15GB 知识文件不得删除、移动或上传到外部服务。长期向量任务需在资源确认后单独启动，不随 Web 服务自动恢复。

## 6. 安全要求

- `.env` 权限保持 `600`，真实密钥不进入 Git。
- 当前 HTTP 内网入口使用 HttpOnly + SameSite=Strict Cookie。
- 配置 HTTPS 后设置 `COOKIE_SECURE=true`，公网只开放反向代理端口。
- 凭据或会话疑似泄漏时，先封堵日志，再轮换 `JWT_SECRET`、撤销活动会话并重启应用；不要重置用户密码，除非密码本身泄漏。
- 数据库不可用时应停止正式业务操作。共享 JSON 回退仅用于兼容，不应作为生产数据源。

## 7. 当前待办

- 登录失败限流和账号锁定策略。
- `audit_log` 全业务写入与审计查询。
- HTTPS、Secure Cookie 和正式域名。
- 生产依赖的 4 个 high severity 告警评估与无破坏升级。
- 扫描 PDF OCR 队列、失败重试和进度监控。
- 五种正式业务成果的内容验收、审批门禁和版本归档。
- 自动备份、恢复演练和监控告警。
