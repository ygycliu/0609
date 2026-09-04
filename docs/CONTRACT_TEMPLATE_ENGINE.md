# 合同模板引擎升级方案（V2.3）

> **日期** | 2026-09-02 |
>---|---|
> **作者** | Hermes Agent |
> **状态** | 待用户确认 |
> **基线** | commit `78ff71e docs: 合同管理模块 V2.2 完整文档` |

---

## 一、需求背景

用户提供 4 份合同模板：

1. **HZCX-01-3-D2** - 管理体系、服务认证合同书（华中集团）
2. **ZRC-B104-D** - 认证服务合同书（中认认证，**带 CNAS**）
3. **ZRC-B104-F** - 认证服务合同书（中认认证，**无认可标志**）
4. **ZRC-B104-DI** - 认证服务合同书（中认认证，**带 IAS**）

需要把这些模板变成 **可配置、可填充、可生成的模板引擎**，支撑：

- AI 自动填写字段
- 一键生成合同 Word/PDF
- 多模板版本管理
- 字段统一存储在 `contract` 表

---

## 二、4 份模板对比

### 2.1 共同字段

| 字段 | 模板1 | 模板2 | 模板3 | 模板4 |
|---|:---:|:---:|:---:|:---:|
| 合同编号（自动）| HZCX-01-3-D/2 | center119380 | center119380 | center119380 |
| 甲方（客户）| ✅ | ✅ | ✅ | ✅ |
| 乙方主体 | 华中集团 | 中认认证 | 中认认证 | 中认认证 |
| 认证类别（checkbox）| 初/监/再/转换 | 初/监/再 | 初/监/再 | 监/再 |
| 认证体系（多选）| 9 个（华中版）| 26 个（ZRC 完整版）| 26 个 | 26 个 |
| 认证范围 | ✅ | ✅ | ✅ | ✅ |
| 审核区域 | ✅ | ✅ | ✅ | ✅ |
| 员工人数 | ✅ | ✅ | ✅ | ✅ |
| 分公司/分厂数 | ✅ | ✅ | ✅ | ✅ |
| 临时现场数 | ❌ | ✅ | ✅ | ✅ |
| 初审费 + 监审费 + 再认证费 | ✅ | ✅ | ✅ | ✅ |
| 证书有效期 | 3年 | 3年 | 3年 | 3年 |

### 2.2 关键差异

| 维度 | HZCX-01-3-D2 | ZRC-B104-D | ZRC-B104-F | ZRC-B104-DI |
|---|---|---|---|---|
| **签约主体** | 华中集团 | 中认认证 | 中认认证 | 中认认证 |
| **合同编号前缀** | HZCX-01-3-D2 | center119380 | center119380 | center119380 |
| **认证类别数** | 4（含转换）| 3 | 3 | 2 |
| **认可标志** | 无 | CNAS | 无 | IAS |
| **体系菜单** | 9 个 | 26 个 | 26 个 | 26 个 |
| **特殊章节** | 建工/能源体系 6个月运行 | 证书期望带认可标志 | 其它特殊要求 | 证书期望带认可标志 |

---

## 三、模板引擎设计

### 3.1 数据模型（4 张新表）

```sql
-- ============================================================
-- 1. contract_template - 模板主表
-- ============================================================
CREATE TABLE contract_template (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  code            VARCHAR(50) NOT NULL,        -- 'HZCX-01-3-D2'
  name            VARCHAR(200) NOT NULL,        -- '华中管理体系主合同'
  description     TEXT,
  signing_entity_id UUID REFERENCES signing_entity(id),
  category        VARCHAR(50),                  -- 'main'/'supplement'/'supervision'/'recertification'
  file_format     VARCHAR(20) DEFAULT 'docx',   -- docx/pdf
  template_path   TEXT NOT NULL,                -- /data/templates/HZCX-01-3-D2.docx
  field_schema    JSONB NOT NULL,               -- 字段定义
  accent_colors   VARCHAR(20),
  status          VARCHAR(20) DEFAULT 'active',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE(company_id, code)
);

COMMENT ON TABLE contract_template IS 'V2.3：合同模板库';

-- ============================================================
-- 2. contract_template_version - 模板版本
-- ============================================================
CREATE TABLE contract_template_version (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES contract_template(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  file_path     TEXT NOT NULL,                  -- /data/templates/HZCX-01-3-D2-v3.docx
  field_schema  JSONB NOT NULL,                 -- 该版本的字段定义
  change_note   TEXT,                           -- '增加建工体系支持'
  status        VARCHAR(20) DEFAULT 'draft',    -- draft/active/archived
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(template_id, version)
);

COMMENT ON TABLE contract_template_version IS 'V2.3：模板版本历史';

-- ============================================================
-- 3. contract_generation - 合同生成记录（关键审计）
-- ============================================================
CREATE TABLE contract_generation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  template_id     UUID NOT NULL REFERENCES contract_template(id),
  template_version INTEGER NOT NULL,
  contract_id     UUID REFERENCES contract(id),    -- 关联到具体合同
  customer_id     UUID NOT NULL REFERENCES customer(id),
  certification_project_id UUID,
  field_values    JSONB NOT NULL,                   -- 实际填充的字段值
  generated_file_path TEXT,                          -- 生成的 PDF/DOCX
  pdf_file_id     UUID,                              -- 上传到 contract_file
  generation_time_ms INTEGER,                       -- 性能指标
  status          VARCHAR(20) NOT NULL DEFAULT 'success',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_generation IS 'V2.3：合同生成历史（审计用）';
CREATE INDEX idx_cgen_template ON contract_generation(template_id);
CREATE INDEX idx_cgen_contract ON contract_generation(contract_id);

-- ============================================================
-- 4. contract_field_dictionary - 字段字典（统一字段名）
-- ============================================================
CREATE TABLE contract_field_dictionary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_code      VARCHAR(100) NOT NULL UNIQUE,    -- 'customer_name'
  field_label     VARCHAR(200) NOT NULL,           -- '客户名称'
  field_category  VARCHAR(50),                      -- 'basic'/'amount'/'bank'/'cert'
  data_type       VARCHAR(20) DEFAULT 'string',    -- 'string'/'number'/'date'/'array'
  enum_options    JSONB,                            -- 限定值
  required        BOOLEAN DEFAULT FALSE,
  description     TEXT,
  example_value   TEXT
);

COMMENT ON TABLE contract_field_dictionary IS 'V2.3：字段字典（统一字段名映射）';
```

### 3.2 字段字典（统一字段定义）

```sql
INSERT INTO contract_field_dictionary (field_code, field_label, field_category, data_type, enum_options, required) VALUES
('customer_name', '甲方客户名称', 'basic', 'string', NULL, TRUE),
('customer_address', '甲方通讯地址', 'basic', 'string', NULL, FALSE),
('contact_person', '甲方联系人', 'contact', 'string', NULL, FALSE),
('contact_phone', '联系电话', 'contact', 'string', NULL, FALSE),
('signing_entity', '乙方主体', 'basic', 'enum', '["华中集团","中认认证","外协认证"]', TRUE),
('contract_no', '合同编号', 'basic', 'string', NULL, TRUE),
('cert_category', '认证类别', 'cert', 'array', '["初审","监督","再认证","转换"]', TRUE),
('cert_systems', '认证体系', 'cert', 'array', '["QMS","EMS","OHSMS","ISMS","ITSMS","HACCP","FSMS","SC","EnMS","ISO9001","ISO14001","ISO45001","ISO27001","ISO22000","HACCP","ISO13485","HSE","ISO22301","GB/T50430","GB/T31274","ISO28000","ISO27701","GB/T39604","GB/T31950","GB/T35770","ISO37001","ISO50001"]', TRUE),
('cert_scope', '认证范围', 'cert', 'text', NULL, FALSE),
('audit_region', '审核区域场所', 'cert', 'text', NULL, FALSE),
('employee_count', '员工人数', 'basic', 'number', NULL, FALSE),
('site_count', '分公司/分厂数', 'basic', 'number', NULL, FALSE),
('temp_site_count', '临时现场数', 'basic', 'number', NULL, FALSE),
('first_audit_fee', '初审认证费', 'amount', 'number', NULL, TRUE),
('first_year_supervision_fee', '第一年监督审核费', 'amount', 'number', NULL, FALSE),
('second_year_supervision_fee', '第二年监督审核费', 'amount', 'number', NULL, FALSE),
('recert_fee', '再认证费', 'amount', 'number', NULL, FALSE),
('total_amount', '合同总金额', 'amount', 'number', NULL, TRUE),
('bank_name', '收款开户行', 'bank', 'string', NULL, FALSE),
('bank_holder', '收款户名', 'bank', 'string', NULL, FALSE),
('bank_account', '收款账号', 'bank', 'string', NULL, FALSE),
('signed_at', '签订日期', 'basic', 'date', NULL, TRUE),
('effective_at', '生效日期', 'basic', 'date', NULL, FALSE),
('expire_at', '到期日期', 'basic', 'date', NULL, FALSE),
('accreditation_mark', '认可标志', 'cert', 'enum', '["CNAS","IAS","无"]', FALSE),
('certificate_validity', '证书有效期', 'cert', 'enum', '["1年","2年","3年"]', FALSE);
```

---

## 四、4 份模板的字段映射（field_schema）

### 4.1 HZCX-01-3-D2（华中集团主合同）

```json
{
  "template_code": "HZCX-01-3-D2",
  "signing_entity": "华中集团",
  "fields": {
    "customer_name": {"required": true, "page": 1, "section": "一、认证依据及范围"},
    "cert_category": {"type": "checkbox", "options": ["初次认证","再认证","转换机构","结合再认证","结合次监督"], "section": "认证类型"},
    "cert_systems": {"type": "checkbox_multi", "options": ["QMS","EMS","OHSMS","ISMS","ITSMS","HACCP","FSMS","SC","EnMS"], "section": "认证领域"},
    "first_audit_fee": {"required": true, "section": "二、认证费用"},
    "first_year_supervision_fee": {"required": true},
    "second_year_supervision_fee": {"required": true},
    "accreditation_mark": {"value": "无"},
    "certificate_validity": {"value": "3年"}
  },
  "special_sections": ["建工/能源体系 6个月运行", "多场所清单附件"]
}
```

### 4.2 ZRC-B104-D（中认认证 监督+CNAS）

```json
{
  "template_code": "ZRC-B104-D",
  "signing_entity": "中认认证",
  "fields": {
    "customer_name": {"required": true, "section": "委托方（甲方）"},
    "cert_category": {"type": "checkbox", "options": ["初审","监督","再认证"], "section": "认证服务类别"},
    "cert_systems": {"type": "checkbox_multi", "options": [26个体系], "section": "认证服务项目"},
    "employee_count": {"required": true, "section": "认证所覆盖的员工总人数"},
    "site_count": {"required": true},
    "temp_site_count": {"required": true},
    "first_audit_fee": {"section": "认证服务费"},
    "first_year_supervision_fee": {"section": "认证服务费"},
    "second_year_supervision_fee": {"section": "认证服务费"},
    "recert_fee": {"section": "认证服务费"},
    "accreditation_mark": {"type": "checkbox", "options": ["CNAS","IAS"], "section": "证书是否期望带认可标志"}
  }
}
```

### 4.3 ZRC-B104-F（中认认证 综合无标志）

```json
{
  "template_code": "ZRC-B104-F",
  "signing_entity": "中认认证",
  "fields": {
    // 同 D，但无认可标志选项
    "accreditation_mark": {"value": "无"},
    "special_sections": ["其它特殊要求"]
  }
}
```

### 4.4 ZRC-B104-DI（中认认证 监督+IAS）

```json
{
  "template_code": "ZRC-B104-DI",
  "signing_entity": "中认认证",
  "fields": {
    // 同 D，但认证类别只有监/再
    "cert_category": {"options": ["监督","再认证"]},
    "accreditation_mark": {"options": ["IAS"]}
  }
}
```

---

## 五、API 设计（10 个端点）

### 5.1 模板 CRUD

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /api/contract-templates | 所有 | 列表 |
| GET | /api/contract-templates/:id | 所有 | 详情（含字段 schema）|
| POST | /api/contract-templates | admin | 创建（上传模板）|
| PATCH | /api/contract-templates/:id | admin | 更新 |
| DELETE | /api/contract-templates/:id | admin | 软删除 |
| POST | /api/contract-templates/:id/versions | admin | 新版本 |
| GET | /api/contract-templates/:id/versions | 所有 | 版本历史 |

### 5.2 字段字典

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /api/contract-fields | 所有 | 字段字典 |

### 5.3 合同生成（核心）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contract-templates/:id/generate | admin | 生成合同（核心）|
| GET | /api/contract-generations | 所有 | 生成历史 |
| GET | /api/contract-generations/:id/download | 所有 | 下载生成的合同 |

### 5.4 智能生成（增强）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contracts/from-pdf/generate | admin | 从 PDF 抽取的字段一键生成 |

---

## 六、合同生成核心逻辑

### 6.1 生成流程

```
POST /api/contract-templates/:id/generate
{
  "customer_id": "...",
  "certification_project_id": "...",
  "field_values": {
    "customer_name": "...",
    "first_audit_fee": 8000,
    ...
  },
  "output_format": "pdf" | "docx"
}

↓

1. 加载模板版本
2. 校验字段（required + data_type + enum）
3. 智能填充（从 customer/project/certification_project 自动填充）
4. 替换占位符（jinja 语法）
5. 生成 DOCX → 转 PDF（LibreOffice / mammoth）
6. 上传到 contract_file
7. 创建 contract_generation 审计记录
8. 返回 PDF URL
```

### 6.2 占位符语法

模板用 `{{ }}` 占位符：

```jinja
合同编号：{{ contract_no }}

甲方：{{ customer_name }}（以下简称"甲方"）
乙方：{{ signing_entity }}（以下简称"乙方"）

认证类别：{% for c in cert_category %}{{ c }} {% endfor %}

审核区域：{{ audit_region }}

初审费：¥{{ first_audit_fee | number_format }}

员工人数：{{ employee_count }} 人
```

### 6.3 技术选型

- **模板渲染**：[docx-templates](https://github.com/eltorio/docx-templates) 或 [python-docx](https://python-docx.readthedocs.io/)
- **DOCX → PDF**：[LibreOffice headless](https://www.libreoffice.org/) 或 `mammoth` + `pdfkit`
- **填充引擎**：Node.js 端用 [docxtemplater](https://docxtemplater.com/)

---

## 七、UI 设计

### 7.1 菜单位置

**合同管理 → 模板引擎**（在 PDF 导入旁边）

### 7.2 4 个页面

#### 1. 模板列表

```
┌────────────────────────────────────────────────┐
│ 📄 合同模板库              [⬆️ 上传新模板]    │
├────────────────────────────────────────────────┤
│ HZCX-01-3-D2 | 华中主合同 | v3 | [预览][填充]│
│ ZRC-B104-D   | 中认监督CNAS | v5 | [预览][填充]│
│ ZRC-B104-F   | 中认综合 | v5 | [预览][填充]   │
│ ZRC-B104-DI  | 中认监督IAS | v5 | [预览][填充] │
└────────────────────────────────────────────────┘
```

#### 2. 模板上传向导

```
1. 选择文件（.docx/.pdf）
2. 选择签约主体（华中/中认/外协）
3. 选择分类（主/补充/监督/再认证）
4. 输入模板名/编号
5. AI 自动提取字段（schema 生成）
6. 人工确认/修改
7. 完成
```

#### 3. 填充表单

```
┌────────────────────────────────────────────────┐
│ 📝 生成合同 - ZRC-B104-D v5                  │
├────────────────────────────────────────────────┤
│ 客户：[搜索/选择]    项目：[搜索/选择]        │
│                                                │
│ 基础信息（自动填充）：                          │
│  甲方：宁夏厚生记食品有限公司                 │
│  乙方：中认认证有限公司                         │
│  合同编号：ZRC-2026-XXX-001（自动生成）      │
│                                                │
│ 认证类别：[✓]初审 [✓]监督 [✓]再认证          │
│                                                │
│ 认证体系：                                     │
│  [✓] ISO9001  [✓] ISO14001                    │
│  [ ] ISO45001 [ ] ISO27001                    │
│                                                │
│ 认证范围：                                     │
│  [公司业务描述...]                             │
│                                                │
│ 费用（自动计算）：                             │
│  初审费：8000  监审费：3000  再认证费：8000    │
│  合计：¥19000                                 │
│                                                │
│ [💾 生成 PDF]  [📝 生成 DOCX]                │
└────────────────────────────────────────────────┘
```

#### 4. 生成历史

```
┌────────────────────────────────────────────────┐
│ 📋 合同生成历史                                  │
├────────────────────────────────────────────────┤
│ 时间 | 模板 | 客户 | 金额 | 状态 | [下载]     │
│ 2026-09-02 | ZRC-B104-D v5 | 厚生记 | 19000 | ✓ | [📥] │
└────────────────────────────────────────────────┘
```

---

## 八、实施计划（7-10 天）

| 阶段 | 内容 | 工时 |
|---|---|---:|
| **P1-A** | 数据库迁移（4 张新表）| 0.5 天 |
| **P1-B** | 字段字典导入（30 个字段）| 0.5 天 |
| **P1-C** | 模板引擎核心（docxtemplater 集成）| 2 天 |
| **P1-D** | DOCX→PDF 转换（LibreOffice）| 1 天 |
| **P1-E** | 4 个 API 端点（生成/下载）| 1.5 天 |
| **P1-F** | 前端 UI（4 页面）| 2 天 |
| **P1-G** | 智能填充（从项目/客户自动填）| 1 天 |
| **P1-H** | 文档 + 测试 + 部署 | 1 天 |
| **总计** | | **~9.5 天** |

---

## 九、与现有 V2.2 模块的关系

| V2.2 已有 | V2.3 新增 |
|---|---|
| 合同 CRUD | **模板引擎** |
| PDF 导入 | **一键生成** |
| 文件存储 | **生成历史** |
| 事件流 | **审计增强** |

```
V2.2：合同管理
  - 导入（OCR + AI 抽取）
  - 存储（PDF 上传）
  - 关联（客户/项目）

V2.3：模板引擎
  - 模板库（4 份模板入库）
  - 智能填充（从 project/customer 自动填）
  - 一键生成（Word/PDF）
  - 生成历史（审计）
```

---

## 十、关键决策（需用户确认）

| 问题 | 我的建议 |
|---|---|
| 1. 模板渲染引擎用 docxtemplater？ | ✅ 是 |
| 2. DOCX→PDF 用 LibreOffice？ | ✅ 是 |
| 3. 模板版本号规则？ | v1, v2, v3... 顺序号 |
| 4. 是否自动从 certification_project 推断认证类别？ | ✅ 是 |
| 5. 合同生成是否要双重审批？ | ❌ 先不，V2.4 加 |
| 6. 模板是否支持电子签？ | ❌ 先不，V2.4 |

---

## 十一、待用户确认

1. **P1-A 启动数据库迁移？**
2. **4 份模板全部入库？**
3. **生成格式优先 PDF 还是 DOCX？**
4. **合同编号自动生成规则**？
5. **是否要权限控制**（普通用户不能生成合同）？

---

**当前已完成 V2.2（合同管理），V2.3 是下一阶段。**