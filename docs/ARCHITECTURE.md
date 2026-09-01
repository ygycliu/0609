# 系统架构

## 🎯 核心设计原则

1. **MVP 优先**：销售效率 +300%，平台化延期
2. **客户驱动**：状态机贯穿所有业务流
3. **脏数据零容忍**：合并/清洗永远先做，要求明确报告"减少 N 个 + 迁移 N 笔"
4. **穿透查询**：所有统计卡片默认带点击穿透
5. **批量优先**：批量操作 > 单条操作
6. **Web 优先**：V1 砍掉飞书协同、多租户、BPMN、实时推送

## 🏛️ 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                    用户层 (Browser)                       │
│       https://103.117.123.100:8080/ai/                  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Apache 反代 (:8080)                          │
│            /ai/* → http://127.0.0.1:3001/*               │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────────┐
│            Express Server (:3001)                        │
│  ┌──────────┬──────────┬──────────┬──────────────┐      │
│  │ /api/    │ /api/    │ /api/    │ /api/        │      │
│  │ auth     │ customer │ project  │ certificates │ ...  │
│  └────┬─────┴────┬─────┴────┬─────┴──────┬───────┘      │
│       │          │          │           │              │
│       ▼          ▼          ▼           ▼              │
│  ┌─────────────────────────────────────────────────┐   │
│  │         PostgreSQL 16 (:5432)                    │   │
│  │  ai_consult 数据库                               │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │   │
│  │  │customer│ │project │ │ finance│ │ todo   │ │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ │   │
│  │  + 45 个迁移脚本 + 视图 + 函数                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  外部集成                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  飞书    │ │ YoooClaw │ │   OCR    │ │   LLM    │  │
│  │ 协同 API │ │ 录音提取 │ │ Tesseract│ │ function │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 📁 后端架构

### 入口

`apps/server/src/app.ts` (~5700 行)

主要职责：
- Express 应用初始化
- 中间件链（JSON 解析 / 跨域 / 静态资源）
- 路由注册（~100+ API 端点）
- 错误处理

### 目录结构

```
apps/server/src/
├── app.ts                       # 主应用入口
├── index.ts                     # 启动包装 (await createApp)
├── auth/                        # 认证
│   └── auth.repository.ts
├── customer/                    # 客户管理
│   └── customer.repository.ts
├── project/                     # 项目
│   ├── project.repository.ts
│   └── project_event.repository.ts
├── certification/               # 认证证书
│   ├── certification.repository.ts
│   ├── certification_project.repository.ts
│   └── project_certificate.repository.ts
├── finance/                     # 财务
│   ├── ar.repository.ts
│   ├── finance.repository.ts
│   ├── finance_project.repository.ts
│   ├── finance_transaction.repository.ts
│   └── ...
├── auditors/                    # 审核员档案
│   ├── auditor.repository.ts
│   └── ocr.service.ts
├── employees/                   # 员工
├── todo/                        # 待办
├── knowledge/                   # 知识库
├── pricing/                     # 报价
├── follow_up/                   # 跟进
├── consultation/                # 咨询
└── ai/                          # AI 能力
```

## 📁 前端架构

### 技术选型

- **React 18** + **TypeScript 5**
- **Vite** 构建
- **无状态管理库**（useState 够用）
- **Lucide React** 图标

### 入口

`apps/web/src/App.tsx` (~200 行)

主要职责：
- 用户认证状态管理
- 路由分发（基于 `page` 字符串）
- 权限控制

### 目录结构

```
apps/web/src/
├── App.tsx                      # 主应用
├── main.tsx                     # React 入口
├── types.ts                     # 类型定义 (Page 类型)
├── styles.css                   # 全局样式 (~11000 行)
├── lib/
│   ├── api.ts                   # API 客户端 (~120 个端点)
│   └── permissions.ts           # 权限定义
├── pages/                       # 页面 (~30 个)
│   ├── DashboardPage.tsx        # 工作台
│   ├── CustomerListPage.tsx     # 客户管理
│   ├── ProjectWorkspacePage.tsx # 项目工作台
│   ├── FinanceDashboard.tsx     # 财务看板
│   ├── AuditorProfilePage.tsx   # 审核员档案
│   ├── CertificateExpiryPage.tsx# 证书预警
│   └── ...
├── components/                  # 复用组件
│   ├── Sidebar.tsx              # 侧边导航
│   ├── Toast.tsx                # 通知系统
│   ├── CertPreviewModal.tsx     # 证书预览
│   └── ...
└── hooks/                       # 自定义 hooks (轻量)
```

## 🗃️ 数据库架构

### 核心表（按业务流）

```
customer ──┬─ certification_project ── project_certificate ── 4阶段预警
           ├─ finance_project ── finance_transaction / finance_ar
           ├─ follow_up
           └─ todo (跨业务统一)
            
auditor_profile (独立档案库)

knowledge_document (知识库)
todo (统一待办，跨业务)
```

### SQL 能力

- **45 个迁移脚本** (`data/migrations/*.sql`)
- **自定函数**：4 阶段计算、批量插入、todo 自动生成
- **视图**：证书预警 (`vw_certificate_expiry_alerts`)、阶段统计 (`vw_certificate_stage_stats`)
- **触发器**：部分表有自动 updated_at

### 关键设计

- **状态机 22 状态**：通过 `certification_project.status` 字段
- **脏数据防御**：UNIQUE 约束 + 软删除 (`deleted_at`)
- **时间字段**：所有事件/到期都带 `created_at/updated_at/deleted_at`

## 🔌 外部集成

### 1. Apache 反代

```apache
ProxyPass /ai/ http://127.0.0.1:3001/
ProxyPassReverse /ai/ http://127.0.0.1:3001/
```

- 用户访问 `https://103.117.123.100:8080/ai/`
- 反代转发到 `http://127.0.0.1:3001/`
- 前端 fetch 必须用 `/ai/api/...` 路径

### 2. YoooClaw 录音提取

- 监听手机录音 → 自动转写
- 智能识别客户/跟进/任务
- 自动创建 todo / 客户档案 / 跟进记录

### 3. OCR 服务

- Tesseract 5.5.0 + chi_sim + eng 语言包
- 审核员证书图片识别
- 自动提取证书号 / 有效期 / 体系

### 4. 飞书集成

- 部分文档协同功能
- 仅 Web 端优先，飞书协同 V2 砍掉

## 🔒 权限系统

### 角色

- **admin**：完全访问
- **regular**：受限访问

### 权限矩阵（关键模块）

| 模块 | admin | regular |
|---|---|---|
| 财务 (FinanceDashboard) | ✅ | ❌ |
| 知识审核 | ✅ | ❌ |
| 系统基础数据 (SystemEnum) | ✅ | ❌ |
| 知识库上传/删除 | ✅ | ❌ |
| 审核员档案增删改 | ✅ | ❌ |
| 审核员档案查看 | ✅ | ✅ |
| 客户/项目 | ✅ | ✅ |
| 证书预警 | ✅ | ✅ |

实现位置：`apps/web/src/lib/permissions.ts`

## 📊 性能与扩展

### 当前规模

- 后端 TypeScript 文件：51 个
- 前端 TS/TSX/CSS 文件：46 个
- 数据库迁移：45 个
- API 端点：~100+

### 性能优化

- 数据库视图预计算（4 阶段）
- 部分列表 limit + offset 分页
- 关键字段加索引（customer_name、acknowledged_at）

### 已知限制

- V1 未实现：飞书协同、多租户、BPMN、实时推送、任务取消
- 部分前端用 curl 验证（浏览器自动化测试受控组件限制）

## 🔄 部署架构

```
Git (本地) → 本地 build → Apache 反代 → 用户访问
                                 ↓
                          进程管理 (start-ai-center.sh)
                                 ↓
                          PostgreSQL (systemd)
```

### 启动脚本

```bash
# /opt/ai-consulting-center/scripts/
start-ai-center.sh    # 启动后端
stop-ai-center.sh     # 停止后端
restart-ai-center.sh  # 重启
cron-cert-expiry.sh   # 证书预警 cron (每天 09:00)
```

## 📝 数据迁移流程

每次开发新功能：
1. 写 `data/migrations/XXX_xxx.sql`
2. 测试幂等性（清理 → 执行 → 验证）
3. 立即 commit
4. 写到 `CHANGELOG.md`

## 🛠️ 开发约定

- **数据库变更**：必须迁移脚本，不直接改 schema
- **代码风格**：TypeScript strict，函数式 + 显式类型
- **commit 规范**：`type(scope): 标题` 格式
- **测试**：build 必须通过 + curl API 验证
- **数据规范**：批量时报告"减少 N + 迁移 N"

## 📈 监控

- 日志：`/tmp/ai-center.log` (pino 日志)
- 健康检查：`GET /health` → 200
- 端口检查：`ss -tlnp | grep 3001`

---

**版本**：V2.0-MVP  
**最后更新**：2026-09-01
