# AI数字化认证中心

> **认证咨询业务的智能赋能平台** — QES 三体系认证全流程数字化工作台

## 📋 项目定位

为 **华中国际认证检验集团有限公司** 认证咨询业务定制的智能工作台，覆盖客户管理、项目跟进、报价生成、证书预警、AR 应收、财务对账、知识库、数字审核员等全业务流程。

## 🎯 核心价值

| 指标 | 提升 |
|---|---|
| 销售效率 | **+300%** |
| 证书预警覆盖 | 100% |
| 客户状态机 | 22 状态 + 3 异常 |
| 数据准确性 | 脏数据零容忍 |

## 🏗️ 技术栈

| 层级 | 选型 |
|---|---|
| **前端** | React + TypeScript + Vite |
| **后端** | Node.js 22 + Express + TypeScript |
| **数据库** | PostgreSQL 16 + 自定义函数/视图 |
| **AI 能力** | LLM function-calling (8 工具) |
| **集成** | 飞书 / YoooClaw / OCR / Apache 反代 |

## 📦 模块概览

### 核心业务

- **客户管理** (CRM) — 22 状态状态机、模糊搜索、合并去重
- **项目工作台** — 5 标签视图 (时间线/项目信息/财务/资料/整改)
- **认证报价** — 4 层报价模型 + QES 三体系精确报价
- **整改闭环** — pending / submitted / verified / rejected 4 状态

### 智能能力

- **AI 咨询** — 3 个角色协同 (培训讲师/知识助手/认证专家)
- **页面助手** — 右下角悬浮，LLM function-calling
- **YoooClaw** — 录音智能提取 → 自动 todo / 跟进 / 知识库
- **数字审核员** — 智能审核工作流

### 知识与档案

- **知识中心** — 文档上传 + 审核闭环 + OCR
- **审核员档案** — 45 审核员 + 6 体系识别 + 证书 OCR + 预览 Modal
- **OFD → Word** — 智能文档格式转换

### 财务与预警

- **认证预警** — 4 阶段分级（初次 / 监督一 / 监督二 / 再认证）+ 穿透统计
- **财务看板** — 5 期间切换 + AR Top 10 + 应收催收
- **客户/项目自动填充** — 跨表智能关联
- **数据导入/导出** — Excel 批量 + admin 专属工具入口

## 🗂️ 目录结构

```
ai-consulting-center/
├── apps/
│   ├── server/              # 后端 (Node + Express + TS)
│   │   └── src/
│   │       ├── app.ts       # 主应用 (~5700 行)
│   │       ├── auth/        # 认证
│   │       ├── auditors/    # 审核员档案
│   │       ├── finance/     # 财务
│   │       └── ...
│   └── web/                 # 前端 (React + TS)
│       └── src/
│           ├── pages/       # 页面 (~30 个)
│           ├── components/  # 组件
│           ├── lib/         # API + 工具
│           ├── styles.css   # 全局样式 (~11000 行)
│           └── ...
├── data/
│   └── migrations/          # 数据库迁移 (45 个 .sql)
├── scripts/                 # 启动/停止/cron 脚本
└── docs/                    # 📖 文档
    ├── README.md            # 本文件
    ├── ARCHITECTURE.md      # 架构
    ├── API.md               # 接口
    ├── DATABASE.md          # 数据库
    ├── MODULES.md           # 功能模块
    └── CHANGELOG.md         # 变更记录
```

## 🚀 快速启动

```bash
# 1. 启动后端 (端口 3001)
cd apps/server && npm run build
bash scripts/start-ai-center.sh

# 2. 前端构建（已包含 dist/）
cd apps/web && npm run build

# 3. 访问入口
https://103.117.123.100:8080/ai/
```

## 👥 测试账号

| 账号 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员 |
| tester | tester123 | 普通用户 |

## 📊 数据规模（截至 2026-09-01）

| 表 | 行数 |
|---|---:|
| customer | 850 |
| certification_project | 285 |
| project_certificate | 223 |
| todo | 50+ |
| auditor_profile | 35 |

## 📖 详细文档

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 系统架构与技术决策
- [API.md](./docs/API.md) — REST API 接口参考
- [DATABASE.md](./docs/DATABASE.md) — 数据库结构与迁移
- [MODULES.md](./docs/MODULES.md) — 功能模块详解
- [CHANGELOG.md](./docs/CHANGELOG.md) — 版本变更记录

## 📞 联系

- **负责人**：刘军
- **组织**：华中国际认证检验集团有限公司
- **部署**：银川金凤区

---

**版本**：V2.0-MVP  
**构建日期**：2026-09-01  
**License**：内部使用
