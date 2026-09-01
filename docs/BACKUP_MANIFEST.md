# 备份清单

> **备份时间**：2026-09-01 21:16  
> **Git HEAD**：`37e3e81a7cb0d86d790bc0dc7cdde3eebe4b8289`  
> **分支**：`main`  
> **最新 commit**：`tools: 添加代码审查备份脚本 backup-for-review.sh`

## 📦 备份文件清单

**位置**：`/home/ygycliu/backups/`

| 文件 | 大小 | MD5 | 用途 |
|---|---:|---|---|
| `ai-consulting-center-src-20260901.tar.gz` | 100 MB | `06cd06d9cec8589b5a190e4f993eaf8c` | **完整源码包**（不含 node_modules / dist）|
| `ai-consulting-center-data-20260901.sql` | 730 KB | `42baf52f59d4a74c716ce4b6703044d9` | **关键表数据**（customer / certification_project / project_certificate / auditor_profile / todo）|
| `ai-consulting-center-schema-20260901.sql` | 131 KB | `84584997abafbc2ad24dfc2344bcb821` | **数据库 schema**（所有表 + 函数 + 视图）|
| `ai-consulting-center.bundle` | 3.2 MB | `94ebf19f8acb35af294965b883721aef` | **Git 完整历史**（50+ commits）|

---

## 🔄 恢复指南

### 步骤 1：恢复源码

```bash
# 备份位置
SRC="/home/ygycliu/backups/ai-consulting-center-src-20260901.tar.gz"

# 解压到目标目录
mkdir -p /opt/ai-consulting-center
tar -xzf "$SRC" -C /opt/

# 验证
ls /opt/ai-consulting-center/
```

### 步骤 2：安装依赖

```bash
cd /opt/ai-consulting-center

# 后端
cd apps/server
npm install
npm run build

# 前端
cd ../web
npm install
npm run build

# 回到项目根
cd ../..
```

### 步骤 3：恢复数据库 Schema

```bash
SCHEMA="/home/ygycliu/backups/ai-consulting-center-schema-20260901.sql"

# 创建空数据库（如不存在）
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE ai_consult;"
psql -h 127.0.0.1 -U postgres -c "CREATE USER ai_consult WITH PASSWORD '<your-password>';"
psql -h 127.0.0.1 -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ai_consult TO ai_consult;"

# 恢复 schema
psql -h 127.0.0.1 -U ai_consult -d ai_consult -f "$SCHEMA"
```

### 步骤 4：恢复关键表数据

```bash
DATA="/home/ygycliu/backups/ai-consulting-center-data-20260901.sql"

psql -h 127.0.0.1 -U ai_consult -d ai_consult -f "$DATA"
```

### 步骤 5：验证恢复

```bash
# 检查表行数
psql -h 127.0.0.1 -U ai_consult -d ai_consult <<EOF
SELECT 'customer' AS tbl, COUNT(*) FROM customer
UNION ALL
SELECT 'certification_project', COUNT(*) FROM certification_project
UNION ALL
SELECT 'project_certificate', COUNT(*) FROM project_certificate
UNION ALL
SELECT 'auditor_profile', COUNT(*) FROM auditor_profile
UNION ALL
SELECT 'todo', COUNT(*) FROM todo;
EOF
```

**预期结果**：
```
         tbl          | count 
----------------------+-------
 customer             |   850
 certification_project|   285
 project_certificate  |   223
 auditor_profile      |    35
 todo                 |    50+
```

### 步骤 6：启动服务

```bash
# 启动后端
bash /opt/ai-consulting-center/scripts/start-ai-center.sh

# 验证
curl http://127.0.0.1:3001/health
```

### 步骤 7：恢复 Git 历史（可选）

```bash
# 从 bundle 恢复 git 历史
cd /opt/ai-consulting-center
git bundle verify ../ai-consulting-center.bundle
git fetch ../ai-consulting-center.bundle 'refs/*:refs/*'
git checkout main
git log --oneline -5
```

---

## 📂 项目结构

```
/opt/ai-consulting-center/
├── apps/
│   ├── server/              # 后端 (Node + Express + TS)
│   │   └── src/             # 51 个 TS 文件，17400 行
│   └── web/                 # 前端 (React + TS)
│       └── src/             # 46 个 TS/TSX/CSS，28236 行
├── data/
│   └── migrations/          # 45 个 SQL 迁移
├── scripts/                 # 启动/备份/cron 脚本
└── docs/                    # 完整功能文档
    ├── README.md            # 项目总览（137 行）
    ├── ARCHITECTURE.md      # 系统架构（293 行）
    ├── API.md               # API 接口（415 行）
    ├── DATABASE.md          # 数据库（440 行）
    ├── MODULES.md           # 功能模块（490 行）
    ├── CHANGELOG.md         # 变更记录（307 行）
    └── BACKUP_MANIFEST.md   # 本文件
```

---

## 🔐 连接信息

```bash
# PostgreSQL
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=ai_consult
PGDATABASE=ai_consult
PGPASSWORD=<your-password>  # 见 .env 或系统环境变量

# 服务端口
Backend:  http://127.0.0.1:3001
Frontend: /opt/ai-consulting-center/apps/web/dist/
Apache:   https://103.117.123.100:8080/ai/
```

---

## 🔧 关键脚本

| 脚本 | 用途 |
|---|---|
| `scripts/start-ai-center.sh` | 启动后端 |
| `scripts/stop-ai-center.sh` | 停止后端 |
| `scripts/restart-ai-center.sh` | 重启后端 |
| `scripts/cron-cert-expiry.sh` | 证书预警 cron（每天 09:00）|
| `scripts/backup-for-review.sh` | 一键备份 |

---

## 📊 关键数据（截至 2026-09-01）

| 表 | 行数 |
|---|---:|
| customer | 850 |
| certification_project | 285 |
| project_certificate | 223 |
| auditor_profile | 35 |
| finance_project | 874 |
| finance_transaction | 266 |
| finance_ar | 11 |
| todo | 50+ |

---

## 🧪 测试账号

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员 |
| tester | tester123 | 普通用户 |

---

## 🔍 故障排查

### 数据库连接失败

```bash
# 检查 PG 服务
ss -tlnp | grep 5432

# 检查 .env 或环境变量
echo $PGPASSWORD
```

### 后端启动失败

```bash
# 查看日志
tail -100 /tmp/ai-center.log

# 检查端口占用
ss -tlnp | grep 3001

# 重新构建
cd /opt/ai-consulting-center/apps/server
npm run build
```

### 前端 404

```bash
# 确认 dist/ 已生成
ls /opt/ai-consulting-center/apps/web/dist/

# 重新构建
cd /opt/ai-consulting-center/apps/web
npm run build
```

### Apache 反代异常

```bash
# 检查 Apache 配置
cat /etc/apache2/sites-enabled/* | grep -A 10 "ai/"

# 测试后端直接访问
curl http://127.0.0.1:3001/health
```

---

## 📞 联系

- **负责人**：刘军
- **公司**：华中国际认证检验集团有限公司
- **部署**：宁夏银川金凤区
- **版本**：V2.0-MVP
- **文档版本**：2026-09-01

---

## 📜 备份脚本（重新备份用）

如果需要重新生成备份文件，运行：

```bash
bash /opt/ai-consulting-center/scripts/backup-for-review.sh
```

输出位置：`/home/ygycliu/backups/`
