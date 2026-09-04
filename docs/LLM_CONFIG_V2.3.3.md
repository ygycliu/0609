# V2.3.3 大模型配置 — 部署与运维手册

> **版本**：V2.3.3
> **上线日期**：2026-09-03
> **适用**：AI 数字化认证中心 (`/opt/ai-consulting-center/`)
> **作者**：Hermes Agent + 刘军

---

## 1. 功能概览

在 AI 中心 **工具 → 🧠 大模型配置** 菜单中，**管理员**可读写全局大模型配置：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| provider | ✅ | `openai`（OpenAI 兼容协议）/ `ollama`（本地） |
| model_name | ✅ | 例：`MiniMax-M3` / `qwen3.6:35b-iq2` / `gpt-4o` |
| base_url | ✅ | OpenAI: `https://api.MiniMax.chat/v1`；Ollama: `http://localhost:11434` |
| api_key | ❌（Ollama 可空） | OpenAI 兼容协议的 API key |
| num_ctx | ❌ | 上下文 token 上限（默认 4096，长合同建议 16384+） |
| temperature | ❌ | 采样温度（认证抽取建议 0.1-0.3） |
| timeout | ❌ | 请求超时秒数（默认 60） |
| change_reason | ❌ | 变更原因（必写入审计日志） |

**核心保证：**
- 🔐 **API key 加密存库** — AES-256-GCM，每条独立 IV，密文 + IV + auth tag 存为三段独立列
- 🔥 **热生效** — 保存后 `model.gateway.ts` 立刻从 DB 读，无需重启后端
- 📋 **审计可追溯** — 所有 INSERT/UPDATE/DELETE 写入 `app_llm_config_audit`，记录 operator + reason + timestamp
- 🚫 **API 不返回明文** — GET 响应中 `api_key` 字段为 `sk-***cdef` 脱敏形式

---

## 2. 架构

```
┌────────────────────────────────────────────────────────┐
│ 浏览器 (admin)                                          │
│   ├─ 工具 → 🧠 大模型配置 → LlmConfigPage.tsx          │
│   │   - GET  /api/admin/llm-config                     │
│   │   - PUT  /api/admin/llm-config   (写 + 热生效)    │
│   │   - DELETE /api/admin/llm-config?reason=...        │
│   │   - POST /api/admin/llm-config/test                │
│   │   - GET  /api/admin/llm-config/audit              │
│   └─ fetch('/api/...')                                 │
└────────────────┬───────────────────────────────────────┘
                 │ vite proxy / Apache 反代
                 ▼
┌────────────────────────────────────────────────────────┐
│ 后端 Fastify (port 3001)                                │
│   ├─ app.ts                                             │
│   │  ├─ app.get('/api/admin/llm-config', ...)         │
│   │  ├─ app.put('/api/admin/llm-config', ...)         │
│   │  ├─ app.delete('/api/admin/llm-config', ...)      │
│   │  ├─ app.post('/api/admin/llm-config/test', ...)   │
│   │  └─ app.get('/api/admin/llm-config/audit', ...)   │
│   ├─ llm-config.service.ts  (CRUD + 审计 + 热生效)    │
│   ├─ llm-crypto.ts          (AES-256-GCM)             │
│   └─ model.gateway.ts       (callOpenAi + override)   │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│ PostgreSQL `ai_consult`                                 │
│   ├─ app_llm_config (单行全局默认)                      │
│   │    ├─ id, provider, model_name, base_url           │
│   │    ├─ api_key_enc   (base64 密文)                   │
│   │    ├─ api_key_iv    (base64 IV, 12 字节)            │
│   │    ├─ api_key_tag   (base64 auth tag, 16 字节)      │
│   │    ├─ num_ctx, temperature, timeout_seconds         │
│   │    └─ updated_at, updated_by                        │
│   └─ app_llm_config_audit (操作流水)                    │
└────────────────────────────────────────────────────────┘
```

---

## 3. 数据库初始化

### 3.1 表结构（一次性）

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_llm_config (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL,
  model_name      TEXT NOT NULL,
  base_url        TEXT NOT NULL,
  api_key_enc     TEXT,
  api_key_iv      TEXT,
  api_key_tag     TEXT,
  num_ctx         INTEGER NOT NULL DEFAULT 4096,
  temperature     DOUBLE PRECISION NOT NULL DEFAULT 0.3,
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,
  CONSTRAINT app_llm_config_singleton CHECK (id = 1)
);
-- 强制单行：仅 id=1 合法，业务层始终 UPDATE WHERE id=1
-- 通过 partial unique index 强约束（可选）：
-- CREATE UNIQUE INDEX app_llm_config_only_one ON app_llm_config ((true));

CREATE TABLE IF NOT EXISTS app_llm_config_audit (
  id          BIGSERIAL PRIMARY KEY,
  config_id   INTEGER,
  action      TEXT NOT NULL,           -- INSERT / UPDATE / DELETE
  before      JSONB,
  after       JSONB,
  operator    TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_llm_config_audit_created
  ON app_llm_config_audit (created_at DESC);
```

### 3.2 初始化脚本（如需重建）

```bash
cd /opt/ai-consulting-center
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" \
  node apps/server/db-init-llm-config.mjs
```

---

## 4. 环境变量

`.env` 必加项（systemd `EnvironmentFile=/opt/ai-consulting-center/.env`）：

```bash
# 现有项
DATABASE_URL=postgresql://...        # [REDACTED]
DEFAULT_MODEL=openai
OPENAI_MODEL=MiniMax-M3
OPENAI_BASE_URL=https://api.MiniMax.chat/v1
OPENAI_API_KEY=sk-...                # [REDACTED] — 兜底（DB 无配置时使用）

# 🆕 V2.3.3 必加
LLM_ENCRYPTION_KEY=<32字节 base64 字符串>
```

**生成新 key：**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

⚠️ **丢失后果**：DB 中已加密的 API key 全部无法解密，**必须重新保存配置**。

---

## 5. 服务进程

### 5.1 后端（systemd）

`/etc/systemd/system/ai-consulting-center.service`（已存在）：

```ini
[Service]
Type=simple
User=ygycliu
WorkingDirectory=/opt/ai-consulting-center/apps/server
EnvironmentFile=/opt/ai-consulting-center/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=3
```

操作：
```bash
sudo systemctl restart ai-consulting-center
# 卡死时绕过：
ls -la /opt/ai-consulting-center/apps/server/dist/index.js   # 验证时间戳
ps -ef | grep dist/index.js | grep -v grep                   # 验证 pid
curl http://localhost:3001/health                            # 验证健康
```

### 5.2 前端（dev 模式）

> ⚠️ **当前无 systemd unit**，必须手动起：

```bash
cd /opt/ai-consulting-center/apps/web
npx vite --host 0.0.0.0 --port 5180
```

或后台（避免 shell 退出被 SIGTERM）：
```bash
cd /opt/ai-consulting-center/apps/web
nohup npx vite --host 0.0.0.0 --port 5180 \
  > /tmp/vite-dev.log 2>&1 &
```

> 推荐改用 `screen`/`tmux` 保持会话稳定。

**端口冲突排查：**
```bash
ss -tlnp | grep 5180
# 杀掉旧进程
pkill -f 'vite --host' 2>&1 || true
sleep 2
```

### 5.3 前端（prod 模式，Apache 反代）

```bash
cd /opt/ai-consulting-center/apps/web
npm run build          # 输出到 apps/web/dist/
```

**Apache 反代配置（参考）：**
```apache
<VirtualHost *:443>
  ServerName ai.zhongrennx.com

  # SPA 前端 — /ai/ 前缀
  Alias /ai /opt/ai-consulting-center/apps/web/dist
  <Directory /opt/ai-consulting-center/apps/web/dist>
    RewriteEngine On
    RewriteBase /ai/
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /ai/index.html [L]
  </Directory>

  # API 反代 — 去掉 /ai 前缀
  ProxyPass /ai/api/ http://127.0.0.1:3001/api/
  ProxyPassReverse /ai/api/ http://127.0.0.1:3001/api/
</VirtualHost>
```

---

## 6. 构建与部署流程

### 6.1 后端

```bash
cd /opt/ai-consulting-center/apps/server
npm run build                              # tsc → dist/
sudo systemctl restart ai-consulting-center
```

### 6.2 前端（dev）

```bash
cd /opt/ai-consulting-center/apps/web
npx vite --host 0.0.0.0 --port 5180
```

### 6.3 前端（prod）

```bash
cd /opt/ai-consulting-center/apps/web
npm run build
sudo systemctl reload apache2
```

---

## 7. 端到端验证

### 7.1 健康检查

```bash
# 后端
curl -s http://localhost:3001/health
# {"status":"ok",...}

# 前端
curl -sI http://localhost:5180/ai/ | head -1
# HTTP/1.1 200 OK
```

### 7.2 LLM 路由（需先 admin 登录拿 cookie）

```bash
# 登录
curl -c /tmp/cookie.txt -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# 读
curl -b /tmp/cookie.txt http://localhost:3001/api/admin/llm-config

# 写
curl -b /tmp/cookie.txt -X PUT http://localhost:3001/api/admin/llm-config \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "openai",
    "model_name": "MiniMax-M3",
    "base_url": "https://api.MiniMax.chat/v1",
    "api_key": "sk-xxxxxxxxxxxxx",
    "num_ctx": 16384,
    "temperature": 0.2,
    "timeout": 90,
    "change_reason": "上线初次配置"
  }'

# 删（回退 .env）
curl -b /tmp/cookie.txt -X DELETE \
  'http://localhost:3001/api/admin/llm-config?reason=测试清理'

# 审计
curl -b /tmp/cookie.txt http://localhost:3001/api/admin/llm-config/audit
```

### 7.3 验证 DB 密文（不是明文）

```sql
SELECT api_key_enc, api_key_iv, api_key_tag
FROM app_llm_config;
-- api_key_enc 应是 base64 密文（不是 sk-xxx...）
```

---

## 8. 常见问题

### Q1: 浏览器访问 `/ai/` 仍跳到登录页？

**A:** dev 模式 `lib/api.ts` 已用 `import.meta.env.PROD` 守卫，dev 走 `/api`（vite proxy），prod 走 `/ai/api`（反代）。检查：
```bash
# vite dev 是否起在 :5180
ss -tlnp | grep 5180

# vite.config.ts 是否含 /api proxy
grep -A2 '"/api"' /opt/ai-consulting-center/apps/web/vite.config.ts
```

### Q2: 改了 API key 但 model.gateway 没生效？

**A:** `generateWithDefaultModel` 是同步读 DB 单例配置，每次调用都读。检查：
```bash
journalctl -u ai-consulting-center -n 50 | grep -i 'llm'
# 应该有 [llm-config] 热生效日志
```

### Q3: 忘记 LLM_ENCRYPTION_KEY？

**A:** DB 中所有已加密的 key **无法恢复**。**唯一办法：**
1. `DELETE /api/admin/llm-config` 清空
2. 重新生成 `LLM_ENCRYPTION_KEY` 并重启后端
3. 重新在 UI 保存新配置

### Q4: systemctl restart 一直卡死？

**A:** systemd 在该服务下经常卡死，绕过办法：
```bash
# 1. 验证进程
ls -la /opt/ai-consulting-center/apps/server/dist/index.js
ps -ef | grep dist/index.js | grep -v grep

# 2. 必要时强杀
sudo systemctl kill -s SIGKILL ai-consulting-center
sleep 2

# 3. 手动起
cd /opt/ai-consulting-center/apps/server
nohup /usr/bin/node dist/index.js > /tmp/ai-center.log 2>&1 &
```

### Q5: 浏览器 console 报 `api/api/admin/llm-config:1 404`？

**A:** 路径出现双 `api/api/` 前缀 = 自定义 helper 内部拼了 `/api` + 调用方 path 又写 `/api/...`。两种解法：
- 统一用全局 `request()` from `lib/api.ts`（最推荐）
- 自定义 helper 时二选一拼前缀规则，**绝不能混用**

详见 skill `web-vite-api-prefix-pattern`。

---

## 9. 变更记录

| 日期 | 变更 | 操作人 |
| --- | --- | --- |
| 2026-09-03 | V2.3.3 上线：5 路由 + AES-GCM + 热生效 | Hermes + 刘军 |
