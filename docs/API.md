# REST API 接口文档

> **Base URL**：`http://127.0.0.1:3001`（通过 Apache 反代：`https://103.117.123.100:8080/ai/`）
> **总端点数**：177 个  
> **认证**：除 `/api/auth/*` 外，所有 API 需要登录 cookie

## 📚 通用约定

### 请求头
```
Content-Type: application/json
Cookie: <session-cookie>
```

### 响应格式
```json
{
  "data": { /* 实际数据 */ },
  "error": null  // 或错误信息
}
```

### 错误响应
```json
{
  "code": "FORBIDDEN",           // 错误代码
  "message": "❌ 中文友好提示",   // 中文错误消息
  "status": 403
}
```

### 认证要求
- 除 `/api/auth/login` `/api/health` 等少数端点外，所有 API 需登录
- 角色：admin 完全访问 / regular 受限
- `requireAdmin` 中间件：仅管理员（财务/审核员档案增删改等）

---

## 🔐 认证 (11 个端点)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| POST | `/api/auth/register` | 注册 |
| PATCH | `/api/auth/password` | 修改密码 |
| GET | `/api/auth/users` | 用户列表 |
| PATCH | `/api/auth/users/:id` | 更新用户 |
| DELETE | `/api/auth/users/:id` | 删除用户 |
| POST | `/api/auth/seed-admin` | 初始化 admin |
| POST | `/api/auth/reset-password` | 重置密码（admin）|
| GET | `/api/auth/permissions` | 权限查询 |

### POST /api/auth/login

**Body**:
```json
{ "username": "admin", "password": "admin123" }
```

**响应**:
```json
{ "data": { "id": "...", "username": "admin", "role": "admin" } }
```

---

## 👥 客户 (8 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/customers` | 客户列表（分页+搜索）|
| POST | `/api/customers` | 创建客户 |
| GET | `/api/customers/:id` | 客户详情 |
| PATCH | `/api/customers/:id` | 更新客户 |
| DELETE | `/api/customers/:id` | 删除（软删除）|
| POST | `/api/customers/merge` | 合并重复客户 |
| GET | `/api/customers/:id/projects` | 客户的项目 |
| GET | `/api/customers/stats` | 客户统计 |

### GET /api/customers

**Query**:
- `q` - 模糊搜索（名称/联系人）
- `status` - active / inactive / archived
- `limit` - 默认 50
- `offset` - 默认 0

---

## 📁 项目 (25 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 项目详情 |
| PATCH | `/api/projects/:id` | 更新 |
| DELETE | `/api/projects/:id` | 删除 |
| GET | `/api/projects/stats` | 项目统计 |
| GET | `/api/projects/overdue` | 逾期项目 |
| GET | `/api/projects/pending-payment` | 待付款项目 |
| GET | `/api/projects/pending-cert` | 待出证项目 |
| POST | `/api/projects/:id/status` | 状态变更 |
| POST | `/api/projects/:id/event` | 记录项目事件 |
| GET | `/api/projects/:id/events` | 项目事件流 |
| GET | `/api/projects/:id/follow-up` | 跟进记录 |
| POST | `/api/projects/:id/follow-up` | 添加跟进 |
| ... | | (更多) |

---

## 📜 认证证书 (5 个端点) ⭐ V2.0 重点

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/certificates/expiring` | **证书预警列表**（4 阶段视图）|
| PATCH | `/api/certificates/:id/acknowledge` | **单证书确认**（推送 todo）|
| POST | `/api/certificates/acknowledge-batch` | **批量确认** |
| POST | `/api/certificates/:id/unacknowledge` | **撤销确认**（恢复显示）|
| GET | `/api/certificates/:id` | 单证书详情 |

### GET /api/certificates/expiring ⭐

**功能**：返回所有未确认证书 + 4 阶段分类 + 穿透统计

**Query**:
- `warning_days` - 默认 180（再认证预警阈值）
- `critical_days` - 默认 60
- `include_normal` - 默认 1（含"正常"），设 0 仅预警

**响应**:
```json
{
  "data": {
    "stats": {
      "total": 223,
      "expired": 6,           // 已过期
      "recert_critical": 0,   // 再认证紧急
      "recert_warning": 21,   // 再认证预警（91-180天）
      "expiring_soon": 40,    // 即将到期（监督一/二 ≤30天）
      "normal": 156,          // 正常
      "warning_days": 180,
      "critical_days": 60
    },
    "certificates": [
      {
        "certificate_id": "uuid",
        "customer_id": "uuid",
        "customer_name": "宁夏华辉环保科技股份有限公司",
        "project_code": "PRJ-2026-490",
        "cert_type": "AAA / QMS",
        "certificate_no": "27323SC10014R0S",
        "issue_date": "2024-03-14T00:00:00.000Z",
        "valid_until": "2026-02-27T00:00:00.000Z",
        "current_stage": "已过期",
        "next_stage": "再认证",
        "next_stage_date": "2026-02-27T00:00:00.000Z",
        "days_until_next": -186,
        "urgency_level": "已过期",
        "alert_message": "⚫ 已过期 186 天，需立即重新认证",
        "issuing_body": "华中国际认证检验集团有限公司"
      }
    ]
  }
}
```

### PATCH /api/certificates/:id/acknowledge ⭐

**功能**：单证书确认。紧急模式自动创建 todo。

**Body**:
```json
{ "note": "已联系客户" }
```

**响应**:
```json
{
  "data": {
    "id": "uuid",
    "acknowledged": true,
    "todo_created": true,
    "mode": "push_todo",        // push_todo | hidden
    "next_stage": "再认证",
    "urgency_level": "CRITICAL"
  }
}
```

**行为规则**:
- `urgency_level === '已过期' / '再认证紧急' / '即将到期'` → 推送 todo (RENEW=urgent, CRITICAL=high)
- `urgency_level === '再认证预警'` → 仅隐藏（无 todo）
- 标记 `acknowledged_at / acknowledged_by / acknowledged_note`
- 视图自动过滤（不再显示）

### POST /api/certificates/acknowledge-batch ⭐

**功能**：批量确认证书

**Body**:
```json
{
  "certificate_ids": ["uuid1", "uuid2", "uuid3"],
  "note": "批量处理"
}
```

**响应**:
```json
{
  "data": {
    "total": 3,
    "push_count": 2,    // 推送到 todo 的数量
    "hidden_count": 1,  // 仅隐藏的数量
    "success": true
  }
}
```

### POST /api/certificates/:id/unacknowledge

**功能**：撤销确认，恢复显示（同时删除关联的 pending todo）

**响应**:
```json
{ "data": { "id": "uuid", "unacknowledged": true } }
```

---

## 💰 财务 (18 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/finance/dashboard` | 财务看板数据 |
| GET | `/api/finance/ar/top` | AR Top 10 |
| GET | `/api/finance/ar` | AR 列表 |
| POST | `/api/finance/ar` | 新建 AR |
| PATCH | `/api/finance/ar/:id` | 更新 AR |
| POST | `/api/finance/ar/:id/payments` | AR 收款 |
| DELETE | `/api/finance/ar/:id` | 删除 AR（admin）|
| GET | `/api/finance/transactions` | 交易流水 |
| POST | `/api/finance/transactions` | 创建交易 |
| GET | `/api/finance/projects` | 财务项目 |
| POST | `/api/finance/projects` | 创建项目 |
| PATCH | `/api/finance/projects/:id` | 更新项目 |
| DELETE | `/api/finance/projects/:id` | 删除（admin）|
| GET | `/api/finance/dashboard/stats` | 看板统计 |
| GET | `/api/finance/reconciliation` | 对账 |
| POST | `/api/finance/reconciliation` | 创建对账 |
| GET | `/api/finance/summary` | 汇总 |
| GET | `/api/finance/expiring-contracts` | 即将到期合同 |

### POST /api/finance/ar/:id/payments

**功能**：标记 AR 已收，自动判 paid/partial

**Body**:
```json
{ "amount": 4000, "method": "银行转账" }
```

**响应**:
```json
{ "data": { "ar_id": "uuid", "status": "paid", "paid_amount": 4000 } }
```

---

## 👔 审核员档案 (37 个端点)

### /api/auditor/* (27 个旧端点)
### /api/auditors/* (10 个新端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/auditors` | 列表（分页+筛选）|
| POST | `/api/auditors` | 创建（admin）|
| GET | `/api/auditors/:id` | 详情 |
| PATCH | `/api/auditors/:id` | 更新（admin）|
| DELETE | `/api/auditors/:id` | 软删除（admin）|
| GET | `/api/auditors/stats` | 统计 |
| POST | `/api/auditors/ocr` | 单文件 OCR |
| POST | `/api/auditors/:id/ocr-all` | 批量 OCR |
| GET | `/api/auditors/cert-image` | 证书图片 base64 |
| POST | `/api/auditors/merge` | 合并 |

### POST /api/auditors/ocr

**功能**：OCR 识别证书图片

**Body**: `multipart/form-data` with `file`

**响应**:
```json
{
  "data": {
    "raw_text": "...",
    "cert_no": "2024-NOEMS-1103428",
    "qualification": "EMS实习审核员",
    "valid_from": "2024-08-01",
    "valid_to": "2027-07-31",
    "systems": ["EMS"]
  }
}
```

---

## 📞 跟进 (17 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/follow-up` | 跟进列表（按年份归档）|
| POST | `/api/follow-up` | 创建跟进 |
| GET | `/api/follow-up/:id` | 跟进详情 |
| PATCH | `/api/follow-up/:id` | 更新 |
| DELETE | `/api/follow-up/:id` | 删除 |
| GET | `/api/follow-up/stats` | 跟进统计 |
| GET | `/api/follow-up/templates` | 跟进模板 |
| POST | `/api/follow-up/templates` | 创建模板 |
| ... | | (更多) |

---

## 📚 知识库 (6 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/knowledge` | 知识文档列表 |
| POST | `/api/knowledge/upload` | 上传文档 |
| GET | `/api/knowledge/:id` | 文档详情 |
| PATCH | `/api/knowledge/:id` | 更新（admin）|
| DELETE | `/api/knowledge/:id` | 删除（admin）|
| POST | `/api/knowledge/:id/review` | 审核 |

---

## 📋 待办 (4 个端点)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/todo` | 待办列表 |
| POST | `/api/todo` | 创建 |
| PATCH | `/api/todo/:id` | 更新 |
| DELETE | `/api/todo/:id` | 删除 |

---

## 💬 咨询 / AI (8 个端点)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/consultations` | 创建咨询 |
| GET | `/api/consultations` | 咨询历史 |
| POST | `/api/assistant/chat` | AI 助手对话 |
| POST | `/api/assistant/feedback` | 反馈 |
| GET | `/api/models` | AI 模型列表 |
| POST | `/api/quality/check` | 质量检查 |
| POST | `/api/yoooclaw/webhook` | YoooClaw 回调 |
| GET | `/api/yoooclaw/recordings` | 录音列表 |

---

## 📄 文档 (4 个端点)

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/document/ofd-to-word` | OFD → Word 转换 |
| POST | `/api/pdf/generate` | PDF 生成 |
| GET | `/api/files/list` | 文件列表 |
| POST | `/api/files/read` | 读取文件 |

---

## 🔧 其他 (10+ 个端点)

- `/api/version` - 版本信息
- `/api/employees` - 员工列表
- `/api/service-types` - 服务类型
- `/api/partner-orgs` - 合作机构
- `/api/signatories` - 签字人
- `/api/audit-templates` - 审核模板
- `/api/deliverables` - 交付物
- `/api/templates` - 模板
- `/api/admin/*` - 管理
- `/api/feishu` - 飞书集成

---

## 🔍 测试命令

```bash
# 登录获取 cookie
curl -s -c /tmp/cookie.txt -X POST http://127.0.0.1:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 查询证书预警
curl -s -b /tmp/cookie.txt http://127.0.0.1:3001/api/certificates/expiring

# 批量确认证书
curl -s -X POST -b /tmp/cookie.txt \
  http://127.0.0.1:3001/api/certificates/acknowledge-batch \
  -H "Content-Type: application/json" \
  -d '{"certificate_ids":["uuid1","uuid2"]}'
```

---

**版本**：V2.0-MVP  
**最后更新**：2026-09-01
