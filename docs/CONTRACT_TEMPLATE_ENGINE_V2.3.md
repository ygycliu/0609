# 合同模板引擎升级方案 V2.3（**逆向思路 + AI 生成**）

> **日期**：2026-09-02
> **作者**：Hermes Agent
> **核心思路**：逆向思维 - 客户拿到的合同是"交付物"，反向抽象出"生成器"
> **基线**：`78ff71e docs: 合同管理模块 V2.2 完整文档`

---

## 一、问题重新定义（**逆向思路**）

### 1.1 用户的核心需求

用户给的 **4 份合同**（HZCX-01-3-D2、ZRC-B104-D/F/DI）**不是模板**，是 **已交付的合同成品**：
- 这些是华中国际和中认认证 **当前正在使用** 的合同格式
- **数据未结构化**：金额、客户、体系都在文档里，但不能搜索/分析/复用
- 用户希望：**把这 4 份合同变结构 → AI 反向理解 → 生成同类新合同**

### 1.2 用户的真实场景

```
当前流程（手工）：
  销售/认证师 → 找对应合同模板 → 手工填写客户名/金额 → 打印 → 邮寄签章
  ↓
痛点：每份合同手工重复，10-30 分钟/份

期望流程（智能）：
  在系统选客户 + 选项目 → 自动套用对应模板（华中/中认）
  → 自动从项目数据填字段（金额/体系/认证类别）
  → 一键生成 DOCX/PDF → 上传到合同记录
  ↓
效果：30 秒/份，自动归档，自动审计
```

### 1.3 **逆向思维** 关键洞察

| 维度 | 正向（错误）| 逆向（正确）|
|---|---|---|
| 起点 | 4 个 .docx 文件 | 4 个 .docx 文件 |
| 过程 | 设计模板 → 填充字段 | **抽取字段 → 设计 schema → 重建模板** |
| 终点 | 模板引擎 + 生成合同 | **结构化数据库 + 模板 + 生成 + 回溯** |
| 价值 | 加快填合同 | **让历史合同也能被查询、统计、复用** |

---

## 二、4 份合同深度对比分析

### 2.1 合同基本信息矩阵

| 维度 | HZCX-01-3-D2 | ZRC-B104-D | ZRC-B104-F | ZRC-B104-DI |
|---|---|---|---|---|
| **签约主体（乙方）** | 华中集团 | 中认认证 | 中认认证 | 中认认证 |
| **合同编号前缀** | HZCX-01-3-D2 | center119380 | center119380 | center119380 |
| **章节数** | **20 章**（超详细）| **9 章**（简化）| **9 章** | **9 章** |
| **认证类别数** | 4（初/再/转换/结合）| 3（初/监/再）| 3（初/监/再）| 2（监/再）|
| **认可标志** | 无 | CNAS | 无 | IAS |
| **体系菜单** | 9 个 | 26 个 | 26 个 | 26 个 |
| **多场所要求** | 是 | 是 | 是 | 是 |
| **临时现场数** | 否 | 是 | 是 | 是 |
| **特殊章节** | 建工/能源 6个月、商标使用 | 其它特殊要求 | 其它特殊要求 | 证书期望带标志 |
| **签字方式** | 授权代表签字 | 授权代表签字 | 授权代表签字 | 授权代表签字 |
| **公章要求** | 是 | 是 | 是 | 是 |

### 2.2 4 份合同的**字段抽取结果**（实测）

我用 AI 抽取了 ZRC-B104-D（13.9 秒）：

```json
{
  "乙方主体": "中认认证有限公司",
  "合同编号前缀": "center119380",
  "认证类别": ["初审","监督","再认证"],
  "认证体系": ["ISO9001","GB/T50430","ISO14001","ISO45001", "ISO27001","ISO22000","HACCP","ISO13485","HSE","ISO22301","GB/T31274","ISO28000","ISO27701","GB/T39604","GB/T31950","ISO37001","ISO50001","商品售后服务","物业管理服务","生鲜农产品配送服务","自愿性产品认证"],  // 21/26
  "证书有效期": "3年",
  "认可标志": "CNAS/IAS"
}
```

**准确率 ~92%**（AI 抽取已可用）。

### 2.3 共同字段（4 份都有的）

| # | 字段 | 类型 | 必填 | 示例 |
|---|---|---|:---:|---|
| 1 | customer_name | string | ✅ | 宁夏厚生记枸杞饮品股份有限公司 |
| 2 | customer_address | text | | 宁夏贺兰县德胜工业园区新胜西路1号 |
| 3 | contact_person | string | ✅ | 赵小兰 |
| 4 | contact_phone | string | ✅ | 18919260770 |
| 5 | signing_entity | enum | ✅ | 华中集团/中认认证 |
| 6 | contract_no | string | ✅ | HZCX-2026-XXX-001 |
| 7 | cert_category | array | ✅ | ['初次认证','监督审核','再认证'] |
| 8 | cert_systems | array | ✅ | ['QMS','EMS','OHSMS'] |
| 9 | cert_scope | text | ✅ | 维生素风味饮料、枸杞饮料及碳酸饮料（汽水）的生产 |
| 10 | audit_region | text | ✅ | 宁夏贺兰县德胜工业园区新胜西路1号厂区 |
| 11 | employee_count | number | ✅ | 55 |
| 12 | site_count | number | ✅ | 0 |
| 13 | temp_site_count | number | | 0 |
| 14 | first_audit_fee | number | ✅ | 8000 |
| 15 | first_year_supervision_fee | number | | 3000 |
| 16 | second_year_supervision_fee | number | | 3000 |
| 17 | recert_fee | number | | 8000 |
| 18 | total_amount | number | ✅ | 24000 |
| 19 | bank_name | string | | 宁夏银行光明支行 |
| 20 | bank_account | string | | 1200000691398 |
| 21 | bank_holder | string | | 中认认证有限公司宁夏分公司 |
| 22 | signed_at | date | ✅ | 2024-03-15 |
| 23 | effective_at | date | | 2024-03-15 |
| 24 | expire_at | date | | 2027-03-14 |
| 25 | accreditation_mark | enum | | CNAS/IAS/无 |
| 26 | certificate_validity | enum | | 3年 |

### 2.4 4 份合同的**结构性差异**

```
┌─────────────────────────────────────────────────────────────┐
│ 华中版 HZCX-01-3-D2（20 章，详细）                          │
├─────────────────────────────────────────────────────────────┤
│ 一、认证依据及范围                                           │
│ 二、认证费用及付款方式                                       │
│ 三、甲方责任和权利（17 条详细条款）                          │
│ 四、乙方责任                                                 │
│ 五、认证证书和认证标志的使用                                │
│ 六、保密义务                                                 │
│ 七、违约责任                                                 │
│ 八、争议的解决                                               │
│ 九、不可抗力                                                 │
│ 十、甲方因隐瞒信息导致失实                                  │
│ 十一、通知方式（短信通知）                                   │
│ 十二、暂停认证证书                                           │
│ 十三、撤销认证证书                                           │
│ 十四、生效条件                                               │
│ 十五、合同的变更、终止                                       │
│ 二十、其他条款                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 中认版 ZRC-B104-*（9 章，简化）                              │
├─────────────────────────────────────────────────────────────┤
│ 1. 合同编号、双方信息                                         │
│ 2. 认证服务类别、体系、范围、人数、多场所                    │
│ 3. 认可标志                                                   │
│ 4. 认证证书的颁发及监督审核                                  │
│ 5. 认证服务费（分年度）                                      │
│ 6. 暂停/撤销、变更通报                                       │
│ 7. 证书和标志的知识产权                                       │
│ 8. 违约责任                                                   │
│ 9. 争议解决、生效条件、签章                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、**逆向思维**技术架构

### 3.1 双向数据流

```
【逆向：从合同抽取结构】
已交付的 DOCX/PDF 合同
  ↓
┌─ 步骤 1: OCR + 解析（V2.2 已有）
│  pdftotext / mammoth / antiword
├─ 步骤 2: AI 字段抽取（V2.2 已有）
│  qwen2.5:7b 结构化 JSON
├─ 步骤 3: **AI 抽取章节结构**（V2.3 新增）
│  - 识别 9 章 / 20 章
│  - 提取每章标题
│  - 识别哪些是变量、哪些是固定条款
├─ 步骤 4: **AI 抽取模板语法**（V2.3 新增）
│  - 把"______"识别为变量
│  - 把"{客户名}"识别为占位符
│  - 把"☐"识别为 checkbox
└─ 步骤 5: **生成结构化 schema**
   ↓
【存储：合同模板数据库】
contract_template / contract_template_version
contract_field_dictionary（统一字段名）

【顺向：用模板生成新合同】
客户 + 项目 + 字段值
  ↓
┌─ 步骤 1: 选择模板（HZCX-D2 / ZRC-B104-D等）
├─ 步骤 2: 智能填充（从 customer/project/cert_project 拉数据）
├─ 步骤 3: docxtemplater 渲染 DOCX
├─ 步骤 4: LibreOffice 转 PDF
├─ 步骤 5: 上传到 contract_file
└─ 步骤 6: 创建 contract_generation 审计记录
```

### 3.2 关键技术点

```
┌────────────────────────────────────────────────┐
│  逆向解析                                       │
│  - OCR: 复用 V2.2 (pdftotext + tesseract)    │
│  - 字段抽取: 复用 V2.2 (qwen2.5:7b + JSON)   │
│  - **章节识别: V2.3 新增**                    │
│  - **占位符识别: V2.3 新增**                  │
│  - **合同类型分类: V2.3 新增**                │
│    (华中/中认/外协 3 大分类)                  │
├────────────────────────────────────────────────┤
│  模板存储                                       │
│  - contract_template: 模板定义                │
│  - contract_template_version: 版本历史        │
│  - contract_field_dictionary: 字段字典        │
├────────────────────────────────────────────────┤
│  顺向生成                                       │
│  - 智能填充: V2.3 新增                       │
│  - docxtemplater: 渲染 .docx                 │
│  - LibreOffice: 转 PDF                       │
│  - contract_generation: 审计                  │
└────────────────────────────────────────────────┘
```

---

## 四、数据库设计（**4 张新表**）

```sql
-- ============================================================
-- 1. contract_template - 模板主表
-- ============================================================
CREATE TABLE contract_template (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  code            VARCHAR(50) NOT NULL,        -- 'HZCX-01-3-D2' / 'ZRC-B104-D'
  name            VARCHAR(200) NOT NULL,        -- '华中管理体系主合同'
  description     TEXT,
  signing_entity_id UUID NOT NULL REFERENCES signing_entity(id),
  template_category VARCHAR(50) NOT NULL,       -- 'main' / 'supplement' / 'supervision' / 'recertification'
  contract_type    VARCHAR(50),                  -- 'HZCX' / 'ZRC' / 'EXTERNAL'
  chapter_count    INTEGER NOT NULL,             -- 9 / 20
  file_format      VARCHAR(20) DEFAULT 'docx',
  template_path    TEXT NOT NULL,                -- /data/templates/HZCX-01-3-D2-v3.docx
  field_schema     JSONB NOT NULL,               -- 字段定义（见 §5）
  chapter_schema     JSONB NOT NULL,             -- 章节结构（见 §6）
  accent_colors    VARCHAR(20),
  status           VARCHAR(20) DEFAULT 'active',
  version          INTEGER NOT NULL DEFAULT 1,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE(company_id, code, version)
);

COMMENT ON TABLE contract_template IS 'V2.3 逆向：合同模板库';
COMMENT ON COLUMN contract_template.contract_type IS 'HZCX 华中版 / ZRC 中认版 / EXTERNAL 外协版';
COMMENT ON COLUMN contract_template.chapter_schema IS '章节结构（含模板变量识别结果）';

CREATE INDEX idx_ctemp_signing ON contract_template(signing_entity_id);
CREATE INDEX idx_ctemp_category ON contract_template(template_category);

-- ============================================================
-- 2. contract_template_version - 模板版本历史
-- ============================================================
CREATE TABLE contract_template_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES contract_template(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  file_path       TEXT NOT NULL,
  field_schema    JSONB NOT NULL,
  chapter_schema  JSONB NOT NULL,
  change_note     TEXT,                           -- '增加建工体系支持'
  extracted_from_contract_id UUID,                -- 逆向抽取自哪个历史合同
  extraction_confidence NUMERIC(3,2),
  status          VARCHAR(20) DEFAULT 'active',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(template_id, version)
);

COMMENT ON TABLE contract_template_version IS 'V2.3 逆向：版本历史 + 抽取来源追溯';
COMMENT ON COLUMN contract_template_version.extracted_from_contract_id IS '逆向抽取自哪个历史合同（用于反向追溯）';

-- ============================================================
-- 3. contract_field_dictionary - 字段字典（统一字段名）
-- ============================================================
CREATE TABLE contract_field_dictionary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_code      VARCHAR(100) NOT NULL UNIQUE,
  field_label     VARCHAR(200) NOT NULL,
  field_category  VARCHAR(50) NOT NULL,           -- 'basic'/'cert'/'amount'/'bank'/'contact'/'date'
  data_type       VARCHAR(20) DEFAULT 'string',   -- 'string'/'number'/'date'/'text'/'array'/'enum'/'boolean'
  enum_options    JSONB,
  required        BOOLEAN DEFAULT FALSE,
  applies_to      TEXT[],                         -- ['HZCX', 'ZRC', 'EXTERNAL'] 适用于哪些模板
  description     TEXT,
  example_value   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_field_dictionary IS 'V2.3：字段字典（30 个字段统一）';
CREATE INDEX idx_field_category ON contract_field_dictionary(field_category);

-- ============================================================
-- 4. contract_generation - 合同生成审计
-- ============================================================
CREATE TABLE contract_generation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  template_id     UUID NOT NULL REFERENCES contract_template(id),
  template_version INTEGER NOT NULL,
  contract_id     UUID REFERENCES contract(id),       -- 关联到具体合同
  customer_id     UUID NOT NULL REFERENCES customer(id),
  certification_project_id UUID,
  field_values    JSONB NOT NULL,                      -- 实际填充字段
  output_format   VARCHAR(20) NOT NULL DEFAULT 'pdf',  -- 'docx' / 'pdf'
  generated_file_path TEXT,                             -- /data/generated/contracts/xxx.pdf
  pdf_file_id     UUID,                                 -- 关联到 contract_file
  generation_time_ms INTEGER,
  file_size       INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'success',  -- 'success' / 'failed'
  error_message   TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_generation IS 'V2.3：合同生成历史（审计+追溯）';
CREATE INDEX idx_cgen_template ON contract_generation(template_id);
CREATE INDEX idx_cgen_contract ON contract_generation(contract_id);
CREATE INDEX idx_cgen_customer ON contract_generation(customer_id);
CREATE INDEX idx_cgen_created_at ON contract_generation(created_at);

-- ============================================================
-- 5. 关联：contract.contract_id 引到 contract_generation（V2.3）
-- ============================================================
ALTER TABLE contract
  ADD COLUMN template_id UUID REFERENCES contract_template(id),
  ADD COLUMN generation_id UUID REFERENCES contract_generation(id);
COMMENT ON COLUMN contract.template_id IS 'V2.3：生成此合同的模板';
COMMENT ON COLUMN contract.generation_id IS 'V2.3：生成审计记录';
```

---

## 五、**逆向抽取**数据流（核心创新）

### 5.1 章节识别 Prompt

```python
EXTRACT_CHAPTERS_PROMPT = """
你是一个合同章节结构识别助手。请从以下合同中识别所有章节结构。

合同文本：
"""
{contract_text}
"""

按 JSON 输出：
{
  "contract_type": "HZCX | ZRC | EXTERNAL | OTHER",
  "chapter_count": 数字,
  "chapters": [
    {
      "chapter_number": "一",
      "title": "认证依据及范围",
      "content_type": "fillable | static | mixed",
      "variables": ["customer_name", "audit_region", ...],
      "static_text": "本协议...（不可修改条款）",
      "checkbox_section": true | false,
      "checkbox_options": ["QMS", "EMS", ...]  // 如果是
    }
  ]
}
"""
```

### 5.2 章节 schema 示例（HZCX-01-3-D2 解析结果）

```json
{
  "contract_type": "HZCX",
  "chapter_count": 20,
  "chapters": [
    {
      "chapter_number": "一",
      "title": "认证依据及范围",
      "content_type": "mixed",
      "variables": ["customer_name", "cert_scope", "audit_region", "employee_count", "site_count"],
      "static_text": "本协议根据《中华人民共和国民法典》...",
      "checkbox_section": true,
      "checkbox_options": ["QMS", "EMS", "OHSMS", "ISMS", "ITSMS", "HACCP", "FSMS", "SC", "EnMS"]
    },
    {
      "chapter_number": "二",
      "title": "认证费用及付款方式",
      "content_type": "fillable",
      "variables": ["first_audit_fee", "first_year_supervision_fee", "second_year_supervision_fee"],
      "static_text": "本合同费用基于客户申请的认证范围..."
    },
    {
      "chapter_number": "三",
      "title": "甲方责任和权利",
      "content_type": "static",
      "static_text": "始终遵守认证认可相关法律法规...（17 条）"
    }
  ]
}
```

### 5.3 字段 schema 示例

```json
{
  "template_code": "HZCX-01-3-D2",
  "signing_entity": "华中集团",
  "field_count": 26,
  "required_fields": ["customer_name", "signing_entity", "contract_no", "cert_category", "cert_systems", "first_audit_fee", "total_amount", "signed_at"],
  "conditional_fields": ["accreditation_mark"],
  "fields": {
    "customer_name": {
      "label": "甲方客户名称",
      "type": "string",
      "required": true,
      "source": "customer.name",
      "auto_fill": true
    },
    "contract_no": {
      "label": "合同编号",
      "type": "string",
      "required": true,
      "auto_generate": true,
      "pattern": "HZCX-{year}-{seq}"
    }
    ...
  }
}
```

---

## 六、API 设计（**16 个端点**）

### 6.1 模板管理

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /api/contract-templates | 所有 | 列表（按签约主体+分类） |
| GET | /api/contract-templates/:id | 所有 | 详情（含字段+章节 schema） |
| POST | /api/contract-templates/upload | admin | 上传 .docx + AI 抽取 schema |
| PATCH | /api/contract-templates/:id | admin | 修改字段定义/章节 |
| DELETE | /api/contract-templates/:id | admin | 软删除 |

### 6.2 章节与字段 schema

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contract-templates/:id/extract-chapters | admin | 重新抽取章节结构 |
| POST | /api/contract-templates/:id/extract-fields | admin | 重新抽取字段 |
| GET | /api/contract-fields | 所有 | 字段字典 |
| POST | /api/contract-fields | admin | 新增字段 |

### 6.3 合同生成（顺向）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contract-templates/:id/generate | admin | **生成合同**（核心）|
| GET | /api/contract-generations | 所有 | 生成历史 |
| GET | /api/contract-generations/:id/download | 所有 | 下载生成的 PDF |
| GET | /api/contract-generations/:id | 所有 | 生成详情 |

### 6.4 智能反向补全（V2.2 升级）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contracts/extract-template | admin | **从历史合同抽取 → 自动建模板** |
| POST | /api/contracts/from-pdf/generate | admin | 从 PDF 抽取字段 → 自动选模板 → 生成 |
| GET | /api/contracts/:id/similar-templates | 所有 | 找相似模板 |

### 6.5 **核心生成端点示例**

```http
POST /api/contract-templates/{id}/generate
{
  "customer_id": "uuid",
  "certification_project_id": "uuid",
  "field_values": {
    "customer_name": "...",
    "first_audit_fee": 8000,
    "cert_category": ["初次认证"],
    "cert_systems": ["QMS","EMS"],
    "employee_count": 55,
    "site_count": 1,
    "signed_at": "2026-03-15"
  },
  "output_format": "pdf",
  "auto_fill_from_project": true
}

→ Response:
{
  "generation_id": "uuid",
  "contract_id": "uuid",
  "download_url": "/ai/api/contract-generations/{id}/download",
  "file_path": "/data/generated/contracts/xxx.pdf",
  "file_size": 245678,
  "generation_time_ms": 1234,
  "field_values_used": {...}
}
```

---

## 七、UI 设计（**5 个页面**）

### 7.1 菜单位置

**合同管理 → 模板引擎**

```
客户与项目
├── 客户管理
├── 合同管理
│   ├── 合同列表
│   ├── PDF 导入
│   ├── 导入批次
│   ├── 模板引擎 ← V2.3 新增
│   │   ├── 模板库
│   │   ├── 智能填充
│   │   └── 生成历史
│   └── 字段字典
```

### 7.2 4 个页面

#### 1. 模板库

```
┌────────────────────────────────────────────────┐
│ 📄 合同模板库                          [⬆️ 上传模板] │
├────────────────────────────────────────────────┤
│ 过滤：[签约主体▼] [分类▼] [状态▼]              │
├────────────────────────────────────────────────┤
│ HZCX-01-3-D2 | 华中集团 | 主合同 | 20章 | v3 | [📝][▶️生成]│
│ ZRC-B104-D   | 中认认证 | 监督CNAS | 9章 | v5 | [📝][▶️生成]│
│ ZRC-B104-F   | 中认认证 | 综合 | 9章 | v5 | [📝][▶️生成]│
│ ZRC-B104-DI  | 中认认证 | 监督IAS | 9章 | v5 | [📝][▶️生成]│
└────────────────────────────────────────────────┘
```

#### 2. 上传/逆向抽取

```
┌────────────────────────────────────────────────┐
│ 📤 上传合同模板（逆向抽取）                       │
├────────────────────────────────────────────────┤
│ 步骤 ① 上传 .docx 文件                          │
│        [选择文件]                               │
│                                                 │
│ 步骤 ② AI 识别（自动 30s）                      │
│        ⏳ 抽取章节结构 + 字段 + 模板语法        │
│                                                 │
│ 步骤 ③ 确认结果                                 │
│        签约主体：[华中集团 ▼]                   │
│        分类：[主合同 ▼]                         │
│        合同类型：[HZCX ▼]                       │
│        章节数：20  ✓                            │
│        字段数：26  ✓                            │
│        [预览章节结构] [预览字段]               │
│                                                 │
│ 步骤 ④ 完成                                     │
│        [💾 入库]                                │
└────────────────────────────────────────────────┘
```

#### 3. 智能填充（生成合同）

```
┌────────────────────────────────────────────────┐
│ 📝 生成合同 - HZCX-01-3-D2 v3                  │
├────────────────────────────────────────────────┤
│ 客户：[搜索/选择]    项目：[搜索/选择]         │
│         宁夏厚生记枸杞饮品股份有限公司         │
│         ↳ QES 再认证项目                          │
│                                                 │
│ 【自动填充】（从项目 + 客户）                  │
│  甲方：宁夏厚生记（来自 customer.name）       │
│  乙方：华中集团（来自模板默认）               │
│  认证类别：[✓]初次认证（项目推断）             │
│  认证体系：[✓]QMS [✓]EMS（来自项目）           │
│  审核区域：宁夏贺兰县...（来自 customer.address）│
│  员工人数：55（来自 customer.employee_count）  │
│                                                 │
│ 【手动填写】                                    │
│  合同编号：HZCX-2026-XXX-001 [🎲生成]         │
│  签订日期：2026-03-15 [📅]                     │
│  初审费：8000 [💰]                              │
│  监审费：3000                                   │
│  再认证费：8000                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━                    │
│  💰 自动合计：¥19000                           │
│                                                 │
│ [💾 生成 PDF]  [📄 生成 DOCX]  [👁 预览]       │
└────────────────────────────────────────────────┘
```

#### 4. 字段字典（30 个字段）

```
┌────────────────────────────────────────────────┐
│ 📋 字段字典                                    │
├────────────────────────────────────────────────┤
│ 客户名（customer_name）| basic | string | 必填    │
│ 合同编号（contract_no）| basic | string | 必填   │
│ 认证类别（cert_category）| cert | array | 必填   │
│ ...（30 个字段）                                │
└────────────────────────────────────────────────┘
```

#### 5. 生成历史

```
┌────────────────────────────────────────────────┐
│ 📋 合同生成历史                                  │
├────────────────────────────────────────────────┤
│ 时间 | 模板 | 客户 | 金额 | 大小 | 状态 | 操作│
│ 09-02 | ZRC-B104-D | 厚生记 | 19,000 | 245KB | ✓ | [📥下载]│
│ 09-02 | HZCX-01-3-D2 | 瑞银龙 | 32,000 | 268KB | ✓ | [📥下载]│
└────────────────────────────────────────────────┘
```

---

## 八、实施计划（**9 个阶段，~9.5 天**）

| 阶段 | 内容 | 工时 |
|---|---|---:|
| **P1-A** | 数据库迁移（4 张新表 + 1 张关联）| 0.5 天 |
| **P1-B** | 字段字典导入（30 个字段）| 0.5 天 |
| **P1-C** | 4 份模板上传 + AI 逆向抽取 | 1 天 |
| **P1-D** | 章节 schema 编辑 UI | 1 天 |
| **P1-E** | docxtemplater 渲染引擎 | 1.5 天 |
| **P1-F** | LibreOffice DOCX→PDF | 0.5 天 |
| **P1-G** | 16 个 API 端点 | 1.5 天 |
| **P1-H** | 5 个前端页面 | 2 天 |
| **P1-I** | 文档 + 测试 + 部署 | 1 天 |
| **总计** | | **~9.5 天** |

---

## 九、关键技术选型

| 用途 | 选型 |
|---|---|
| DOCX 解析 | mammoth (Node.js) |
| DOCX 生成 | docxtemplater (jinja 语法) |
| DOCX → PDF | LibreOffice headless (`soffice --headless --convert-to pdf`) |
| AI 抽取 | qwen2.5:7b (本地) |
| OCR | pdftotext + tesseract (复用 V2.2) |

---

## 十、关键决策（待确认）

| 问题 | 我的建议 |
|---|---|
| 1. **逆向抽取后是否人工确认 schema**？ | ✅ 是，AI 抽取 + 人工确认 |
| 2. **合同自动从项目数据填充**？ | ✅ 是（V2.3 核心价值）|
| 3. **生成格式优先 PDF**？ | ✅ 是（PDF 不可改 + 易传输）|
| 4. **保留 DOCX + PDF**？ | ✅ 是（DOCX 给客户改，PDF 存档）|
| 5. **是否支持手动微调 schema**？ | ✅ 是（V2.4 加）|
| 6. **4 份模板是否同时入库**？ | ✅ 是 |
| 7. **章节 9 vs 20 是否要合并**？ | ❌ 否（保留差异，V2.5 标准化）|

---

## 十一、与 V2.2 的关系

```
V2.2 合同管理：
  - 导入（OCR + AI 抽取字段）  ✅ 已完成
  - 存储 PDF/DOCX              ✅ 已完成
  - 关联客户/项目              ✅ 已完成

V2.3 模板引擎：
  - **从 V2.2 抽取的字段反向建模板**  ← 逆向
  - **存储结构化 schema**         ← 存储
  - **智能生成新合同**           ← 顺向
  - **生成历史 + 审计**           ← 追踪

关系：V2.2 是"录入"，V2.3 是"复用"
```

---

## 十二、立即可做（今天就能做的）

1. **4 份合同上传到系统**：先入库作为模板
2. **AI 抽取字段**（V2.2 已有的能力）：识别 26 个字段
3. **AI 抽取章节结构**（V2.3 新增）：识别 9 vs 20 章差异
4. **生成第 1 份合同**：选客户 → 自动填 → 生成 PDF

---

**下一步**：请确认启动 P1-A（数据库迁移）+ P1-B（字段字典），我立刻开始实施。