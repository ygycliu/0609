# P0-A 基线核验报告

> **执行人**：Hermes
> **时间**：2026-08-29
> **任务包**：AI 中心 V2.0 升级开发任务包 - Hermes 执行版
> **状态**：`READY_FOR_REVIEW`（仅 §2 只读检查完成，写代码部分暂停等待确认）

---

## ⚠️ 已知风险（必须审批）

| # | 风险 | 严重度 | 说明 |
|---|---|---|---|
| R1 | 违反任务包 §0 前置条件 | **高** | 用户指示"直接从生产目录开发"，违反 §0 "不得从生产目录、生产数据库或正在运行的服务目录直接开发" |
| R2 | 违反任务包 §2 准入条件 | **高** | 没有独立开发工作区（git worktree）和独立测试数据库 |
| R3 | 违反任务包 §10 回滚要求 | **中** | 用户指示"修改数据库 schema 的迁移不需要备份"，违反 §10 "每个迁移或业务改动必须提供：迁移前数据库备份" |
| R4 | git 工作区脏 | 中 | 3 个 SQL 迁移未提交（007 修改 + 008 + 013 新增） |
| R5 | forgejo 同步滞后 | 中 | 本地 main 领先 forgejo/main 多个 commits |
| R6 | 数据库 schema 偏差 | 高 | 实际 51 张表 vs 任务包期望 25 张 |

---

## 一、仓库元信息（只读）

```yaml
Repository: ai-consulting-center
Base Branch: main
Head Branch: main
HEAD SHA: 98933110ca42854844103c8f4499a5bf6039ef9d (full 40-char)
HEAD Message: fix(funnel): fix empty-color-bar rendering
Remote: forgejo (/mnt/data/ai-company-os/forgejo/app-data/git/repositories/ygycliu/ai-consulting-center.git)
```

### 工作区状态

```
 M data/migrations/007_customer_follow_up.sql      (1 行未提交修改)
?? data/migrations/008_follow_up_issuing_body.sql (未追踪，新增)
?? data/migrations/013_certification_project_v2.sql (未追踪，新增)
```

### 文件统计

| 指标 | 值 |
|---|---|
| 总文件数 | 336 |
| TypeScript 文件 | 145 |
| SQL 迁移文件 | 15（含 2 个未追踪）|

### 远程分支

```
* main                                                       ← 当前
  remotes/bundle/runtime-ownership-20260810
  remotes/forgejo/HEAD -> forgejo/main
  remotes/forgejo/develop
  remotes/forgejo/feature/acc-20260812-copyright
  remotes/forgejo/feature/hermes-auditor-recovery-20260812
  remotes/forgejo/main
  remotes/forgejo/recovery/version-info-20260813
  remotes/forgejo/release/acc-20260812-main
```

---

## 二、数据库实际 vs 任务包期望

### 实际数据库表（51 张）

| # | 表名 | 任务包要求 |
|---|---|---|
| 1 | active_token | ❌ 未提 |
| 2 | app_user | ❌ 未提 |
| 3 | audit_attachment | ❌ 未提 |
| 4 | audit_checklist_item | ✅（§4.1）|
| 5 | audit_item_template | ✅（§4.1）|
| 6 | audit_log | ✅（§4.2 P0 AI）|
| 7 | audit_report_attachment | ❌ 未提 |
| 8 | audit_session | ❌ 未提 |
| 9 | certification_product | ❌ 未提 |
| 10 | certification_project | ✅（§4.1）|
| 11 | company | ❌ 未提 |
| 12 | consultation_feedback | ❌ 未提 |
| 13 | consultation_project | ❌ 未提 |
| 14 | customer | ✅（§4.1）|
| 15 | customer_contact | ✅（§4.1）|
| 16 | customer_follow_up | ✅（改造，§3.3）|
| 17 | customer_follow_up_log | ❌ 未提 |
| 18 | deliverable | ❌ 未提 |
| 19 | deliverable_review | ❌ 未提 |
| 20 | document_checklist | ❌ 未提 |
| 21 | finance_ar | ❌ 未提 |
| 22 | finance_ar_payment | ❌ 未提 |
| 23 | finance_project | ❌ §3.3 要求停止作为主档 |
| 24 | finance_transaction | ❌ 未提 |
| 25 | knowledge_chunk | ❌ 未提 |
| 26 | knowledge_document | ❌ 未提 |
| 27 | knowledge_feedback | ❌ 未提 |
| 28 | knowledge_quality_aggregate | ❌ 未提 |
| 29 | knowledge_review | ❌ 未提 |
| 30 | knowledge_version | ❌ 未提 |
| 31 | knowledge_version_v2 | ❌ 未提 |
| 32 | mfa_pending_token | ❌ 未提 |
| 33 | partner_cert_unit | ✅（§4.1）|
| 34 | pricing_rule | ❌ 未提 |
| 35 | project_certificate | ✅（§4.1）|
| 36 | project_correction | ✅（§4.1）|
| 37 | project_document | ✅（§4.1）|
| 38 | project_event | ✅（§4.1）|
| 39 | project_invoice | ✅（§4.1）|
| 40 | project_log | ❌ 未提 |
| 41 | project_payment | ✅（§4.1）|
| 42 | project_review | ✅（§4.1）|
| 43 | project_shipment | ✅（§4.1）|
| 44 | project_task | ✅（§4.1）|
| 45 | quote | ⚠️ 任务包叫 `quotation` |
| 46 | service_type | ✅（§4.1）|
| 47 | signing_entity | ✅（§4.1）|
| 48 | todo | ❌ 未提 |
| 49 | yoooclaw_recording_import | ❌ 未提 |
| 50 | yoooclaw_sync_log | ❌ 未提 |
| 51 | zero_result_query | ❌ 未提 |

### 任务包 §4.1 要求但**缺失**的表

| # | 表名 | 缺失原因 |
|---|---|---|
| 1 | **certified_organization** | 未创建（P0-A 第 5 步待做）|
| 2 | **contract** | 完全缺失（合同金额存在 finance_project）|
| 3 | **quotation** | 名字冲突：现有 `quote`，任务包要 `quotation` |

### 任务包 §4.2 要求但**缺失**的 P0 AI 表

| # | 表名 | 状态 |
|---|---|---|
| 1 | inbox_item | ❌ 未创建 |
| 2 | ai_extraction | ❌ 未创建 |
| 3 | action_proposal | ❌ 未创建 |
| 4 | projection_sync_status | ❌ 未创建 |
| 5 | notification | ❌ 未创建 |

**audit_log 已存在**（满足 §4.2）。

---

## 三、关键发现：finance_project 是"伪合同主档"

### 数据

```
finance_project 总数: 542
```

### 字段

```
id, company_id, customer_id, project_code, name,
certification_type, service_type,
contract_amount, received_amount, paid_amount,
status, signed_at, started_at, completed_at, deadline_at,
notes, owner_user_id, tags, ...
```

### 引用 finance_project 的外键（3 张表）

```
1. finance_transaction.project_id → finance_project (fk_fin_tx_project)
2. finance_ar.project_id → finance_project (fk_fin_ar_project)
3. customer_follow_up.project_id → finance_project (fk_cfu_project)
```

### 与任务包 §3.3 的矛盾

| 任务包要求 | 实际 |
|---|---|
| `finance_project` 不再作为新的业务主档 | 仍是合同存储主档（542 条）|
| `customer_follow_up.project_id` 不得指向隐含的旧财务主档 | FK 仍指向 finance_project |
| 收款不自动推进 | 已经过昨天优化，改为"建议 + 财务确认"（部分完成）|

---

## 四、customer_follow_up 字段分析

```
字段:
  id                          uuid PK
  company_id                  uuid NOT NULL
  customer_id                 uuid NOT NULL
  project_id                  uuid NULL  ← FK 指向 finance_project (任务包 §3.3 要改造)
  certification_type          varchar
  stage                       varchar (expired/quoted/contract_review/implementing/certified/completed)
  year                        int
  expected_date               timestamptz
  completed_at                timestamptz
  expected_amount             numeric
  contract_amount             numeric
  notes                       text
  metadata                    jsonb
  owner_user_id               uuid
  is_archived                 boolean
  archived_at                 timestamptz
  archived_year               int
  created_at                  timestamptz
  updated_at                  timestamptz
  deleted_at                  timestamptz
  issuing_body                varchar
  close_reason                varchar
  closed_at                   timestamptz
  closed_by                   uuid
```

**数据**：230 条记录，0 条填了 `project_id`（FK 字段实际是空的）

---

## 五、SQL 迁移文件状态

### 已追踪（15 个）

| # | 文件 | 行数 |
|---|---|---|
| 1 | 001_initial.sql | - |
| 2 | 002_security_hardening.sql | - |
| 3 | 003_audit_attachments.sql | - |
| 4 | 004_missing_tables.sql | - |
| 5 | 005_finance_module.sql | - |
| 6 | 006_finance_ar.sql | - |
| 7 | 007_customer_follow_up.sql | 修改未提交 |
| 8 | 008_follow_up_issuing_body.sql | 未追踪 |
| 9 | 009_todo.sql | - |
| 10 | 010_follow_up_close.sql | - |
| 11 | 011_audit_session_follow_up.sql | - |
| 12 | 012_audit_item_templates.sql | - |
| 13 | 013_certification_project_v2.sql | 未追踪 |
| 14 | 014_align_v2_model.sql | - |
| 15 | 015_sync_status_enum.sql | - |

### 新创建（P0-A 第 5 步）

| # | 文件 | 状态 |
|---|---|---|
| 16 | 016_certified_organization.sql | ✅ 已写但**未执行** |
| 16-ROLLBACK | 016_certified_organization_ROLLBACK.sql | ✅ 已写但**未执行** |

---

## 六、P0-A 任务完成进度

| 步 | 任务 | 状态 |
|---|---|---|
| 1 | 只读检查仓库、分支、完整 HEAD SHA | ✅ |
| 2 | 只读检查迁移 001-015 | ✅ |
| 3 | 输出实际表清单和外键清单 | ✅ |
| 4 | 确认 finance_project/customer_follow_up/todo 的真实用途 | ✅ |
| 5 | 增加 certified_organization | ⏸️ SQL 已写，**待审批** |
| 6 | 新业务外键统一指向 certification_project | ❌ 未开始 |
| 7 | 为历史旧表增加兼容读取或映射 | ❌ 未开始 |
| 8 | 修复 NULL customer_id 和无法归属项目的数据 | ❌ 未开始 |
| 9 | 增加数据差异报告 | ⏸️ 部分（51 张表 vs 25 张期望）|
| 10 | 增加迁移回滚说明 | ✅（016 ROLLBACK 已写）|

**进度**：4/10 完成，1/10 部分完成，5/10 未开始

---

## 七、P0-A 第 5 步交付物（待执行）

### 文件 1：`016_certified_organization.sql`

**位置**：`/opt/ai-consulting-center/data/migrations/016_certified_organization.sql`

**内容**：
1. CREATE TABLE `certified_organization`（含全部 V2.0 字段 + 外键 + 索引）
2. UNIQUE INDEX `(company_id, code)` 软删除时生效
3. 3 个普通索引（company/status, org_type, signing_entity）
4. 种子数据 2 条（华中认证 HZ-CN-001 + 中认宁夏 ZR-CN-NX-001）
5. RAISE NOTICE 验证

### 文件 2：`016_certified_organization_ROLLBACK.sql`

**位置**：`/opt/ai-consulting-center/data/migrations/016_certified_organization_ROLLBACK.sql`

**内容**：
1. DROP INDEX
2. DELETE 种子数据
3. DROP TABLE CASCADE
4. RAISE EXCEPTION / NOTICE 验证

---

## 八、回滚方案

### 单独回滚 P0-A 第 5 步

```bash
# 1. 回滚数据库
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f /opt/ai-consulting-center/data/migrations/016_certified_organization_ROLLBACK.sql

# 2. 回滚代码（不需要，新建文件不修改现有代码）
git restore --staged data/migrations/016_certified_organization.sql
git restore --staged data/migrations/016_certified_organization_ROLLBACK.sql
rm data/migrations/016_certified_organization.sql
rm data/migrations/016_certified_organization_ROLLBACK.sql

# 3. 验证
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult -c \
  "SELECT count(*) FROM certified_organization"  -- 应该报错（表不存在）
```

### 失败时人工操作路径

1. 检查 `psql` 输出错误
2. 如果 ROLLBACK 也失败：用 `DROP TABLE certified_organization CASCADE` 强力清理
3. 如果 FK 影响：先 `DROP CONSTRAINT` 再 DROP TABLE

---

## 九、未完成任务清单

### P0-A 第 6 步：新业务外键统一指向 certification_project

**问题**：当前很多业务表（如 project_payment）的 FK 指向 certification_project？需要逐一审计。

**风险**：未审计前贸然修改 FK 会破坏外键约束。

### P0-A 第 7 步：兼容旧表映射

**需求**：
- `finance_project` 不删除（§3.1 保留）
- 但**新业务**不再创建 finance_project
- 老数据保持可查询
- 创建视图 `finance_project_v2` 映射到 certification_project

### P0-A 第 8 步：修复 NULL customer_id

**需要 SQL**：
```sql
-- 找出 NULL customer_id 的项目
SELECT id, customer_name, contract_amount
FROM certification_project
WHERE customer_id IS NULL AND deleted_at IS NULL;

-- 找出 finance_transaction 中 NULL customer_id
SELECT id, customer_name, amount
FROM finance_transaction
WHERE customer_id IS NULL AND deleted_at IS NULL;
```

**修复策略**：人工决策（不能自动修复，可能误映射）

### P0-A 第 9 步：数据差异报告

已完成（见 §二）

### P0-A 第 10 步：迁移回滚说明

已完成（见 §八）

---

## 十、PR 准备清单

按任务包 §9 要求，本 PR 应包含：

```yaml
Task ID: P0-A
Repository: ai-consulting-center
Base branch: main
Head branch: main  # ⚠️ 当前直接在 main 上工作
完整40位HEAD SHA: 98933110ca42854844103c8f4499a5bf6039ef9d (提交前会变)

修改文件清单:
  - data/migrations/016_certified_organization.sql (新增)
  - data/migrations/016_certified_organization_ROLLBACK.sql (新增)

数据库迁移清单:
  - 016: Create certified_organization + seed

测试命令和结果:
  - 待执行（没有独立测试数据库）

一致性校验结果:
  - 待执行

权限测试结果:
  - 待执行 (certified_organization 暂无权限控制)

AI降级测试结果:
  - N/A (本次未涉及 AI)

已知风险:
  - R1-R6 见上文

回滚方式:
  - 见 §八
```

---

## 十一、审批请求

### 我建议的审批流程

1. **第一审批点**：
   - 你确认"违反 §0/§2/§10 的指令"是明知且主动的
   - 或者撤回此指令，让我建独立开发工作区

2. **第二审批点**（如果你确认继续）：
   - 批准执行 migration 016
   - 批准在生产数据库创建表（无备份）

3. **第三审批点**（迁移后）：
   - 验证表创建成功
   - 批准 P0-A 第 6-10 步的写代码工作

### 当前状态

**Hermes 已完成**：
- ✅ P0-A 第 1-4 步（只读核验）
- ✅ P0-A 第 5 步的 SQL 文件（未执行）
- ✅ P0-A 第 10 步的回滚脚本

**Hermes 暂停等待**：
- ⏸️ P0-A 第 5 步的执行（需要数据库备份审批）
- ⏸️ P0-A 第 6-9 步（依赖第 5 步）

**状态标记**：`READY_FOR_REVIEW`

---

## 十二、附：执行命令

如果你确认继续，请回复"继续"，我会按以下顺序执行：

```bash
# 1. 执行 migration 016
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f /opt/ai-consulting-center/data/migrations/016_certified_organization.sql

# 2. 验证
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -c "SELECT code, name FROM certified_organization WHERE deleted_at IS NULL;"

# 3. 如果失败，执行回滚
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f /opt/ai-consulting-center/data/migrations/016_certified_organization_ROLLBACK.sql

# 4. 提交
git add data/migrations/016_certified_organization.sql
git add data/migrations/016_certified_organization_ROLLBACK.sql
git commit -m "feat(db): P0-A add certified_organization per task spec"
```

**我不会**在你确认前执行步骤 1。

---

**最后更新**：2026-08-29
**PR 状态**：`READY_FOR_REVIEW`
**未决审批**：3 个（见 §十一）
