# AI 数字化咨询中心 · 运行手册

部署时间：2026-07-30
部署主机：本机 103.117.123.100
部署路径：`/opt/ai-consulting-center`
入口端口：**3001**（绑定所有接口，Token 鉴权）
守护进程：systemd `ai-consulting-center.service`

---

## 0. 访问入口（两种方式）

| 入口 | URL | 备注 |
|---|---|---|
| **公网 / 主站反代**（推荐）| `http://103.117.123.100:8080/ai/` | 经 Apache 转发，自动 `WEB_ORIGIN` 同源，无 CORS 问题 |
| 直接访问（调试用）| `http://10.168.1.105:3001/` 或 `http://127.0.0.1:3001/` | LAN/本机；浏览器可裸访问，API 也走 `/api` |

> 端口对照：本机 **3000** Hermes / **3001** AI 中心 / **8080** Apache+主站 / **8889** FastAPI
> 浏览器**记得带尾斜杠**：`/ai/` ✅，裸 `/ai` 会 404（Apache 路由规则限定）。

## 1. 日常操作

### 查看状态
```bash
sudo systemctl status ai-consulting-center.service
sudo journalctl -u ai-consulting-center -n 50 --no-pager
```

### 重启 / 停止 / 启动
```bash
sudo systemctl restart ai-consulting-center.service   # 重启（应用配置/代码改动）
sudo systemctl stop ai-consulting-center.service      # 停
sudo systemctl start ai-consulting-center.service     # 开
```

### 健康检查（无需 Token）
```bash
curl http://127.0.0.1:3001/health
```

### 调 API（需 Token）
```bash
TOKEN=$(grep '^API_TOKEN=' /opt/ai-consulting-center/.env | cut -d= -f2)

# 直接访问（3001）
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/employees

# 经 Apache 反代（8080/ai）
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/ai/api/employees
```

### 查看前端 / 浏览器访问
```
http://127.0.0.1:3001/                   ← 本机
http://103.117.123.100:3001/             ← 局域网/公网（首次访问需填 Token）
```
**⚠️ 当前没有登录界面**：浏览器直接调 `/api/*` 需要在 DevTools 里手动加 `Authorization` 头。
UX 需要时再说，待办。

---

## 2. 数据备份 / 恢复

### 备份（建议每天 1 次）
```bash
sudo systemctl stop ai-consulting-center.service
sudo tar czf /var/backups/ai-consulting-center-$(date +%Y%m%d).tar.gz \
  /opt/ai-consulting-center/data
sudo systemctl start ai-consulting-center.service
```
**或**用 cron 加 systemd timer（自动）— 待办。

### 恢复
```bash
sudo systemctl stop ai-consulting-center.service
sudo tar xzf /var/backups/ai-consulting-center-20260730.tar.gz -C /
sudo systemctl start ai-consulting-center.service
```

---

## 3. 升级流程（新版本发布）

```bash
sudo systemctl stop ai-consulting-center.service
cd /opt/ai-consulting-center
# 拉新代码或复制新文件
cp -r /path/to/new/apps/server/src . # 仅 server 改动需重建
npx tsc -p apps/server/tsconfig.json # 重建
sudo systemctl start ai-consulting-center.service
```

前端改动（`apps/web/**`）：
```bash
cd /opt/ai-consulting-center/apps/web
npm run build          # 输出覆盖 dist/
sudo systemctl restart ai-consulting-center.service  # express.static 内存加载，无需 restart 也行
```

Apache 配置改动：
```bash
sudo apache2ctl configtest     # 必须先测，错则不改
sudo systemctl reload apache2  # 不丢现有 TCP 连接
```

若 `package.json` 改了：
```bash
npm install --omit=dev --include=dev   # 临时装 dev
npx tsc -p apps/server/tsconfig.json
# 跑完可清理 dev：npm prune --omit=dev
```

---

## 4. 已知限制（MVP 边界）

| # | 限制 | 影响 | 缓解 |
|---|---|---|---|
| 1 | **JSON 文件存数据** | 单实例 OK，多进程并发会丢 | 别开第二个实例 |
| 2 | **docx 字符截 100K** | 超长文档丢失尾部 | 分章节入库 |
| 3 | **无浏览器登录** | API 需手填 Token | 配合 nginx + basic_auth，或后续加 /login |
| 4 | **知识检索是关键词**（非向量） | 同义词召回差 | 关键词覆盖 + 标签补全 |
| 5 | **CORS 仅单 origin** | 多前端接入失败 | 需改 `WEB_ORIGIN` 或扩展白名单 |
| 6 | **public 暴露** | Token 公开 = 全开放 | 加 nginx 反代 + IP 白名单 / basic_auth |

---

## 5. 配置项（`.env`）

```dotenv
PORT=3001                                # 监听端口
WEB_ORIGIN=http://localhost:3001         # CORS 白名单
DEFAULT_MODEL=ollama                     # demo | openai | ollama
API_TOKEN=<64字符hex>                    # ★ 必改；rotated 后需同步更新客户端
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b                  # 可改 qwen3:8b / 35b-iq2
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=                          # 留空 = OpenAI 通道不可用
OPENAI_MODEL=gpt-4.1-mini
LOG_LEVEL=info                           # debug | info | warn | error
```

`chmod 600 .env`，仅 root + 部署用户可读。

---

## 6. 紧急处置

### 服务挂了
```bash
sudo journalctl -u ai-consulting-center -n 100 --no-pager    # 看错误
sudo systemctl restart ai-consulting-center.service          # 重拉
```

### Token 泄漏
```bash
NEW=$(openssl rand -hex 32)
sudo sed -i "s/^API_TOKEN=.*/API_TOKEN=$NEW/" /opt/ai-consulting-center/.env
sudo systemctl restart ai-consulting-center.service
```
同步通知所有 Token 使用方。

### Ollama 不可用
```bash
curl http://127.0.0.1:11434/api/version   # 探活
# 若挂了，先重启 ollama：
sudo systemctl restart ollama 2>/dev/null || ollama serve &
```
服务会自动回落 `DEFAULT_MODEL=demo`，不阻断咨询流。

---

## 7. 暂未做（按优先级）

- [ ] 加登录页 + session
- [ ] DB 替代 JSON（SQLite 起步）
- [ ] nginx 反代 + HTTPS（lucaai.com DNS 先修）
- [ ] 多用户/多租户
- [ ] 知识库向量检索（Qdrant/pgvector）
- [ ] 自动备份 systemd timer
- [ ] Token 改 JWT，expires_in + refresh
