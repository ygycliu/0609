import { config } from "../config.js";
import { getEmployee } from "../employees/employee.service.js";
import { IntegrationError } from "../shared/errors.js";
import { sanitizeModelOutput } from "../shared/model-output.js";
import type {
  ConsultationInput,
  KnowledgeItem,
  ModelProvider
} from "../shared/types.js";

interface ModelRequest {
  input: ConsultationInput;
  knowledge: KnowledgeItem[];
}

function buildPrompt({ input, knowledge }: ModelRequest) {
  const employee = getEmployee(input.role);
  const context = knowledge
    .map((item, index) => `[资料${index + 1}] ${item.title}\n${item.content}`)
    .join("\n\n");

  return `你是“${employee.name}”。请使用中文输出专业、具体、可执行的内容。
行业：${input.industry}
企业现状：${input.companyContext || "未提供"}
用户需求：${input.request}
期望交付物：${input.deliverable}

可引用知识：
${context || "当前没有匹配的知识资料，请明确说明哪些判断需要后续调研。"}

输出必须包含：核心判断、建议方案、分阶段行动、风险与约束、验收指标。引用知识时标注资料标题。`;
}

function demoResponse({ input, knowledge }: ModelRequest) {
  const employee = getEmployee(input.role);
  const references = knowledge.length
    ? knowledge.map((item) => `《${item.title}》`).join("、")
    : "暂无直接匹配资料";
  const roleFocus: Record<typeof input.role, string[]> = {
    consultant: ["业务与管理现状诊断", "高价值场景优先级", "三阶段建设路线"],
    "solution-engineer": ["总体技术架构", "模块与接口边界", "实施计划与验收"],
    trainer: ["学习目标与对象分层", "课程结构与案例", "实训及效果评估"],
    "knowledge-assistant": ["问题拆解与结论", "知识依据与适用范围", "待核实事项"],
    "certification-expert": ["认证体系选型与适配", "多体系套报与组合优化", "审核准备与续约规划"],
    "certification-auditor": [
      "ISO 9001/14001/45001 条款级符合性判定",
      "QES 资料审核与三角验证",
      "不符合项识别（严重/一般/观察项）",
      "审核材料生成（7 类）"
    ]
  };

  return `# ${input.deliverable || employee.deliverables[0]}

## 核心判断
针对${input.industry || "当前行业"}场景，建议从可验证的业务问题出发建设能力闭环，而不是先堆叠平台功能。当前需求“${input.request}”应拆分为业务目标、数据条件、流程责任和技术支撑四部分。

## 建议方案
${roleFocus[input.role].map((item, index) => `${index + 1}. **${item}**：明确负责人、输入数据、输出成果和量化指标。`).join("\n")}

## 分阶段行动
1. **0-4 周｜诊断与设计**：完成现状调研、场景清单、数据盘点和 MVP 边界确认。
2. **5-10 周｜试点验证**：选择 1 个高价值场景，打通知识、模型、工作流和人工复核。
3. **11-16 周｜评估推广**：依据质量、效率、成本和使用率决定扩展范围。

## 风险与约束
- 知识来源不完整会导致结论缺少企业特异性，需要业务负责人补充材料并复核。
- 涉及政策、安全和投资决策的内容应保留人工审批，不直接自动执行。
- 模型效果必须通过固定测试集持续评估，避免只依据演示效果验收。

## 验收指标
- 关键问题回答可追溯率不低于 90%。
- 试点流程处理时间相较现状缩短 30% 以上。
- 专家抽检通过率不低于 85%，重大事实错误为 0。
- 形成可复用的知识条目、提示模板和工作流版本记录。

## 参考知识
${references}

> 当前使用内置演示模型生成。接入 OpenAI 兼容 API 或本地 Ollama 后，将根据企业资料生成更细化的内容。`;
}

async function callOpenAi(prompt: string) {
  if (!config.openai.apiKey) {
    throw new IntegrationError("未配置 OPENAI_API_KEY");
  }
  const response = await fetch(`${config.openai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3
    })
  });
  if (!response.ok) {
    throw new IntegrationError(`OpenAI 兼容接口调用失败：${response.status}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new IntegrationError("模型未返回有效内容");
  return sanitizeModelOutput(content);
}

async function callOllama(prompt: string) {
  const response = await fetch(`${config.ollama.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt,
      stream: false
    })
  });
  if (!response.ok) {
    throw new IntegrationError(`Ollama 调用失败：${response.status}`);
  }
  const body = (await response.json()) as { response?: string };
  if (!body.response) throw new IntegrationError("Ollama 未返回有效内容");
  return sanitizeModelOutput(body.response);
}

export async function generateWithModel(provider: ModelProvider, request: ModelRequest) {
  if (provider === "demo") return sanitizeModelOutput(demoResponse(request));
  const prompt = buildPrompt(request);
  return provider === "openai" ? callOpenAi(prompt) : callOllama(prompt);
}

export function getAvailableModels() {
  return [
    {
      id: "demo",
      name: "内置演示模型",
      available: true,
      description: "无需配置，用于流程演示与结构化内容生成"
    },
    {
      id: "openai",
      name: `OpenAI 兼容 · ${config.openai.model}`,
      available: Boolean(config.openai.apiKey),
      description: "支持 OpenAI 及兼容 Chat Completions 的 API"
    },
    {
      id: "ollama",
      name: `本地 Ollama · ${config.ollama.model}`,
      available: true,
      description: "调用本机或局域网 Ollama 服务"
    }
  ];
}
