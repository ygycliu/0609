# 合同管理模块方案 V2.2（PDF 导入驱动）

> **日期**：2026-09-02
> **作者**：Hermes Agent
> **状态**：已确认方向
> **基线 commit**：`39bfc55 docs: 合同管理模块升级方案（V2.2）`
> **重大调整**：V2.2 改为 **PDF 导入驱动**（不是手动录入）

---

## 零、用户确认的关键调整

| 原计划 | 调整后 |
|---|---|
| 手动创建合同 | **PDF 导入优先** |
| 工具菜单下 | **客户管理菜单下**（与客户平级）|
| 先设计所有字段 | **OCR 自动识别 + 人工确认** |
| 单一入口 | **PDF → 智能拆分 → 入库 → 反向补全** |

---

## 一、核心设计理念

### 1.1 PDF 导入工作流（**用户旅程**）

```
[客户/合同管理员]  上传 PDF/DOC
        ↓
[后端] PDF → OCR → 智能字段抽取（AI 解析）
        ↓
[前端] 预览表单（已填字段高亮 + 待确认标记）
        ↓
[人工] 确认/修改字段（点击任意字段可改）
        ↓
[后端] 智能匹配：
  - 客户名 → 匹配 customer 表（模糊）
  - 乙方主体 → 匹配 signing_entity
  - 合同号 → 全局去重
        ↓
[自动] 反向补全：
  - 缺失客户 → 创建客户（提示用户确认）
  - 缺失联系人 → 创建 customer_contact 表
  - 关联项目 → 按金额 + 客户 + 时间推荐
        ↓
[完成] 合同入库，PDF 存储，事件流记录
```

### 1.2 关键差异

- **PDF 是入口**：不是"先建合同再上传"
- **AI 抽取**：OCR 后用 LLM 二次结构化（识别"15000元"是合同金额、"FS/CA-SC24-342/1"是合同号）
- **反向补全**：从合同推客户信息（**客户信息可能比 customer 表更准确**）

---

## 二、新数据模型（4 张表）

### 2.1 核心表

```sql
-- ============================================================
-- 1. contract - 合同主表
-- ============================================================
CREATE TABLE contract (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  customer_id         UUID NOT NULL REFERENCES customer(id),
  contract_no         VARCHAR(200) NOT NULL,  -- 支持多编号 "FS-001|SC-002"
  contract_type       VARCHAR(20) NOT NULL DEFAULT 'main',
    -- 'main' 主合同 / 'supplement' 补充协议 / 'change' 合同变更 / 'terminate' 终止协议
  parent_contract_id  UUID REFERENCES contract(id),  -- 补充协议的父合同
  signing_entity_id   UUID NOT NULL REFERENCES signing_entity(id),
  title               VARCHAR(300),
  contract_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  certification_types TEXT[],  -- ['QMS', 'EMS', 'OHSMS', 'ISMS', 'EnMS', 'HACCP', 'FSS', 'SC']
  signed_at           DATE,
  effective_at        DATE,
  expire_at           DATE,
  bank_name           VARCHAR(100),
  bank_account        VARCHAR(50),
  bank_holder         VARCHAR(100),
  contact_person      VARCHAR(50),
  contact_phone       VARCHAR(30),
  service_type        VARCHAR(50),
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft' 草稿 / 'signed' 已签 / 'effective' 生效中 / 'completed' 已完成 / 'terminated' 已终止 / 'archived' 归档
  raw_extracted       JSONB,  -- V2.2 关键：AI 抽取的原始结构（保存以备查）
  extraction_confidence NUMERIC(3,2),  -- 0-1，AI 抽取的整体置信度
  source              VARCHAR(20) NOT NULL DEFAULT 'pdf_import',
    -- 'pdf_import' PDF 导入 / 'manual' 手动 / 'api' 外部 API
  notes               TEXT,
  file_id             UUID,  -- 主合同 PDF 引用
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_contract_customer ON contract(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_signing ON contract(signing_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_status ON contract(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_no ON contract(contract_no);
CREATE INDEX idx_contract_amount ON contract(contract_amount) WHERE deleted_at IS NULL;

-- ============================================================
-- 2. contract_file - 合同文件
-- ============================================================
CREATE TABLE contract_file (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  file_name     VARCHAR(300) NOT NULL,
  file_type     VARCHAR(20) NOT NULL,
  file_size     BIGINT NOT NULL,
  storage_path  TEXT NOT NULL,
  sha256        VARCHAR(64),
  ocr_status    VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' 待处理 / 'processing' 处理中 / 'done' 完成 / 'failed' 失败 / 'skipped' 跳过（文本版PDF）
  ocr_text      TEXT,
  ocr_extracted JSONB,  -- AI 二次结构化结果
  version       INTEGER NOT NULL DEFAULT 1,
  is_primary    BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_cfile_contract ON contract_file(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cfile_sha ON contract_file(sha256);

-- ============================================================
-- 3. contract_project - 合同↔项目关联
-- ============================================================
CREATE TABLE contract_project (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  certification_project_id UUID NOT NULL REFERENCES certification_project(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(12,2),  -- 分摊金额（如 QES 3万 = 1万/项目）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contract_id, certification_project_id)
);

-- ============================================================
-- 4. contract_event - 合同事件流
-- ============================================================
CREATE TABLE contract_event (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  event_type    VARCHAR(30) NOT NULL,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20),
  payload       JSONB,
  operator_id   UUID,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 智能匹配辅助表（**新增**）

```sql
-- ============================================================
-- 5. customer_alias - 客户别名（合同/发票上的写法可能不同）
-- ============================================================
CREATE TABLE customer_alias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  customer_id   UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  alias_name    VARCHAR(200) NOT NULL,  -- "甘肃东方百佳" 对应客户"甘肃东方百佳商贸有限公司"
  source        VARCHAR(50),  -- 'contract' 合同 / 'invoice' 发票 / 'email' 邮件
  match_count   INTEGER NOT NULL DEFAULT 1,  -- 匹配次数（用于智能推荐）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, alias_name)
);

CREATE INDEX idx_alias_name ON customer_alias(alias_name);

-- ============================================================
-- 6. contract_import_batch - 批量导入批次（V2.2 关键）
-- ============================================================
CREATE TABLE contract_import_batch (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  batch_name    VARCHAR(200),  -- "2026年认证合同导入"
  source_path   VARCHAR(500),  -- /mnt/renz/19.认证合同/2026年认证合同
  total_files   INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,  -- 待人工确认
  status        VARCHAR(20) NOT NULL DEFAULT 'processing',
    -- 'processing' 处理中 / 'awaiting_review' 待审核 / 'completed' 完成 / 'failed' 失败
  operator_id   UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
```

---

## 三、PDF 智能导入（**核心新功能**）

### 3.1 技术栈

```
PDF/DOC
   ↓
[1] pdftotext / mammoth（文本提取）
   ↓
[2] tesseract OCR（扫描版 fallback）
   ↓
[3] LLM 二次结构化（关键：qwen2.5:7b 本地模型）
   ↓
[4] 字段填充 + 客户名模糊匹配
   ↓
[5] 人工确认 UI
```

### 3.2 LLM Prompt（结构化抽取）

```python
EXTRACT_PROMPT = """
你是一个合同信息抽取助手。请从以下合同文本中提取结构化字段：

{ocr_text}

按 JSON 格式输出：
{
  "甲方客户名": "完整公司名（含'有限公司'等）",
  "乙方主体": "中认认证有限公司" 或 "中认认证有限公司宁夏分公司" 或 "华中国际认证检验集团有限公司" 或 "其他",
  "合同编号": "完整编号（如 FS/CA-SC24-342/1，多个用 | 分隔）",
  "合同类型": "main 主合同 / supplement 补充协议 / change 合同变更",
  "合同金额": 数字（元，无千分位）,
  "签订日期": "YYYY-MM-DD",
  "生效日期": "YYYY-MM-DD",
  "到期日期": "YYYY-MM-DD",
  "开户行": "完整名称",
  "账号": "账号",
  "户名": "完整户名",
  "联系人": "客户方联系人姓名",
  "联系电话": "11位手机号",
  "认证体系": ["QMS", "EMS", "OHSMS", "ISMS", "EnMS", "HACCP", "FSS", "SC"],
  "服务类型": "认证服务 / 培训 / 咨询",
  "原合同编号": "如果是补充协议，引用主合同号（可空）"
}

注意：
- 数字金额是阿拉伯数字（如 15000.00，不是"一万五"）
- 日期用 YYYY-MM-DD 格式
- 找不到的字段填 null
- 只输出 JSON，不要其他文字
"""
```

### 3.3 客户匹配算法

```typescript
function matchCustomer(extractedName: string, existingCustomers: Customer[]): Customer | null {
  // 1. 完全匹配
  const exact = existingCustomers.find(c => c.name === extractedName);
  if (exact) return exact;

  // 2. 别名匹配
  const alias = await db.customerAlias.findByName(extractedName);
  if (alias) return alias.customer;

  // 3. 模糊匹配（去除"有限公司"等）
  const normalized = extractedName.replace(/[（()）\s]/g, '');
  const fuzzy = existingCustomers.find(c => {
    const cn = c.name.replace(/[（()）\s]/g, '');
    return cn.includes(normalized) || normalized.includes(cn);
  });
  if (fuzzy) return { customer: fuzzy, confidence: 0.7 };

  // 4. 没匹配 - 标记为新客户
  return null;
}
```

### 3.4 反向补全流程

```
[1] 合同抽取到客户名"甘肃东方百佳" + 联系人"赵小兰" + 电话"18919260770"
[2] 查 customer 表：找到"甘肃东方百佳商贸有限公司"（模糊匹配，置信度 0.85）
[3] 查 customer.industry：缺失 → 用合同里的认证体系推断（QMS=制造业）
[4] 查 customer.notes：补全"认证合同：FS/CA-SC24-342/1（2024-03-15）"
[5] 查 customer.contact_person：缺失 → 写入"赵小兰"（从合同）
[6] 查 customer.contact_phone：缺失 → 写入"18919260770"
[7] 查 customer.credit_code：缺失 → 提示用户后续补
```

---

## 四、API 设计

### 4.1 PDF 导入流程端点（**重点**）

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/contracts/import/pdf` | 上传单个 PDF，OCR+AI 抽取后返回结构化字段 |
| `POST` | `/api/contracts/import/confirm` | 人工确认后入库 |
| `POST` | `/api/contracts/import/batch` | 批量扫描 `/mnt/renz/...` 目录 |
| `GET` | `/api/contracts/import/batches` | 导入批次列表 |
| `GET` | `/api/contracts/import/batches/:id` | 批次详情 + 进度 |
| `POST` | `/api/contracts/import/batches/:id/process` | 开始处理（异步）|
| `GET` | `/api/contracts/import/batches/:id/items` | 批次内合同项（待审核）|

### 4.2 合同 CRUD

| 方法 | 路径 | 权限 |
|---|---|---|
| `GET` | `/api/contracts` | 所有 |
| `GET` | `/api/contracts/:id` | 所有 |
| `POST` | `/api/contracts` | admin |
| `PATCH` | `/api/contracts/:id` | admin |
| `DELETE` | `/api/contracts/:id` | admin |
| `GET` | `/api/contracts/:id/files` | 所有 |
| `POST` | `/api/contracts/:id/files` | admin |
| `GET` | `/api/contracts/files/:id/download` | 所有 |
| `DELETE` | `/api/contracts/files/:id` | admin |
| `POST` | `/api/contracts/:id/projects` | admin |
| `DELETE` | `/api/contracts/:id/projects/:projectId` | admin |
| `GET` | `/api/contracts/stats` | 所有 |

### 4.3 反向补全 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/customers/:id/enrich-from-contracts` | 从该客户的合同回填缺失字段 |
| `POST` | `/api/customers/match-from-text` | 输入文本，返回最匹配的客户 |
| `POST` | `/api/customers/auto-create` | 确认创建新客户（带回填信息）|

### 4.4 关键的 import PDF 响应格式

```json
POST /api/contracts/import/pdf
Content-Type: multipart/form-data
Body: { file: <PDF> }

Response 200:
{
  "data": {
    "file": {
      "id": "...",
      "originalName": "2026--QES初审---甘肃欣烨盛.pdf",
      "size": 245678,
      "ocrStatus": "done",
      "ocrText": "<全文 5000字>"
    },
    "extracted": {
      "甲方客户名": "甘肃欣烨盛",
      "乙方主体": "中认认证有限公司宁夏分公司",
      "合同编号": "FS/CA-SC26-XXX/1",
      "合同类型": "main",
      "合同金额": 32000,
      "签订日期": "2026-03-15",
      "生效日期": "2026-03-15",
      "到期日期": "2029-03-14",
      "开户行": "宁夏银行光明支行",
      "账号": "1200000691398",
      "户名": "中认认证有限公司宁夏分公司",
      "联系人": "张三",
      "联系电话": "13800001111",
      "认证体系": ["QMS", "EMS", "OHSMS"],
      "服务类型": "认证服务"
    },
    "extractionConfidence": 0.92,
    "matched": {
      "customer": { "id": "...", "name": "甘肃欣烨盛", "matchType": "fuzzy", "confidence": 0.85 },
      "signingEntity": { "id": "...", "name": "中认宁夏" },
      "newCustomerNeeded": false
    },
    "suggested": {
      "newCustomerFields": { ... },
      "relatedProjects": [
        { "id": "...", "projectCode": "PRJ-2026-197", "matchScore": 0.95 }
      ]
    }
  }
}
```

---

## 五、UI 设计

### 5.1 菜单位置

```
侧边栏
└── 客户与项目（展开）
    ├── 项目工作台
    ├── 客户管理
    ├── 合同管理 ← V2.2 新增
    │   ├── 合同列表
    │   ├── 批量导入
    │   └── 导入批次
    ├── ...
```

### 5.2 页面（4 个）

#### 1. 合同列表 `customer/contracts`（默认页）

```
┌─────────────────────────────────────────────────────┐
│ 📋 合同管理                          [📤 批量导入] │
│                                                      │
│ [搜索框]  [主体▼] [客户▼] [状态▼] [类型▼]         │
│                                                      │
│ ┌────────────────────────────────────────────────┐ │
│ │ 合同编号     │ 客户        │ 主体 │ 金额  │ 状态  │ │
│ ├────────────────────────────────────────────────┤ │
│ │ FS-24-342   │ 东方百佳   │ 中认 │ 1.5万│生效中 │ │
│ │  补充: SC-018 │  甘肃欣烨盛 │ 华中 │ 3.2万│ 已签 │ │
│ └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### 2. PDF 导入向导 `customer/contracts/import`

```
┌─────────────────────────────────────────────────────┐
│ 📤 合同批量导入向导                                    │
│                                                      │
│ 步骤：① 选择源   ② 自动识别   ③ 人工确认   ④ 完成  │
│ ───────────────────────────────────────────────────│
│                                                      │
│ ● 源目录选择                                          │
│ ○ [📁 /mnt/renz/19.认证合同/2026年认证合同/]        │
│ ○ [📁 /mnt/renz/19.认证合同/20.2025年认证合同/]      │
│ ○ [📂 自定义上传]                                    │
│                                                      │
│ 扫描结果：找到 28 个文件                             │
│ ⏳ OCR 进度: ████████░░ 22/28 (79%)               │
│                                                      │
│ 已识别（自动）：                                      │
│  ┌────────────────────────────────────────────┐    │
│  │ ✅ 东方百佳补充协议 - 1.5万 - 中认 - 92%  │ [查看] │
│  │ ✅ 厚生记 Q初审 - 1.2万 - 华中 - 95%        │ [查看] │
│  │ ⏳ 甘肃欣烨盛 QES - 3.2万 - 识别中...      │       │
│  └────────────────────────────────────────────┘    │
│                                                      │
│ [继续] [跳过]                                        │
└─────────────────────────────────────────────────────┘
```

#### 3. 人工确认表单 `customer/contracts/import/:batchId/:itemId`

```
┌─────────────────────────────────────────────────────┐
│ 📄 2026--QES初审---甘肃欣烨盛认证服务合同书.pdf     │
│ ───────────────────────────────────────────────────│
│                                                      │
│ 左侧：原始 PDF 预览（缩略图）                        │
│                                                      │
│ 右侧：识别字段（可点击修改）                         │
│ ┌────────────────────────────────────────────────┐ │
│ │ 客户名 *                                          │ │
│ │ [甘肃欣烨盛           ] ← 模糊匹配→ 客户"甘肃欣烨盛"│ │
│ │ [✓ 已匹配]  [📝 手动修改]                       │ │
│ │                                                    │ │
│ │ 乙方主体 *                                         │ │
│ │ [中认认证有限公司宁夏分公司 ▼]                  │ │
│ │                                                    │ │
│ │ 合同编号 *                                         │ │
│ │ [FS/CA-SC26-XXX/1              ]                  │ │
│ │                                                    │ │
│ │ 合同金额 * (元)                                    │ │
│ │ [32000          ]                                  │ │
│ │                                                    │ │
│ │ 签订日期 *                                         │ │
│ │ [2026-03-15    ]                                  │ │
│ │                                                    │ │
│ │ 认证体系（多选）                                   │ │
│ │ [✓] QMS  [✓] EMS  [✓] OHSMS  [ ] ISMS        │ │
│ │                                                    │ │
│ │ 收款银行                                            │ │
│ │ [宁夏银行光明支行  ]                              │ │
│ │                                                    │ │
│ │ 账号                                                │ │
│ │ [1200000691398           ]                          │ │
│ │                                                    │ │
│ │ 关联项目（建议）                                    │ │
│ │ [✓] PRJ-2026-197 甘肃欣烨盛 QES初审  ¥32000     │ │
│ │     匹配度 95%：金额一致 + 客户名一致              │ │
│ │                                                    │ │
│ │ AI 抽取置信度：92%                                │ │
│ │ 原始文本：<折叠 5000字>                          │ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ [💾 保存入库] [⏭ 跳过] [❌ 标记为错误]              │
└─────────────────────────────────────────────────────┘
```

#### 4. 合同详情（升级版）

增加 tab：基本信息 / 关联项目 / 文件 / 事件流 / 关联客户补全历史

---

## 六、实施计划（7-10 天）

### 阶段 1（0.5 天）：数据库 + 基础结构

```bash
- migration 037：4 张主表 + 2 张辅助表
- 后端 file storage：/data/uploads/contracts/YYYY/MM/
- 创建 4 个文件夹模板
```

### 阶段 2（1.5 天）：OCR + AI 抽取引擎

```
- 封装 PDF 处理（pdftotext / tesseract / mammoth）
- LLM 结构化抽取（用 qwen2.5:7b 本地模型）
- 提示词优化（处理 10+ 份样本）
- 字段验证 + 置信度计算
```

### 阶段 3（1.5 天）：合同 CRUD + PDF 导入 API

```
- POST /api/contracts/import/pdf（核心：上传即返回结构化）
- POST /api/contracts/import/confirm（确认入库）
- 15 个 CRUD 端点
- 文件下载/上传/删除
```

### 阶段 4（1.5 天）：客户反向补全

```
- 模糊匹配算法（按名称 + 简称 + 别名）
- 自动补全：industry / contact / notes
- 创建新客户时从合同抽取信息
- 批量补全（一个客户的多个合同合并信息）
```

### 阶段 5（2 天）：前端 UI

```
- 合同列表（已有基础上加）
- PDF 导入向导（4 步骤）
- 人工确认表单（重点设计）
- 导入批次管理
- 项目页/客户页加"合同"块
```

### 阶段 6（1 天）：批量导入 + 历史数据迁移

```
- 扫描 /mnt/renz/19.认证合同/ 全部目录
- 历史 2025/2024/2023 合同导入
- 进度可视化
- 错误处理（无法识别的放一边）
```

### 阶段 7（0.5 天）：文档 + 测试

```
- API 文档
- 用户手册（PDF 导入操作）
- 自动化测试
- 性能优化
```

**总计**：~8.5 天

---

## 七、关键决策（已确认）

| 决策 | 选择 |
|---|---|
| 菜单位置 | **客户管理菜单下** ✅ |
| 启动方式 | **PDF 导入优先** ✅ |
| 反向补全 | **AI 识别 + 人工确认** ✅ |
| 抽取模型 | **本地 qwen2.5:7b**（不依赖外部 API）|
| OCR 服务 | 复用现有（pdftotext + tesseract）|
| 权限 | admin 写 / 所有人读 |
| 历史数据 | **分批导入**（2026 → 2025 → 更早）|

---

## 八、立即可做（最简单路径）

**P0-A**（0.5 天）：数据库 + 基础结构
- 创建 4 张表 + 索引
- 创建上传目录
- 创建 AI 抽取服务骨架

**P0-B**（1.5 天）：PDF 导入引擎
- OCR + AI 抽取
- 1 个端点：`POST /api/contracts/import/pdf`
- 命令行测试 10 份 PDF

**P0-C**（2 天）：UI 完善
- 导入向导
- 人工确认表单
- 列表页

---

## 九、关键提示

1. **AI 模型必须用本地 qwen2.5:7b**（避免外部 API 费用 + 隐私）
2. **OCR 复用现有服务**（pdftotext + tesseract + OCR fallback 已实现）
3. **置信度 < 70% 必须人工确认**（不能直接入库）
4. **客户名匹配算法要稳健**（合同上写"甘肃欣烨盛"，DB 是"甘肃欣烨盛有限公司"）
5. **文件存储去重**（SHA256，同一文件不重复存储）

---

## 十、风险与缓解

| 风险 | 缓解 |
|---|---|
| AI 抽取不准 | 置信度低 → 人工确认；保存原始文本可重新抽取 |
| 客户名匹配错 | 模糊匹配 + 人工选；不能自动创建客户 |
| 合同 PDF 太多 | 分批处理 + 进度条；后台异步 |
| 扫描版识别差 | OCR fallback（已实现）|
| 文件存储空间 | 200MB 限制 + 去重 |

---

## 十一、验收标准

1. **PDF 导入**：上传 1 份合同 → 30s 内返回结构化字段
2. **AI 抽取准确率**：≥ 85%（基于 30 份样本测试）
3. **客户匹配准确率**：≥ 95%（人工复核）
4. **关联项目准确率**：≥ 90%（按金额+客户+时间）
5. **历史导入**：2026 年 100+ 份合同 1 天内完成
6. **文件存储**：所有导入合同保留 PDF 副本

---

**待用户**：启动 P0-A（创建数据库）？还是先讨论某个具体设计点？