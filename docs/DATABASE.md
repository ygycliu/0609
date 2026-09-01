# 数据库结构

> **DBMS**：PostgreSQL 16  
> **数据库**：`ai_consult`  
> **迁移脚本**：`data/migrations/*.sql`（共 45 个）  
> **字符集**：UTF-8  
> **时区**：Asia/Shanghai (+08:00)

## 📊 表清单（核心 30+ 张）

### 业务核心表

| 表名 | 行数 | 说明 |
|---|---:|---|
| `customer` | 850 | 客户主表 |
| `certification_project` | 285 | 认证项目 |
| `project_certificate` | 223 | 项目证书 |
| `auditor_profile` | 35 | 审核员档案 |
| `finance_project` | 874 | 财务项目（合并客户）|
| `finance_transaction` | 266 | 交易流水 |
| `finance_ar` | 11 | 应收账款 |
| `todo` | 50+ | 统一待办 |
| `knowledge_document` | 100+ | 知识文档 |

### 配置/枚举表

| 表名 | 说明 |
|---|---|
| `service_type` | 服务类型（咨询/认证/咨询+认证）|
| `signing_entity` | 签约主体（华中/中认宁夏/外协）|
| `risk_level` | 风险等级 |
| `partner_org` | 合作机构 |
| `signatory` | 签字人 |
| `audit_template` | 审核模板 |

### 用户/权限表

| 表名 | 说明 |
|---|---|
| `users` | 用户 |
| `employees` | 员工 |

### 业务日志表

| 表名 | 说明 |
|---|---|
| `project_event` | 项目事件流 |
| `follow_up` | 客户跟进 |
| `consultation` | 咨询对话 |
| `todo` | 待办（跨业务统一）|

---

## 🗂️ 表结构详解

### customer（客户）

```sql
CREATE TABLE customer (
  id              UUID PRIMARY KEY,
  company_id      UUID NOT NULL,           -- 公司 ID
  customer_code   VARCHAR(50) UNIQUE,       -- 客户编码
  name            VARCHAR(200),             -- 客户名称
  status          VARCHAR(20),              -- active/inactive/archived
  industry        VARCHAR(100),
  credit_code     VARCHAR(50),
  contact_person  VARCHAR(50),
  contact_phone   VARCHAR(50),
  email           VARCHAR(200),
  address         TEXT,
  notes           TEXT,                     -- 自动填充备注
  tags            TEXT[],
  source          VARCHAR(50),              -- 数据来源
  created_by      UUID,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ               -- 软删除
);

CREATE INDEX idx_customer_status ON customer(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_name ON customer(name);
```

### certification_project（认证项目）

```sql
CREATE TABLE certification_project (
  id                  UUID PRIMARY KEY,
  company_id          UUID,
  project_code        VARCHAR(50) UNIQUE,    -- PRJ-2026-XXX
  customer_id         UUID,
  customer_name       VARCHAR(200),
  service_type_id     UUID,
  service_type_code   VARCHAR(50),           -- certification
  service_type_name   VARCHAR(100),          -- 认证服务
  signing_entity_id   UUID,
  signing_entity_name VARCHAR(200),          -- 华中国际认证检验集团
  status              VARCHAR(50),           -- project_archived 等 22 状态
  industry            VARCHAR(100),
  project_owner_id    UUID,
  project_owner_name  VARCHAR(100),
  is_suspended        BOOLEAN,
  created_by          UUID,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  risk_level_id       UUID
);
```

### project_certificate（项目证书）⭐ V2.0 重点

```sql
CREATE TABLE project_certificate (
  id                UUID PRIMARY KEY,
  company_id        UUID,
  project_id        UUID,
  cert_type         VARCHAR(50),            -- QES三体系 / QMS / AAA 等
  standard          VARCHAR(200),           -- GB/T 19001-2016
  issue_date        DATE,
  issuing_body      VARCHAR(200),
  status            VARCHAR(20) DEFAULT 'pending',
  certificate_no    VARCHAR(100),           -- 证书号
  valid_until       DATE,                   -- 到期日
  notes             TEXT,
  document_id       UUID,
  
  -- V2.0 V035：已确认功能
  acknowledged_at   TIMESTAMPTZ,            -- NULL=未确认
  acknowledged_by   UUID,
  acknowledged_note TEXT,
  
  created_by        UUID,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);

-- 索引
CREATE INDEX idx_pc_acknowledged ON project_certificate(acknowledged_at)
  WHERE deleted_at IS NULL AND acknowledged_at IS NULL;
```

### auditor_profile（审核员档案）⭐ V2.0 重点

```sql
CREATE TABLE auditor_profile (
  id            UUID PRIMARY KEY,
  company_id    UUID,
  name          VARCHAR(100),
  code          VARCHAR(50),
  gender        VARCHAR(10),
  expert_type   VARCHAR(50),               -- 审核员 / 技术专家
  level         VARCHAR(20),               -- 实习 / 中级 / 高级
  organization  VARCHAR(200),              -- 华中认证 / 中认认证 / 其他
  specialties   TEXT[],                   -- 体系代码列表
  certificates  JSONB,                    -- [{code, name, type, file, source_name, ocr_result}]
  attachments   JSONB,                    -- 签字文件等
  contact       JSONB,                    -- {name, phone, email}
  email         VARCHAR(200),
  phone         VARCHAR(50),
  address       TEXT,
  tags          TEXT[],
  source        VARCHAR(200) DEFAULT '/mnt/renz/09、审核员档案/',
  status        VARCHAR(20) DEFAULT 'active',  -- active / disabled
  created_by    UUID,
  updated_by    UUID,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);
```

### todo（统一待办）⭐ V2.0 重点

```sql
CREATE TABLE todo (
  id            UUID PRIMARY KEY,
  company_id    UUID,
  owner_user_id UUID,
  assigned_to   UUID,
  title         TEXT,                     -- 标题
  description   TEXT,                     -- 描述
  category      VARCHAR(50),              -- general / urgent
  source        VARCHAR(50),              -- cert_acknowledge / cert_stage / project_payment / yoooclaw_recording
  source_ref    TEXT,                     -- 关联 ID
  due_at        TIMESTAMPTZ,              -- 截止时间
  remind_at     TIMESTAMPTZ,              -- 提醒时间
  status        VARCHAR(20) DEFAULT 'pending',  -- pending / completed / cancelled
  priority      VARCHAR(20),              -- urgent / high / medium / normal
  customer_id   UUID,
  metadata      JSONB,                    -- 元数据
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);
```

---

## 🔧 自定义函数

### certificate_next_stage(date, date, varchar)

**功能**：计算单张证书的下一阶段（4 阶段模型）

**参数**：
- `p_issue_date DATE`
- `p_valid_until DATE`
- `p_cert_type VARCHAR`

**返回**：
```sql
TABLE (
  current_stage VARCHAR,    -- 初次认证/监督一/监督二/已过期
  next_stage VARCHAR,        -- 监督一/监督二/再认证/重新认证
  next_stage_date DATE,
  days_until_next INTEGER,   -- 负数=已过
  urgency_level VARCHAR      -- RENEW/CRITICAL/WARNING/NORMAL
)
```

**逻辑**：
```
当前时间 < issue_date        → 阶段: '待发证', 下一: '初次认证'
当前时间 < issue_date + 1年  → 阶段: '初次认证', 下一: '监督一'
当前时间 < issue_date + 2年  → 阶段: '监督一', 下一: '监督二'
当前时间 < valid_until       → 阶段: '监督二', 下一: '再认证'
当前时间 ≥ valid_until       → 阶段: '已过期', 下一: '重新认证'

天数 < 0                    → 级别: RENEW (已过期)
天数 ≤ 90 且 下一=再认证    → 级别: CRITICAL (再认证紧急)
天数 ≤ 30                   → 级别: CRITICAL (即将到期)
天数 ≤ 180 且 下一=再认证   → 级别: WARNING (再认证预警)
天数 ≤ 90                   → 级别: WARNING (即将到期)
其他                        → 级别: NORMAL
```

### check_certificate_expiry(warning_days, critical_days)

**功能**：返回所有未确认证书（含阶段信息）

**返回字段**：certificate_id, customer_id, customer_name, project_code, cert_type, certificate_no, issue_date, valid_until, current_stage, next_stage, next_stage_date, days_until_next, urgency_level, alert_message

### auto_create_cert_stage_todos(critical_days, company_id)

**功能**：自动为到期证书创建 todo（24 小时去重）

### auto_create_cert_expiry_todos(warning_days, company_id) [旧版]

**功能**：旧版基于 days_until_expiry 的自动 todo（已废弃）

---

## 👁️ 视图

### vw_certificate_expiry_alerts ⭐ V2.0 重点

**功能**：所有未确认证书的预警视图（带 4 阶段 + 中文级别）

**过滤**：
- `pc.deleted_at IS NULL`
- `cp.deleted_at IS NULL`
- `pc.status = 'active'`
- **`pc.acknowledged_at IS NULL`** ← V035 新增

**列**：
- certificate_id, customer_id, customer_name, project_code, project_no
- cert_type, certificate_no, issue_date, valid_until
- **current_stage** (初次认证/监督一/监督二/已过期)
- **next_stage** (监督一/监督二/再认证/重新认证)
- next_stage_date, days_until_next
- **urgency_level** (已过期/再认证紧急/再认证预警/即将到期/正常)
- alert_message
- owner_user_id, issuing_body

**排序**：
```sql
ORDER BY CASE urgency_level
  WHEN 'RENEW' THEN 1     -- 已过期
  WHEN 'CRITICAL' THEN 2  -- 紧急
  WHEN 'WARNING' THEN 3   -- 预警
  ELSE 4                  -- 正常
END, next_stage_date ASC
```

### vw_certificate_stage_stats

**功能**：按阶段统计证书数

```sql
SELECT urgency_level, next_stage, COUNT(*) AS cert_count
FROM vw_certificate_expiry_alerts
GROUP BY urgency_level, next_stage
```

---

## 📂 迁移脚本清单（45 个）

### V2.0 MVP 阶段（028-035）

| 编号 | 名称 | 关键内容 |
|---|---|---|
| 028 | 客户去重 + 证书补建 | 中能新材料合并，证书到期预警模型 |
| 029 | 批量补证书 | 144 张证书从 finance_project 自动推断 |
| 030 | 自动提醒 todo | 24小时去重，到期前 90 天提醒 |
| 031 | 函数类型修复 | text vs varchar 转换 |
| 032 | 客户证书导入 | 68 张 PDF 提取数据 |
| 033 | OCR 扫描件 | 8 张扫描件 OCR 后插入 |
| 034 | 4 阶段预警 | certificate_next_stage 函数 |
| 035 | 已确认功能 | acknowledged_at 字段 + 视图过滤 |

### V2.0 早期阶段（001-027）

包括：审计员档案（024）、AR 双轨制（020-021）、客户状态机（016）、平台改名（023）等。

---

## 🔒 状态机（22 状态）

### 认证项目状态

```
project_draft         草稿
project_pending       待启动
project_active        进行中
project_supervision   监督中
project_audit         审核中
project_archived      已归档（已完成）
project_suspended     已挂起
project_cancelled     已取消
...（共 22 个状态 + 3 个异常）
```

### 客户状态

```
active        活跃
inactive      不活跃
archived      归档
```

---

## 📈 性能索引

关键索引：
```sql
-- 客户
CREATE INDEX idx_customer_status ON customer(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_name ON customer(name);

-- 认证项目
CREATE INDEX idx_cp_customer ON certification_project(customer_id);

-- 项目证书（V035 新增）
CREATE INDEX idx_pc_acknowledged 
  ON project_certificate(acknowledged_at)
  WHERE deleted_at IS NULL AND acknowledged_at IS NULL;

-- 审核员
CREATE INDEX idx_auditor_org ON auditor_profile(organization);
CREATE INDEX idx_auditor_status ON auditor_profile(status) WHERE deleted_at IS NULL;

-- 财务
CREATE INDEX idx_fp_customer ON finance_project(customer_id);
CREATE INDEX idx_fp_company ON finance_project(company_id);

-- todo
CREATE INDEX idx_todo_status ON todo(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_todo_due ON todo(due_at) WHERE deleted_at IS NULL AND status = 'pending';
```

---

## 🔄 数据迁移流程

```bash
# 1. 编写迁移脚本
vi data/migrations/XXX_xxx.sql

# 2. 本地测试幂等性
psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -v ON_ERROR_STOP=0 \
  -f data/migrations/XXX_xxx.sql

# 3. 验证
psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -c "SELECT COUNT(*) FROM ..."

# 4. 提交
git add data/migrations/XXX_xxx.sql
git commit -m "data(xxx): 描述"
```

---

## 💾 备份与恢复

### 备份
```bash
# 完整 schema
pg_dump -h 127.0.0.1 -U ai_consult -d ai_consult \
  --schema-only --no-owner --no-privileges \
  -f backup-schema.sql

# 数据（关键表）
pg_dump -h 127.0.0.1 -U ai_consult -d ai_consult \
  --data-only --no-owner --no-privileges \
  -t customer -t certification_project -t project_certificate \
  -t auditor_profile -t todo \
  -f backup-data.sql
```

### 恢复
```bash
psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f backup-schema.sql

psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f backup-data.sql
```

---

## 📞 连接配置

```bash
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=ai_consult
PGDATABASE=ai_consult
PGPASSWORD=<secret>  # 见 .env 文件
```

---

**版本**：V2.0-MVP  
**最后更新**：2026-09-01
