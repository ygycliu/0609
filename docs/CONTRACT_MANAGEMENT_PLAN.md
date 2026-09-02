# 合同管理模块升级方案（V2.1 → V2.2）

> **日期**：2026-09-02
> **作者**：Hermes Agent
> **状态**：待用户确认
> **基线 commit**：`8c0bfbb feat(finance): 财务看板统计卡穿透到交易明细（V2.1）`

---

## 一、需求背景

### 1.1 用户反馈

> "我发现系统缺少合同管理，我们平时有合同的 PDF 文件，需要和项目关联起来。"

### 1.2 现状调研

- **物理文件**：`/mnt/renz/19.认证合同/2026年认证合同/` 下有 100+ 份合同（按主体 + 年份分目录）
  - 中认合同（**B - 中认宁夏**作为乙方）
  - 华中合同（**A - 华中集团**作为乙方）
  - 博创合同
  - 外协委托协议
  - 监督合同
  - 补充协议（如 `2026----东方百佳--合同更改补充协议.doc`）
- **命名规范**：`2026---客户名--类型-编号.{pdf|doc}`
- **数据库现状**：
  - ❌ **无合同表**（最关键缺失）
  - ✅ `certification_project` 有 `signing_entity_id`（签约主体）
  - ✅ `finance_project` 有 `contract_amount`（合同金额）和 `signed_at`（签订日期）
  - ✅ `customer` 表已有（532 客户）

### 1.3 合同内容（已解析一份样本）

| 字段 | 示例 | 是否必填 |
|---|---|---|
| 客户名称（甲方）| 甘肃东方百佳商贸有限公司 | ✅ |
| 乙方主体 | 中认认证有限公司 / 中认宁夏分公司 | ✅ |
| 合同编号 | FS/CA-SC24-342/1, SC/CA-SC24-018/1 | ✅（多编号用逗号）|
| 合同金额（元）| 15000.00 | ✅ |
| 收款账户 | 宁夏银行光明支行 / 1200000691398 | ✅ |
| 联系人 / 电话 | 赵小兰 / 18919260770 | 可选 |
| 认证体系 | QMS / EMS / OHSMS / ISMS | ✅（checkbox）|
| 签订日期 | 2024-XX-XX | ✅ |
| 备注 | 补充协议说明 | 可选 |

---

## 二、业务目标

### 2.1 核心目标

> "让每份合同 PDF 都能找到归宿，每个项目都能看到对应合同。"

### 2.2 用户场景

| 角色 | 场景 | 期望 |
|---|---|---|
| 🧑‍💼 销售/合同管理员 | 签了新合同 | 上传 PDF → 系统识别客户/金额 → 关联项目 → 录入 |
| 🧑‍💼 审核员 | 准备现场审核 | 在项目页看到合同 PDF + 关键条款 |
| 🧑‍💼 财务 | 核对到款 | 在项目页看到合同金额 + 到账记录 |
| 🧑‍💼 管理者 | 季度报告 | 按主体/客户/月份看合同总额 |
| 🔧 客服/查询 | 客户问 "我们合同什么条款" | 搜索客户名 → 找到所有合同版本 |

### 2.3 关键问题

1. **一份合同可能对应多个项目**（如 QES 三体系 = 3 张证书 = 1 个合同？或 3 个合同？）
2. **一份合同可能多次修改**（补充协议 vs 主合同）
3. **历史合同 PDF 在 `/mnt/renz` 物理目录**，要批量导入
4. **扫描版 PDF**（已用 OCR 支持）

---

## 三、数据模型设计

### 3.1 核心表（4 张）

```sql
-- ============================================================
-- 1. contract - 合同主表
-- ============================================================
CREATE TABLE contract (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,  -- 哪个主体作为甲方（运营方 = 中认/华中）
  customer_id         UUID NOT NULL REFERENCES customer(id),
  contract_no         VARCHAR(100) NOT NULL,  -- 合同编号（支持多编号用 "|" 分隔）
  contract_type       VARCHAR(20) NOT NULL,    -- 'main' 主合同 / 'supplement' 补充协议 / 'change' 合同变更
  parent_contract_id  UUID REFERENCES contract(id),  -- 补充协议的父合同
  signing_entity_id   UUID NOT NULL REFERENCES signing_entity(id),  -- 签约主体（华中/中认/外协）
  title               VARCHAR(300) NOT NULL,    -- 合同标题
  contract_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 合同总金额
  certification_types TEXT[],                      -- 认证体系 ['QMS', 'EMS', 'OHSMS']
  signed_at           DATE,                       -- 签订日期
  effective_at        DATE,                       -- 生效日期
  expire_at           DATE,                       -- 到期日期
  bank_name           VARCHAR(100),               -- 收款开户行
  bank_account        VARCHAR(50),                -- 收款账号
  bank_holder         VARCHAR(100),               -- 收款户名
  contact_person      VARCHAR(50),                -- 客户联系人
  contact_phone       VARCHAR(30),                -- 客户联系电话
  service_type        VARCHAR(50),                -- 服务类型（对应 fin template）
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft' 草稿 / 'signed' 已签 / 'effective' 生效中 / 'completed' 已完成 / 'terminated' 已终止 / 'archived' 归档
  notes               TEXT,
  source              VARCHAR(20) NOT NULL DEFAULT 'manual',
    -- 'manual' 手动录入 / 'import' 批量导入 / 'ocr' OCR 识别
  file_id             UUID,                       -- 主合同 PDF 引用
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_contract_customer ON contract(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_signing ON contract(signing_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_status ON contract(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_no ON contract(contract_no);

-- ============================================================
-- 2. contract_file - 合同文件（支持多版本/补充协议）
-- ============================================================
CREATE TABLE contract_file (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  file_name     VARCHAR(300) NOT NULL,    -- 原始文件名
  file_type     VARCHAR(20) NOT NULL,    -- 'pdf' / 'doc' / 'docx'
  file_size     BIGINT NOT NULL,
  storage_path  TEXT NOT NULL,            -- /data/uploads/contracts/YYYY/MM/xxx.pdf
  sha256        VARCHAR(64),                -- 文件 hash（去重 + 完整性校验）
  ocr_status    VARCHAR(20) DEFAULT 'pending',  -- pending / done / failed / skipped
  ocr_text      TEXT,                       -- OCR 提取的文本
  ocr_extracted JSONB,                     -- OCR 提取的结构化字段（自动识别）
  version       INTEGER NOT NULL DEFAULT 1,  -- 文件版本（同一合同多次上传）
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否主版本
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_cfile_contract ON contract_file(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cfile_sha ON contract_file(sha256);

-- ============================================================
-- 3. contract_project - 合同与认证项目关联（多对多）
-- ============================================================
CREATE TABLE contract_project (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  certification_project_id UUID NOT NULL REFERENCES certification_project(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(12,2),         -- 该项目分摊的合同金额（如 3体系合同 3万 = 1万/项目）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(contract_id, certification_project_id)
);

CREATE INDEX idx_cp_contract ON contract_project(contract_id);
CREATE INDEX idx_cp_cert ON contract_project(certification_project_id);

-- ============================================================
-- 4. contract_event - 合同事件流（追溯用）
-- ============================================================
CREATE TABLE contract_event (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  event_type    VARCHAR(30) NOT NULL,    -- 'created' / 'signed' / 'amended' / 'terminated' / 'renewed' / 'file_uploaded'
  from_status   VARCHAR(20),
  to_status     VARCHAR(20),
  payload       JSONB,                   -- 事件详情（如补充协议金额变更）
  operator_id   UUID,
  operator_name VARCHAR(100),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cevent_contract ON contract_event(contract_id);
```

### 3.2 ER 关系图

```
customer ──┬── contract (1:N, 1 客户可多个合同)
           └── certification_project (1:N)

signing_entity ─── contract (1:N, 1 主体可签多个合同)

contract ──┬── contract_file (1:N, 1 合同可多个版本/补充协议)
           ├── contract_project ── certification_project (M:N, 1 合同对应多项目)
           ├── contract_event (1:N, 状态变更追溯)
           └── finance_project (1:N, 合同 → 财务项目)

certification_project ── contract_project ── contract (M:N 反向)
```

### 3.3 与现有数据的关系

| 现有字段 | 处理方式 |
|---|---|
| `finance_project.contract_amount` | 保留（汇总值），但来源指向 contract |
| `finance_project.signed_at` | 保留（汇总值），来源指向 contract |
| `certification_project.signing_entity_id` | 保留（项目级主体），关联合同后可能冗余 |
| `customer` | 复用（不需要改） |
| `signing_entity` | 复用（不需要改） |

### 3.4 文件存储

- **物理位置**：`/opt/ai-consulting-center/data/uploads/contracts/YYYY/MM/{uuid}.{ext}`
- **不重复存储**：用 SHA256 去重（同一文件不同合同只存一份）
- **文件大小限制**：200 MB（与现有上传一致）
- **支持格式**：pdf, doc, docx, jpg, png（合同扫描件）
- **OCR**：自动调用（用现有 OCR 服务，扫描版 PDF 走 fallback）

---

## 四、API 设计

### 4.1 REST 端点（15 个）

| 方法 | 路径 | 用途 | 权限 |
|---|---|---|---|
| `GET` | `/api/contracts` | 列表（分页+过滤）| 所有人读 |
| `GET` | `/api/contracts/:id` | 详情（含关联项目、文件）| 所有人读 |
| `POST` | `/api/contracts` | 创建（手动）| admin |
| `PATCH` | `/api/contracts/:id` | 更新元数据 | admin |
| `DELETE` | `/api/contracts/:id` | 软删除 | admin |
| `POST` | `/api/contracts/:id/terminate` | 终止合同 | admin |
| `POST` | `/api/contracts/:id/files` | 上传 PDF | admin |
| `GET` | `/api/contracts/:id/files` | 列出文件 | 所有人读 |
| `GET` | `/api/contracts/files/:fileId/download` | 下载文件 | 所有人读 |
| `DELETE` | `/api/contracts/files/:fileId` | 删除文件 | admin |
| `POST` | `/api/contracts/:id/projects` | 关联项目 | admin |
| `DELETE` | `/api/contracts/:id/projects/:projectId` | 取消关联 | admin |
| `GET` | `/api/contracts/stats` | 统计（按主体/客户/月份）| 所有人读 |
| `POST` | `/api/contracts/import` | 批量导入（从 /mnt/renz 扫描）| admin |
| `GET` | `/api/contracts/search` | 全文搜索（标题+编号+客户名）| 所有人读 |

### 4.2 关键查询参数

```
GET /api/contracts?
  signing_entity_id=...
  customer_id=...
  status=signed
  start_date=2026-01-01
  end_date=2026-12-31
  certification_type=QMS     # 按体系过滤（用 GIN 索引）
  q=...                       # 全文搜索
  min_amount=10000
  max_amount=100000
  has_file=true               # 只看有附件的
  sort_by=signed_at_desc
  limit=50
  offset=0
```

### 4.3 响应格式

```json
{
  "data": {
    "id": "...",
    "contractNo": "FS/CA-SC24-342/1|SC/CA-SC24-018/1",
    "title": "管理体系认证服务合同",
    "customerId": "...",
    "customerName": "甘肃东方百佳商贸有限公司",
    "signingEntityId": "...",
    "signingEntityName": "中认认证有限公司",
    "contractType": "main",
    "status": "signed",
    "contractAmount": 15000,
    "certificationTypes": ["QMS", "EMS"],
    "signedAt": "2024-03-15",
    "bankName": "宁夏银行光明支行",
    "bankAccount": "1200000691398",
    "files": [
      { "id": "...", "fileName": "合同.pdf", "size": 220160, "isPrimary": true, "ocrStatus": "done" }
    ],
    "projects": [
      { "id": "...", "projectCode": "PRJ-2026-197", "status": "completed", "allocatedAmount": 15000 }
    ],
    "createdAt": "2024-03-15T10:00:00Z",
    "events": [
      { "eventType": "signed", "at": "2024-03-15", "operator": "刘军" }
    ]
  }
}
```

---

## 五、UI 设计

### 5.1 导航

```
侧边栏 → 工具 → 合同管理
```

### 5.2 页面结构（4 个页面）

#### 1. 合同列表（`/tools/contracts`）

```
┌─────────────────────────────────────────────────────┐
│ 📋 合同管理                              [+ 新建合同] │
│                                                      │
│ [搜索框]  [主体▼] [客户▼] [状态▼] [类型▼] [日期范围] │
│                                                      │
│ ┌──────────────────────────────────────────────────┐│
│ │ 合同编号        │ 客户        │ 主体 │金额 │状态 │PDF││
│ ├──────────────────────────────────────────────────┤│
│ │FS/CA-SC24-342   │ 东方百佳   │ 中认 │ 1.5万│ 已签 │📄││
│ │SC/CA-SC24-018   │ 甘肃欣烨盛 │ 中认 │ 3.2万│ 生效 │📄││
│ └──────────────────────────────────────────────────┘│
│ [<<] [1] [2] [3] [>>]   共 87 条   显示 50 条/页    │
└─────────────────────────────────────────────────────┘
```

#### 2. 合同详情（`/tools/contracts/:id`）

```
┌─────────────────────────────────────────────────────┐
│ ← 返回  合同 #FS/CA-SC24-342/1                       │
│ 甘肃东方百佳商贸有限公司 - 管理体系认证服务合同   │
│                                                      │
│ [基本信息] [关联项目] [文件] [事件流] [财务报表]     │
│                                                      │
│ 基本信息：                                            │
│ 主体：中认认证有限公司（乙方）   客户：东方百佳（甲方）│
│ 金额：¥15,000  签订：2024-03-15  生效至：2027-03-14│
│ 体系：[QMS] [EMS] [OHSMS]                           │
│ 银行：宁夏银行光明支行 / 1200000691398            │
│ 状态：●生效中  备注：补充协议变更金额              │
│                                                      │
│ [下载主合同 PDF]  [上传补充协议]  [下载补充协议]   │
└─────────────────────────────────────────────────────┘
```

#### 3. 项目页加"合同"块（**关键**）

在 ProjectDetailPage 加新 tab：
```
[时间线] [项目信息] [财务记录] [合同📋] [资料] [整改] [评审]

合同 tab 内容：
  合同 #FS/CA-SC24-342/1
  ├─ 中认认证有限公司
  ├─ 金额：¥15,000
  ├─ 状态：生效中
  ├─ [下载合同 PDF] [查看合同详情]
  └─ 补充协议：2024-06-01 ¥15,000→¥15,000
```

#### 4. 客户详情页加"合同"块（**关键**）

在 CustomerDetailPage 加：
```
[基本信息] [联系人] [项目] [合同📋] [财务] [跟进]

合同列表：
  2024-03-15  管理体系认证服务合同  ¥15,000  生效中
  2024-06-01  合同更改补充协议       ¥0      已归档
  2025-09-15  监督审核合同          ¥5,000  生效中
```

### 5.3 关键交互

- **OCR 自动识别**：上传 PDF → 自动识别客户名/金额/编号 → 提示用户确认
- **智能关联项目**：上传时如果合同金额匹配某个 finance_project.contract_amount，自动建议关联
- **批量导入向导**：从 `/mnt/renz/19.认证合同/` 扫描 → 列表预览 → 批量确认导入
- **合同与项目穿透**：合同详情点"项目" → 跳到项目页；项目页点"合同" → 跳到合同详情

---

## 六、实施计划

### 阶段划分（5 个阶段，约 7-10 天）

| 阶段 | 内容 | 工时 | 价值 |
|---|---|---:|---|
| **P0-A** | 数据库迁移 037（4 张表 + 索引）| 0.5 天 | 基础 |
| **P0-B** | 后端 API（15 个端点）| 2 天 | 核心 |
| **P0-C** | 上传/下载/OCR 集成 | 1 天 | 文件流 |
| **P0-D** | 前端：合同列表/详情/上传 | 2 天 | 用户界面 |
| **P0-E** | 关联到项目页 + 客户页 | 1 天 | 穿透 |
| **P0-F** | 批量导入向导 | 0.5 天 | 数据迁移 |
| **P0-G** | 财务看板加合同金额 | 0.5 天 | 联动 |
| **P0-H** | 文档 + 测试 + 部署 | 1 天 | 质量 |

**总计**：~8.5 天

### 阶段依赖

```
P0-A (DB) → P0-B (API) → {P0-C (文件) + P0-D (UI)} → P0-E (穿透) → P0-F (导入) → P0-G (联动) → P0-H (收尾)
```

### 立即可做（P0-A）

```bash
# 1. 创建 migration
cat > /opt/ai-consulting-center/data/migrations/037_contracts.sql <<'EOF'
-- 4 张表 + 索引（如上设计）
EOF

# 2. 跑迁移
psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -v ON_ERROR_STOP=1 \
  -f /opt/ai-consulting-center/data/migrations/037_contracts.sql
```

---

## 七、数据迁移（历史合同）

### 7.1 来源

```
/mnt/renz/04、技术服务合同/     - 100+ 份
/mnt/renz/05、申请表与认证合同/ - 50+ 份
/mnt/renz/07、业务协作合同（个体户） - 20+ 份
/mnt/renz/18.其他业务合同/      - 30+ 份
/mnt/renz/19.认证合同/         - 500+ 份（核心）
```

### 7.2 迁移策略

1. **第一阶段**：只迁移"最核心"的 2026 年认证合同（`19.认证合同/2026年认证合同/`）
2. **第二阶段**：扫描 19.认证合同/20.2025 和 21.2025以前
3. **第三阶段**：合并 04/05/07/18 历史合同

### 7.3 智能识别

每份 PDF：
1. **OCR 提取**（用现有 OCR 服务）
2. **解析关键字段**（客户名、金额、编号、日期）
3. **匹配 customer 表**（按名称模糊）
4. **匹配 finance_project**（按金额 + 客户 + 日期）
5. **人工确认**（导入向导 UI 列出待确认列表）

---

## 八、风险与决策

### 8.1 关键决策点

| 决策 | 选项 | 我的建议 |
|---|---|---|
| **数据库位置** | 新表 vs 扩展 cert_project | **新表**（更清晰） |
| **合同编号唯一性** | 强 vs 弱 | **弱唯一**（一个客户合同可多编号）|
| **物理存储位置** | /data/uploads/ vs /mnt/renz/contracts/ | **/data/uploads/**（统一管理）|
| **OCR 处理** | 同步 vs 异步 | **异步**（后台任务不阻塞上传）|
| **合同金额是否可改** | 锁定 vs 可改 | **可改**（补充协议场景），但记录历史 |
| **历史合同处理** | 一次性 vs 分批 | **分批 + 智能去重** |
| **权限** | admin vs 所有人读 | **admin 写 + 所有人读** |

### 8.2 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| OCR 识别不准确 | 字段填写错误 | 必填字段人工确认 |
| 客户名匹配失败 | 重复创建客户 | 模糊匹配 + 人工合并 |
| 文件太大 | 存储成本 | 200MB 限制 + SHA256 去重 |
| 扫描版 PDF 太多 | OCR 慢 | 异步后台 + 进度条 |
| 合同版本混乱 | 找不到最新 | `is_primary` 标记 + 按时间倒序 |
| 多份合同同一项目 | 金额重复计算 | 关联表分摊金额（allocated_amount）|

### 8.3 不做的事（明确边界）

- ❌ 合同**电子签署**（集成电子签服务）
- ❌ 合同**OCR 模板**（不同模板需要定制化）
- ❌ 合同**自动提醒**（到期前 30 天通知 - P2 后续）
- ❌ 合同**审批流程**（多级审批 - 复杂）
- ❌ 合同**对比/版本合并**（git 风格的 diff）

---

## 九、验收标准

### 9.1 功能验收（P0 完成时）

- ✅ 上传合同 PDF → 自动 OCR 识别关键字段
- ✅ 手工创建合同 → 关联客户 + 主体 + 项目
- ✅ 合同列表支持：搜索/筛选/分页/排序
- ✅ 合同详情显示：基本信息 + 关联项目 + 文件 + 事件流
- ✅ 项目详情页"合同"tab 显示关联合同 + 下载链接
- ✅ 客户详情页"合同"tab 显示该客户所有合同
- ✅ 财务看板"应收"区点击 → 跳到对应合同（如有）
- ✅ 合同终止/补充协议/续签 状态流转
- ✅ 批量导入：从 `/mnt/renz/19.认证合同/2026年认证合同/` 一键导入

### 9.2 数据质量

- 字段填充率 ≥ 90%（客户、金额、编号、日期）
- 文件挂载率 ≥ 95%（2026 年合同 100% 有 PDF）
- 关联率 ≥ 80%（2026 年合同关联到项目）

### 9.3 性能

- 列表页加载 < 500ms（分页 + 索引）
- OCR 异步处理 < 30s/页
- 大文件下载支持断点续传

---

## 十、后续路线图（V2.2 之后）

| 版本 | 特性 |
|---|---|
| V2.2 | 合同管理（本方案） |
| V2.3 | 合同到期自动提醒（提前 30/60/90 天）|
| V2.4 | 合同续签工作流（到期前自动生成续签单）|
| V2.5 | 合同模板引擎（自定义模板 + 自动填充）|
| V2.6 | 电子签集成（e-签宝/法大大）|
| V3.0 | 合同全生命周期管理（起草→审批→签署→归档）|

---

## 十一、待用户确认

1. **是否启动 P0-A（创建数据库）**？
2. **合同主体选择**：
   - A. 默认签约主体 = 中认（乙方），华中在外协场景
   - B. 用户每次录入时选择
   - C. 推断（按合同文件名含"中认"或"华中"）
3. **历史合同批量导入**：先做 2026 年的（~120 份）？
4. **OCR 异步 vs 同步**：异步（用现有后台任务）还是同步等待？
5. **前端位置**：工具菜单下 vs 客户与项目下 vs 财务下？

---

**方案制定人**：Hermes Agent
**待用户审阅**：刘军
**下次 review**：P0-A 完成后