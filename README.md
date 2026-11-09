# AI数字化咨询中心（MVP V1.0）

面向企业数字化转型、AI 应用、数字孪生和培训服务的咨询工作台。系统通过 AI 专业角色、行业知识库、模型适配器和标准工作流，生成咨询建议、建设方案、培训内容与文档分析报告。

## 已实现功能

- 中心总览：查看 AI 角色、知识条目、历史成果和模型通道状态。
- 五类 AI 角色：数字化咨询顾问、方案工程师、培训讲师、知识助手、认证专家。
- 企业账号：管理员和普通用户通过 HttpOnly Cookie 登录，数据按企业隔离。
- 认证工作台：认证选型、规则报价、审核人日估算和正式报价 DOCX。
- 咨询工作流：输入行业、企业现状和需求，检索知识并生成结构化成果。
- 模型切换：内置演示模型、OpenAI 兼容 API、本地 Ollama。
- 知识中心：上传、解析、分类、搜索和删除知识文件。
- 文档分析：对 PDF、DOCX、PPTX 和文本文件生成摘要、风险及行动建议。
- 成果沉淀：保留最近 100 次咨询，可复制或下载 Markdown。
- 原生 Word 导出：咨询成果可生成带封面、目录、页眉页脚和知识依据的可编辑 DOCX。
- 原生 PowerPoint 导出：咨询成果可生成可编辑 PPTX。
- 企业方案模板：提供可直接在 Word/WPS 中修改的数字化建设方案模板。
- 知识运营：用户反馈、管理员审核、纠正应用和版本记录。
- 响应式界面：支持桌面和移动端操作。

## 技术结构

```text
apps/
  server/                 Express + TypeScript API
    src/consultations/    咨询工作流
    src/documents/        文件文本抽取
    src/employees/        AI 角色定义
    src/auth/             Cookie 会话、管理员/普通用户权限
    src/certification/    认证产品和报价规则
    src/knowledge/        PostgreSQL/pgvector 知识存储与检索
    src/models/           模型适配器
  web/                    React + TypeScript + Vite
data/                     上传文件、模板和兼容数据（运行时生成）
```

正式试用环境以 PostgreSQL 为业务数据源，并使用 pgvector 保存知识分块向量。仓储层仍保留旧 JSON 兼容路径，生产环境应保持数据库可用并逐步移除共享 JSON 回退。

## 环境要求

### 必备软件

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | 20 或更高版本 | 运行时与构建环境一致，Docker 镜像基于 `node:20-bookworm-slim` |
| npm | 10 或更高版本 | 仓库使用 npm workspaces 管理 `apps/*`，锁文件为 `package-lock.json` |
| PostgreSQL | 15 或更高版本 | 业务数据源；知识向量依赖 `pgvector` 扩展，镜像使用 `pgvector/pgvector:pg16` |

开发与生产可任选一条路径：

- **本地 Node 运行**：直接安装上述组件，按 [本地运行](#本地运行) 启动。
- **容器运行**：需要 Docker Engine 20.10 以上与 Docker Compose v2（`docker compose` 命令），详见 `DOCKER.md`。

### 数据库

- 正式环境以 PostgreSQL 为业务数据源。知识分块向量依赖 `pgvector` 扩展，`data/migrations/001_initial.sql` 会创建 `embedding vector(1024)` 列与 HNSW/IVFFlat 索引，但**不会**自动安装扩展，需先用超级用户执行 `CREATE EXTENSION IF NOT EXISTS vector;`；`pgvector/pgvector:pg16` 镜像已内置该扩展。
- `data/migrations/` 下的迁移脚本需按文件名字典序依次执行；升级前先备份并在测试库验证。
- 开发模式未配置 `DATABASE_URL`（或数据库不可达）时，可继续使用内置演示模型；知识仓储层会回退到本地 JSON 兼容存储（`data/knowledge.json`）。生产环境（`NODE_ENV=production`）必须提供 `DATABASE_URL` 与 `JWT_SECRET`，否则服务启动即失败。

### 端口与目录

| 端口 | 用途 | 是否可改 |
| --- | --- | --- |
| 5173 | 前端开发服务器（Vite） | `apps/web/vite.config.ts` 中的 `server.port` |
| 3001 | 后端 API 与健康检查 | `.env` 的 `PORT`，容器下为 `APP_PORT` |
| 5432 | PostgreSQL | `.env` 的 `DATABASE_URL`，容器下为 `POSTGRES_PORT` |

- `data/`（上传文件、知识 JSON 兼容存储、运行时数据）需要可写权限；容器部署以 `app-data`、`app-uploads`、`app-templates` 三个卷持久化，`templates/` 用于存放可编辑的 DOCX/PPTX 模板。
- 生产环境运行在 Linux 时，进程必须由 `ai-consulting-center.service`（systemd user service）拉起，直接执行 Node 或 `npm start` 会在监听端口前失败。

### 外部依赖（可选）

- **模型服务**：默认使用内置演示模型，无需任何密钥即可体验完整流程；如需真实模型，可接入 OpenAI 兼容 API 或本地 Ollama，见 [接入模型](#接入模型)。
- **反向代理**：正式发布建议使用 Apache 或 Nginx 转发 `/ai/` 与 `/ai/api/`，上传限制至少 20MB。
- **环境变量**：复制 `.env.example` 为 `.env` 并按需修改；真实密码、JWT 密钥、数据库 URI 与模型密钥不得提交到仓库。

生产部署的完整清单见 `DEPLOYMENT.md`。

## 本地运行

需要 Node.js 20 或更高版本、npm 10 或更高版本；数据库为可选项（不配置时使用内置演示模型与本地 JSON 兼容存储）。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

打开 `http://localhost:5173`。前端开发服务器会把 `/api` 代理到 `http://localhost:3001`。

系统默认使用“内置演示模型”，无需任何密钥即可体验完整流程。

首次部署需要通过受控初始化流程创建企业管理员。系统不内置可公开传播的默认密码；管理员首次登录或密码重置后应立即修改密码。

## 接入模型

### OpenAI 兼容 API

编辑 `.env`：

```dotenv
DEFAULT_MODEL=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4.1-mini
```

只要服务支持 Chat Completions 兼容接口，也可以把 `OPENAI_BASE_URL` 指向其他模型网关。

### 本地 Ollama

确保 Ollama 服务可访问，并在 `.env` 中配置：

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

在咨询页面选择“本地 Ollama”即可调用。若服务未启动，接口会返回明确的模型集成错误。

## 知识文件

支持以下格式：

| 格式 | 处理方式 |
| --- | --- |
| TXT、Markdown、CSV、JSON | UTF-8 文本读取 |
| PDF | 提取页面文本 |
| DOCX | 提取正文文本 |
| PPTX | 按幻灯片顺序提取文本 |

单个文件限制为 15MB。入库后的原文件保存在 `data/uploads/`，提取文本、企业归属、审核状态和版本信息保存在 PostgreSQL。

## 常用命令

```powershell
npm run dev       # 同时启动前后端
npm run test      # 运行前后端测试
npm run build     # 生产构建
npm start         # 构建后启动 API，并托管前端 dist
```

健康检查：`GET http://localhost:3001/health`

## 核心 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务健康检查 |
| POST | `/api/auth/login` | 登录并设置 HttpOnly 会话 Cookie |
| GET | `/api/auth/me` | 当前用户和企业 |
| GET/POST/PATCH | `/api/auth/users` | 企业用户管理（管理员） |
| GET | `/api/employees` | AI 角色列表 |
| GET | `/api/models` | 模型通道及可用状态 |
| GET | `/api/knowledge` | 知识列表 |
| POST | `/api/knowledge` | 上传并解析知识 |
| DELETE | `/api/knowledge/:id` | 删除知识条目 |
| GET | `/api/consultations` | 历史咨询 |
| POST | `/api/consultations` | 生成咨询成果 |
| POST | `/api/consultations/:id/export/docx` | 导出可编辑 Word 咨询报告 |
| POST | `/api/consultations/:id/export/pptx` | 导出可编辑 PowerPoint 方案 |
| POST | `/api/certification/quote` | 生成认证报价 |
| POST | `/api/certification/quote/export/docx` | 导出认证报价 DOCX |
| GET | `/api/templates/enterprise-solution.docx` | 下载企业方案 DOCX 模板 |
| GET | `/api/templates/digital-transformation-solution.pptx` | 下载数字化建设方案 PPTX 模板 |
| POST | `/api/documents/analyze` | 分析上传文档 |

## MVP 边界

- 当前版本按 `company_id` 隔离企业数据并区分管理员/普通用户，但目标仍是单家公司正式试用，不应直接扩展为开放式多租户 SaaS。
- PostgreSQL/pgvector 已接入；扫描 PDF 尚未进入 OCR 队列，会被跳过而不是错误计为向量化失败。
- 文件仅做文本抽取，暂不识别扫描 PDF、图片、表格结构、音视频内容。
- 生成结果属于咨询辅助材料，政策、安全、投资与招投标结论需要专业人员复核。
- 已支持咨询报告 DOCX/PPTX 和认证报价 DOCX；正式成果仍必须经过人工审核后对外发送。
- 当前 HTTP 内网入口使用 HttpOnly + SameSite=Strict Cookie；启用 HTTPS 后必须设置 `COOKIE_SECURE=true`。
- 登录限流、完整业务审计日志和生产依赖高危告警治理仍是正式公网发布前置项。

## Word 报告与企业方案模板

咨询结果生成后，点击成果栏中的“导出 Word”，可以配置：

- 编制单位、客户单位和项目名称。
- 文档标题、版本、编制人员及密级。
- 是否包含自动目录和知识依据。

导出的 DOCX 包含 A4 页面设置、可编辑封面、文档控制表、三级标题样式、自动目录字段、正文与列表、表格、页眉页脚、知识依据和免责声明。企业方案模板位于：

```text
templates/企业数字化建设方案模板.docx
```
