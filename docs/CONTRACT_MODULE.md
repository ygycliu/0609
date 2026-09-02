# 合同管理模块文档（V2.2）

> **版本**：V2.2
> **日期**：2026-09-02
> **状态**：✅ 已上线
> **菜单位置**：客户与项目 → 合同管理

---

## 一、功能概述

合同管理模块是 V2.2 重大升级，实现：

1. **PDF 智能导入**：上传合同 PDF/DOC → OCR + AI 抽取 → 人工确认入库
2. **结构化存储**：6 张表（contract / contract_file / contract_project / contract_event / customer_alias / contract_import_batch）
3. **客户反向补全**：从合同识别客户信息，自动补全 customer 表
4. **项目关联**：合同与认证项目 M:N 关联
5. **事件追溯**：所有合同变更都有审计日志

---

## 二、API 端点（20 个）

### 2.1 合同 CRUD（7 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /api/contracts | 所有 | 列表（带过滤）|
| GET | /api/contracts/:id | 所有 | 详情（含文件+项目+事件）|
| POST | /api/contracts | admin | 创建 |
| PATCH | /api/contracts/:id | admin | 更新 |
| DELETE | /api/contracts/:id | admin | 软删除 |
| GET | /api/contracts/stats/summary | 所有 | 统计 |

### 2.2 PDF 导入（2 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contracts/import/pdf | admin | 上传 PDF，OCR + AI 抽取 |
| POST | /api/contracts/import/confirm | admin | 确认入库 |

### 2.3 文件管理（4 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /api/contracts/:id/files | 所有 | 列出文件 |
| POST | /api/contracts/:id/files | admin | 上传文件（追加版本）|
| GET | /api/contracts/files/:fileId/download | 所有 | 下载文件 |
| DELETE | /api/contracts/files/:fileId | admin | 删除文件 |

### 2.4 项目关联（2 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contracts/:id/projects | admin | 关联项目 |
| DELETE | /api/contracts/:id/projects/:projectId | admin | 取消关联 |

### 2.5 批量导入（3 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/contracts/import/batch | admin | 启动批量扫描（异步）|
| GET | /api/contracts/import/batches | 所有 | 批次列表 |
| GET | /api/contracts/import/batches/:id | 所有 | 批次详情 |

### 2.6 客户反向补全（5 个）

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| POST | /api/customers/match-from-text | 所有 | 文本→客户匹配 |
| POST | /api/customers/auto-create | admin | 从合同抽取信息新建客户 |
| GET | /api/customers/:id/enrich-from-contracts | 所有 | 从合同回填客户缺失字段 |
| POST | /api/customers/batch-match | 所有 | 批量匹配 |
| GET | /api/customers/aliases/:customerId | 所有 | 列出客户别名 |

---

## 三、PDF 智能导入流程

```
┌────────────────────────────────────────────────┐
│ 1. 用户上传文件                                  │
│    POST /api/contracts/import/pdf              │
│    Form: file=合同.pdf                          │
└────────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────────┐
│ 2. 服务端：                                      │
│    a) 保存到 /data/uploads/contracts/YYYY/MM/ │
│       （SHA256 去重）                          │
│    b) 提取文本：                                │
│       - pdftotext（文本版 PDF）               │
│       - 失败 → pdftoppm + tesseract OCR       │
│       - .doc → antiword                         │
│       - .docx → mammoth                          │
│    c) AI 抽取（qwen2.5:7b）：                  │
│       - 提示词：结构化 JSON 输出               │
│       - 字段：甲方/乙方/编号/金额/体系...      │
│       - 置信度计算（非空字段比例）            │
│    d) 智能匹配客户：                            │
│       - 完全匹配 → 直接用                     │
│       - 别名匹配 → 用别名                     │
│       - 模糊匹配 → 标准化（去"有限公司"）     │
│       - 子串匹配 → 双向包含                   │
│       - 未匹配 → 标记需新建客户               │
│    e) 智能匹配签约主体：                       │
│       - 按名称匹配 A/B/C                      │
└────────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────────┐
│ 3. 返回结构化 JSON                              │
│    {                                            │
│      file: {原始名, 大小, sha256, usedOcr}     │
│      text: "OCR 提取的全文（~5000字）"        │
│      extracted: {甲方, 乙方, 编号, 金额, ...}  │
│      confidence: 0.85,                         │
│      errors: [],                              │
│      matched: {customer, signingEntity, ...}  │
│    }                                            │
└────────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────────┐
│ 4. 用户在前端"人工确认"                         │
│    - 检查/修改 AI 抽取的字段                    │
│    - 选择/新建客户                              │
│    - 选择签约主体                                │
│    - 选择关联项目（可选）                      │
│    - 点击"确认入库"                            │
└────────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────────┐
│ 5. POST /api/contracts/import/confirm           │
│    a) 创建 contract 记录                        │
│    b) 创建 contract_file 记录                  │
│    c) 关联 contract_project（如果提供）        │
│    d) 添加 customer_alias                      │
│    e) 记录 contract_event 'created'           │
└────────────────────────────────────────────────┘
```

---

## 四、数据模型（6 张表）

### 4.1 ER 关系图

```
customer (1) ─┬─< contract (N) >──┬─ contract_file (N)
              │                    │
              └──< customer_alias   │
                                    ├─< contract_project >── certification_project
                                    │
                                    └──< contract_event

signing_entity (1) ─< contract (N)
```

### 4.2 contract 表（主表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| company_id | UUID FK | 多租户隔离 |
| customer_id | UUID FK | 客户 |
| signing_entity_id | UUID FK | 签约主体（A/B/C）|
| contract_no | VARCHAR(200) | 合同编号（多编号用 \| 分隔）|
| contract_type | VARCHAR(20) | main / supplement / change |
| parent_contract_id | UUID | 补充协议指向主合同 |
| title | VARCHAR(300) | 标题 |
| contract_amount | NUMERIC(12,2) | 合同金额 |
| certification_types | TEXT[] | 认证体系（QMS/EMS/OHSMS...）|
| signed_at | DATE | 签订日期 |
| effective_at | DATE | 生效日期 |
| expire_at | DATE | 到期日期 |
| bank_name | VARCHAR(100) | 开户行 |
| bank_account | VARCHAR(50) | 账号 |
| bank_holder | VARCHAR(100) | 户名 |
| contact_person | VARCHAR(50) | 联系人 |
| contact_phone | VARCHAR(30) | 联系电话 |
| status | VARCHAR(20) | draft/signed/effective/completed/terminated/archived |
| source | VARCHAR(20) | pdf_import/manual/api |
| extraction_confidence | NUMERIC(3,2) | AI 抽取置信度 0-1 |
| raw_extracted | JSONB | 原始抽取结果 |
| file_id | UUID | 主合同 PDF |

### 4.3 customer_alias 表（反向补全关键）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| customer_id | UUID FK | 客户 |
| alias_name | VARCHAR(200) | 别名（如合同上的写法）|
| source | VARCHAR(50) | 来源（contract/email/invoice）|
| match_count | INTEGER | 匹配次数（智能推荐权重）|

---

## 五、用户操作手册

### 5.1 上传合同 PDF（最常用流程）

1. 进入**客户与项目 → 合同管理**
2. 点击 **PDF 导入** tab
3. 点击"选择文件"，选一份 PDF
4. ⏳ 系统自动 OCR + AI 抽取（10-30 秒）
5. 检查抽取字段：
   - **客户名**是否正确识别
   - **乙方主体**是否正确（中认/华中/外协）
   - **合同编号**是否完整
   - **金额**是否准确
   - **体系**是否完整（QMS/EMS/OHSMS...）
6. 检查智能匹配：
   - ✅ 客户已匹配：直接用
   - 🆕 需新建：先在客户管理建客户，再回来入库
   - ⚠️ 未匹配：手动选择/新建
7. 选择关联项目（可选）
8. 点击 **💾 确认入库**

### 5.2 批量导入历史合同

1. 进入合同管理 → **导入批次** tab
2. 或调 `/api/contracts/import/batch` 端点
3. 系统异步扫描指定目录
4. 自动入库 status=draft 的合同
5. 人工在合同列表里审核、修改状态

### 5.3 客户反向补全

如果客户信息缺失（电话、联系人、银行）：

1. 调 `/api/customers/:id/enrich-from-contracts`
2. 系统自动从该客户的合同回填缺失字段
3. 行业根据认证体系推断（QMS→制造，HACCP→食品）

---

## 六、性能数据

| 操作 | 时间 |
|---|---|
| 单 PDF 上传 + OCR + AI | 10-30 秒 |
| AI 抽取（qwen2.5:7b） | 5-10 秒 |
| 客户匹配（6 级算法） | <100ms |
| 批量导入（27 个 PDF） | 5-10 分钟 |

---

## 七、已知限制

1. **OCR 准确率**：扫描版 PDF 准确率 ~85%（受扫描质量影响）
2. **AI 抽取**：置信度 <70% 必须人工确认
3. **批量导入速度**：每文件 ~30 秒（OCR 2 页 + AI 抽取）
4. **中文路径**：`/mnt/renz/19.认证合同/...` 已用 `bash -c 'cd ... && find'` 解决

---

## 八、未来改进（V2.3+）

- [ ] 合同模板引擎（自动生成 Word 模板）
- [ ] 电子签集成（e-签宝/法大大）
- [ ] 合同到期提醒（30/60/90 天前自动通知）
- [ ] 续签工作流（到期前自动生成续签单）
- [ ] 合同对比/版本合并（git 风格 diff）
- [ ] OCR 异步队列（用 Bull/BullMQ 队列）

---

## 九、相关文件

| 文件 | 用途 |
|---|---|
| `data/migrations/037_contract_management.sql` | 数据库迁移 |
| `apps/server/src/contracts/contract.repository.ts` | 数据访问层 |
| `apps/server/src/contracts/contract.extractor.ts` | OCR + AI 抽取 |
| `apps/server/src/contracts/contract.routes.ts` | 15 个 API 端点 |
| `apps/server/src/contracts/customer.matcher.ts` | 6 级客户匹配算法 |
| `apps/server/src/contracts/customer-enrich.routes.ts` | 5 个反向补全端点 |
| `apps/web/src/pages/ContractsPage.tsx` | 合同管理页面 |
| `apps/web/src/components/Sidebar.tsx` | 菜单项 |
| `docs/CONTRACT_MANAGEMENT_PLAN.md` | V2.1 升级方案 |
| `docs/CONTRACT_MANAGEMENT_PLAN_V2.2.md` | V2.2 升级方案（PDF 驱动）|

---

## 十、Commits

```
82458b5 feat(contracts): V2.2 数据库迁移 -6 张表
        feat(contracts): V2.2 数据访问层 + OCR/AI 抽取引擎
        feat(contracts): V2.2 15 个 API 端点
d97f4c2 feat(contracts): V2.2 客户反向补全 4 个 API
020c318 feat(contracts): V2.2 前端 UI
1ef2f02 feat(contracts): 批量导入历史合同
```