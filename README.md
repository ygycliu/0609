# AI数字化咨询中心（MVP V1.0）

面向企业数字化转型、AI 应用、数字孪生和培训服务的咨询工作台。系统通过 AI 专业角色、行业知识库、模型适配器和标准工作流，生成咨询建议、建设方案、培训内容与文档分析报告。

## 已实现功能

- 中心总览：查看 AI 角色、知识条目、历史成果和模型通道状态。
- 四类 AI 角色：数字化咨询顾问、方案工程师、培训讲师、知识助手。
- 咨询工作流：输入行业、企业现状和需求，检索知识并生成结构化成果。
- 模型切换：内置演示模型、OpenAI 兼容 API、本地 Ollama。
- 知识中心：上传、解析、分类、搜索和删除知识文件。
- 文档分析：对 PDF、DOCX、PPTX 和文本文件生成摘要、风险及行动建议。
- 成果沉淀：保留最近 100 次咨询，可复制或下载 Markdown。
- 原生 Word 导出：咨询成果可生成带封面、目录、页眉页脚和知识依据的可编辑 DOCX。
- 企业方案模板：提供可直接在 Word/WPS 中修改的数字化建设方案模板。
- 响应式界面：支持桌面和移动端操作。

## 技术结构

```text
apps/
  server/                 Express + TypeScript API
    src/consultations/    咨询工作流
    src/documents/        文件文本抽取
    src/employees/        AI 角色定义
    src/knowledge/        知识存储与检索
    src/models/           模型适配器
  web/                    React + TypeScript + Vite
data/                     本地知识、成果和上传文件（运行时生成）
```

MVP 使用 JSON 文件持久化，知识检索采用适合中文的关键词与二元词组评分。`KnowledgeRepository` 和 `generateWithModel` 已隔离数据与模型边界，后续可替换为 PostgreSQL、向量数据库或工作流平台。

## 本地运行

环境要求：Node.js 20 或更高版本。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

打开 `http://localhost:5173`。前端开发服务器会把 `/api` 代理到 `http://localhost:3001`。

系统默认使用“内置演示模型”，无需任何密钥即可体验完整流程。

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

单个文件限制为 15MB。入库后的原文件保存在 `data/uploads/`，提取文本和元数据保存在 `data/knowledge.json`。

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
| GET | `/api/employees` | AI 角色列表 |
| GET | `/api/models` | 模型通道及可用状态 |
| GET | `/api/knowledge` | 知识列表 |
| POST | `/api/knowledge` | 上传并解析知识 |
| DELETE | `/api/knowledge/:id` | 删除知识条目 |
| GET | `/api/consultations` | 历史咨询 |
| POST | `/api/consultations` | 生成咨询成果 |
| POST | `/api/consultations/:id/export/docx` | 导出可编辑 Word 咨询报告 |
| GET | `/api/templates/enterprise-solution.docx` | 下载企业方案 DOCX 模板 |
| POST | `/api/documents/analyze` | 分析上传文档 |

## MVP 边界

- 当前没有用户登录、租户隔离和角色权限，不能直接用于多客户生产环境。
- 轻量检索不是向量数据库；知识规模扩大后应接入 Qdrant、Milvus、pgvector 等服务。
- 文件仅做文本抽取，暂不识别扫描 PDF、图片、表格结构、音视频内容。
- 生成结果属于咨询辅助材料，政策、安全、投资与招投标结论需要专业人员复核。
- 已支持咨询报告原生 DOCX；培训 PPT、原生 PPTX 和复杂图表仍需后续接入专用模板引擎。

## Word 报告与企业方案模板

咨询结果生成后，点击成果栏中的“导出 Word”，可以配置：

- 编制单位、客户单位和项目名称。
- 文档标题、版本、编制人员及密级。
- 是否包含自动目录和知识依据。

导出的 DOCX 包含 A4 页面设置、可编辑封面、文档控制表、三级标题样式、自动目录字段、正文与列表、表格、页眉页脚、知识依据和免责声明。企业方案模板位于：

```text
templates/企业数字化建设方案模板.docx
```
