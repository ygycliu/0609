# 功能模块详解

> 按业务域组织的功能模块详细说明

## 📑 模块索引

1. [客户管理](#1-客户管理-crm)
2. [项目工作台](#2-项目工作台)
3. [认证报价](#3-认证报价)
4. [认证证书预警](#4-认证证书预警-v20-重点)
5. [审核员档案](#5-审核员档案-v20-重点)
6. [财务看板](#6-财务看板)
7. [整改闭环](#7-整改闭环)
8. [知识中心](#8-知识中心)
9. [AI 咨询](#9-ai-咨询)
10. [数字审核员](#10-数字审核员)
11. [页面助手](#11-页面助手)
12. [跟进管理](#12-跟进管理)
13. [数据导入导出](#13-数据导入导出)
14. [系统基础数据](#14-系统基础数据)

---

## 1. 客户管理 (CRM)

**位置**：`apps/web/src/pages/CustomerListPage.tsx`  
**API**：`/api/customers/*`

### 核心功能

- **客户列表**：分页 + 模糊搜索（>100 选项必 fuzzy）
- **客户详情**：基本信息 + 联系人 + 项目 + 财务汇总
- **客户新增**：表单（含自动编码生成）
- **客户状态机**：active / inactive / archived
- **重复客户合并**：DB 去重 + UI 手动合并

### 关键设计

- **模糊搜索**：name / contact_person 双向匹配
- **业务决策显式**：每个客户显式标注"需外协"，不让 config 字段自动决定
- **脏数据零容忍**：合并报告必须明确"减少 N + 迁移 N"

### 合并流程

```sql
-- 1. 备份冗余记录（不直接 DELETE）
UPDATE customer SET deleted_at = NOW() WHERE id IN (...);

-- 2. 迁移关联数据到主记录
UPDATE finance_project SET customer_id = main_id WHERE customer_id IN (...);
UPDATE certification_project SET customer_id = main_id WHERE customer_id IN (...);
```

---

## 2. 项目工作台

**位置**：`apps/web/src/pages/ProjectWorkspacePage.tsx`  
**API**：`/api/projects/*`

### 5 标签视图

| 标签 | 内容 |
|---|---|
| **时间线** | 项目事件流 + 状态变更记录 |
| **项目信息** | 基本信息 + 服务类型 + 签约主体 |
| **财务** | 合同金额 + 已收 + 应收 + AR |
| **资料** | 证书 + 文档 + OCR 文件 |
| **整改** | 整改项 pending/submitted/verified/rejected |

### 项目事件流

每个状态/服务类型变更必写 `project_event`：
```sql
INSERT INTO project_event (project_id, event_type, from_status, to_status, 
                           operator, reason, note)
VALUES (...)
```

### 22 状态机

```
草稿 → 待启动 → 进行中 → 监督中 → 审核中 → 已归档
                ↓
              已挂起 / 已取消
```

---

## 3. 认证报价

**位置**：`apps/web/src/pages/PricingPage.tsx`  
**API**：`/api/pricing/*`

### 4 层报价模型

```
finalPrice = basePrice + taxFee + businessManagementFee
              ├─ 评审×500 + 组长 + 补贴 + 注册金
              ├─ basePrice/0.92 - basePrice (≈ 8.7%)
              └─ basePrice × 18%
```

### QES 三体系

- 1 证书 = 3 体系（QMS + EMS + OHSMS）
- 评审人日 × 500（每体系）
- 注册金按 280/体系

### 报价单生成

- docx 输出
- 标题："最终客户报价（含税+经营管理）"
- 9 行明细

---

## 4. 认证证书预警 ⭐ V2.0 重点

**位置**：`apps/web/src/pages/CertificateExpiryPage.tsx`  
**API**：`/api/certificates/expiring`  
**后端函数**：`certificate_next_stage`  
**视图**：`vw_certificate_expiry_alerts`

### 4 阶段认证周期

| 阶段 | 时间点 | 预警 |
|---|---|---|
| **初次认证** | issue_date 当天 | 录入时已发证 |
| **监督一** | issue_date + 1 年 | ≤30 天前预警 |
| **监督二** | issue_date + 2 年 | ≤30 天前预警 |
| **再认证** | valid_until | ≤90 天前预警 |

### 5 级预警分类

| 级别 | 条件 | 颜色 | 操作 |
|---|---|---|---|
| **已过期** | valid_until 已过 | ⚫ 黑 | 📌 推送 (urgent) |
| **再认证紧急** | 再认证 ≤30 天 | 🔴 红 | 📌 推送 (high) |
| **再认证预警** | 再认证 91-180 天 | 🟠 橙 | ✓ 隐藏 |
| **即将到期** | 监督/再认证 ≤30 天 | 🟡 黄 | 📌 推送 (high) |
| **正常** | >30 天 | 🟢 绿 | - |

### 核心功能

- **统计卡片穿透**（点击 → 筛选）
- **批量确认**（checkbox + 批量按钮）
- **自动创建 todo**（紧急模式）
- **撤销确认**（恢复显示）
- **4 阶段列展示**（当前/下一阶段 + 距下一阶段天数）

### API 端点

```
GET    /api/certificates/expiring           # 列表 + 统计
PATCH  /api/certificates/:id/acknowledge    # 单个确认
POST   /api/certificates/acknowledge-batch   # 批量确认
POST   /api/certificates/:id/unacknowledge  # 撤销
GET    /api/certificates/:id                # 详情
```

### 自动 cron 任务

```bash
# /opt/ai-consulting-center/scripts/cron-cert-expiry.sh
0 9 * * * /opt/ai-consulting-center/scripts/cron-cert-expiry.sh
```

每天 09:00 调用 `auto_create_cert_stage_todos(30, company_id)` 创建 todo。

---

## 5. 审核员档案 ⭐ V2.0 重点

**位置**：`apps/web/src/pages/AuditorProfilePage.tsx`  
**API**：`/api/auditors/*`  
**OCR**：`apps/server/src/auditors/ocr.service.ts`

### 核心功能

- **审核员列表**：45+ 个，分页 + 搜索 + 状态/级别/机构/专业筛选
- **6 体系识别**：EMS/QMS/OHSMS/ISMS/ITSMS/BCMS/FSMS/AAA/能源
- **OCR 自动识别**：Tesseract + chi_sim + eng
- **证书预览 Modal**：缩放/切换/下载/OCR
- **批量合并**：相同人不同记录合并

### 数据存储

- **certificates** JSONB：证书列表
- **attachments** JSONB：签字文件等
- **specialties** text[]：体系代码

### OCR 流程

```bash
# 1. PDF → PNG
pdftoppm -png -r 300 cert.pdf /tmp/page

# 2. OCR 识别
tesseract /tmp/page-1.png stdout -l chi_sim+eng --psm 6

# 3. 解析字段
# - 证书号 (Certificate No)
# - 有效期 (Valid From / Until)
# - 体系 (EMS/QMS/OHSMS 等)
# - 注册机构
```

### 系统代码映射

```
E   = EMS     环境管理
Q   = QMS     质量管理
S   = OHSMS   职业健康安全
F   = FSMS    食品安全
I   = ISMS    信息安全
IT  = ITSMS   IT服务管理
BC  = BCMS    业务连续性管理
AAA = AAA     信用评级
```

---

## 6. 财务看板

**位置**：`apps/web/src/pages/FinanceDashboard.tsx`  
**API**：`/api/finance/*`

### 核心功能

- **5 期间切换**：本月/本季/本年/自定义/全部
- **AR Top 10**：应收催收优先级
- **应收标记已收**：AR/payments 自动判 paid/partial
- **应收/实收对比**：项目合计 vs 交易合计
- **对账功能**：差额 = NULL customer_id 之和 = 账平

### AR 双轨制（方案 C）

```
finance_ar          (手动模式)
finance_transaction (智能推算)
   ↓ 实际
   11 条手动导入（finance_ar），智能推算未启用
```

### AR 自动判 paid

```sql
-- ar.repository.ts: addPayment()
IF paidAmount >= totalAmount THEN
  status = 'paid', paid_at = NOW()
ELSIF paidAmount > 0 THEN
  status = 'partial'
ELSE
  status = 'pending'
```

---

## 7. 整改闭环

**位置**：`apps/web/src/pages/ProjectWorkspacePage.tsx`（整改标签）  
**API**：`/api/quality/*`

### 4 状态流转

```
pending → submitted → verified → rejected → pending（重新整改）
```

### 字段

```sql
CREATE TABLE rectification (
  id           UUID PRIMARY KEY,
  project_id   UUID,
  issue_type   VARCHAR(50),
  description  TEXT,
  status       VARCHAR(20),   -- pending/submitted/verified/rejected
  deadline     DATE,
  submitted_at TIMESTAMPTZ,
  verified_at  TIMESTAMPTZ,
  verified_by  UUID,
  reject_reason TEXT,
  ...
);
```

---

## 8. 知识中心

**位置**：`apps/web/src/pages/KnowledgeCenter.tsx`  
**API**：`/api/knowledge/*`

### 核心功能

- **文档上传**：word/pdf/图片
- **审核闭环**：上传 → 审核 → 发布（admin only）
- **OCR 文档**：扫描件识别
- **知识匹配**：AI 咨询自动关联
- **搜索**：全文检索

### 文档分类

```
01、管理体系
02、技术服务合同
03、知识库
04、培训资料
05、政策法规
...
```

---

## 9. AI 咨询

**位置**：`apps/web/src/pages/ConsultationPage.tsx`  
**API**：`/api/consultations` + `/api/assistant/chat`

### 3 个角色

| 角色 | 职责 |
|---|---|
| **培训讲师** | 讲解认证知识/标准 |
| **知识助手** | 查询知识库 + 生成答案 |
| **认证专家** | 解答认证业务问题 |

### 工作流

```
用户提问 → LLM 判断角色 → 调用 function → 返回答案
   ↓
自动关联知识库 + 客户档案 + 项目数据
```

---

## 10. 数字审核员

**位置**：`apps/web/src/pages/AuditorReviewPage.tsx`  
**API**：`/api/quality/check`

### 核心功能

- 智能审核工作流
- 自动检查项目合规性
- 整改项生成
- 审核报告输出

---

## 11. 页面助手

**位置**：`apps/web/src/components/PageAssistant.tsx`

### 特性

- 右下角悬浮
- LLM function-calling（8 个工具）
- 上下文感知（自动获取当前页面）
- 一键操作（创建客户/项目/todo）

---

## 12. 跟进管理

**位置**：`apps/web/src/pages/FollowUpPage.tsx`  
**API**：`/api/follow-up/*`

### 核心功能

- **按年归档**：2026 / 2025 / 2024
- **跟进模板**：常用话术 + 一键填充
- **客户关联**：跟进 → 客户档案 + 项目
- **提醒**：到期未跟进自动提醒
- **统计**：跟进频率 + 转化率

---

## 13. 数据导入导出

**位置**：`apps/web/src/pages/DataExchangePage.tsx`  
**API**：`/api/admin/data-exchange`

### 4 Tab

| Tab | 功能 |
|---|---|
| 客户导出/导入 | Excel 批量客户管理 |
| 财务导出/导入 | Excel 批量财务数据 |
| 项目导出/导入 | Excel 批量项目 |
| 证书导出/导入 | Excel 批量证书 |

### 导出规则

- CSV 格式（UTF-8 BOM）
- filename* UTF-8 编码（兼容中文）
- 默认 50 条分页（避免 OOM）

### 导入规则

- 数据校验（必填字段、枚举值）
- 客户匹配（按名称模糊）
- 失败行单独报告
- 导入报告：成功 N + 失败 N + 关联 M

---

## 14. 系统基础数据

**位置**：`apps/web/src/pages/SystemEnumPage.tsx`  
**API**：`/api/admin/enums`

### 管理内容（admin only）

- 服务类型
- 签约主体
- 风险等级
- 合作机构
- 签字人
- 审核模板

---

## 🔧 跨模块工具组件

### Toast 系统 ⭐ 全局

**位置**：`apps/web/src/components/Toast.tsx`

```typescript
ToastManager.success("✅ 操作成功");
ToastManager.error("❌ 操作失败");
ToastManager.warning("⚠️ 警告");
ToastManager.info("ℹ️ 提示");
```

- 4 种类型 + 自动关闭 + 滑入动画
- 全量替换 alert() / confirm()

### CertPreviewModal ⭐ V2.0

**位置**：`apps/web/src/components/CertPreviewModal.tsx`

- 证书图片 base64 预览
- 缩放控制（25%-300%）
- 左右切换（同一审核员多证书）
- 下载 + OCR 触发
- 错误处理（404 / 安全路径）

### Sidebar 导航 ⭐ V2.0

**位置**：`apps/web/src/components/Sidebar.tsx`

分组：
- 工作台
- 客户与项目（客户管理 / 项目工作台 / 客户跟进 / 认证预警）
- 认证业务（AI 咨询 / 数字审核 / 认证报价 / 待办事项）
- 财务
- 知识中心
- 工具（审核员档案 / 数据导入导出 / 系统基础数据）
- 历史成果

---

## 🎯 V2.0 核心模块状态

| 模块 | 状态 | 最后更新 |
|---|---|---|
| 客户管理 | ✅ 完整 | 2026-08-31 |
| 项目工作台 | ✅ 完整 | 2026-08-27 |
| 认证报价 | ✅ 完整 | 2026-08-30 |
| **认证证书预警** | ✅ 完整 | **2026-09-01** |
| **审核员档案** | ✅ 完整 | **2026-09-01** |
| 财务看板 | ✅ 完整 | 2026-08-30 |
| 整改闭环 | ✅ 完整 | 2026-08-27 |
| 知识中心 | ✅ 完整 | 2026-08-25 |
| AI 咨询 | ✅ 完整 | 2026-08-27 |
| 数字审核员 | ✅ 完整 | 2026-08-25 |
| 页面助手 | ✅ 完整 | 2026-08-25 |
| 跟进管理 | ✅ 完整 | 2026-08-30 |
| 数据导入导出 | ✅ 完整 | 2026-08-31 |
| 系统基础数据 | ✅ 完整 | 2026-08-25 |

---

**版本**：V2.0-MVP  
**最后更新**：2026-09-01
