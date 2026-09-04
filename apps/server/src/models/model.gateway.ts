import { config } from "../config.js";
import { getEmployee } from "../employees/employee.service.js";
import { IntegrationError } from "../shared/errors.js";
import { sanitizeModelOutput } from "../shared/model-output.js";
import type {
  ConsultationInput,
  KnowledgeItem,
  ModelProvider
} from "../shared/types.js";
import { getResolvedConfig } from "./llm-config.service.js";

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
    trainer: ["学习目标与对象分层", "课程结构与案例", "实训及效果评估"],
    "knowledge-assistant": ["问题拆解与结论", "知识依据与适用范围", "待核实事项"],
    "certification-expert": ["认证体系选型与适配", "多体系套报与组合优化", "审核准备与续约规划"]
  };

  return `# ${input.deliverable || (employee.deliverables?.[0] ?? "咨询建议")}

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

async function callOpenAi(
  prompt: string,
  override?: { baseUrl?: string; apiKey?: string; model?: string; temperature?: number; timeoutMs?: number; maxTokens?: number }
) {
  const baseUrl = (override?.baseUrl || config.openai.baseUrl).replace(/\/$/, "");
  const apiKey = override?.apiKey ?? config.openai.apiKey;
  const model = override?.model ?? config.openai.model;
  const temperature = override?.temperature ?? 0.3;
  const timeoutMs = override?.timeoutMs ?? 60000;
  if (!apiKey) {
    throw new IntegrationError("OPENAI_API_KEY missing - fill in LLM Config page or set OPENAI_API_KEY in .env");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: override?.maxTokens ?? 4096
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new IntegrationError(`OpenAI compat API failed: ${response.status} ${errText.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new IntegrationError("Model returned no content");
    return sanitizeModelOutput(content);
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(
  prompt: string,
  modelName?: string,
  override?: { baseUrl?: string; numCtx?: number; temperature?: number; timeoutMs?: number }
) {
  const baseUrl = (override?.baseUrl || config.ollama.baseUrl).replace(/\/$/, "");
  const timeoutMs = override?.timeoutMs ?? 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName || config.ollama.model,
        prompt,
        stream: false,
        options: {
          num_ctx: override?.numCtx ?? 4096,
          temperature: override?.temperature ?? 0.3
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new IntegrationError(`Ollama call failed: ${response.status} ${errText.slice(0, 200)}`);
    }
    const body = (await response.json()) as { response?: string };
    if (!body.response) throw new IntegrationError("Ollama returned no content");
    return sanitizeModelOutput(body.response);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWithModel(provider: ModelProvider, request: ModelRequest) {
  if (provider === "demo") return sanitizeModelOutput(demoResponse(request));
  const prompt = buildPrompt(request);
  // V2.1：支持 "ollama:modelname" 格式动态选择模型
  if (provider === "openai") return callOpenAi(prompt);
  if (provider.startsWith("ollama:")) {
    const modelName = provider.substring("ollama:".length);
    return callOllama(prompt, modelName);
  }
  return callOllama(prompt);
}


/**
 * V2.3.3：从 app_llm_config 读全局默认配置并调用
 * 业务调用点（合同 AI 抽取、模板生成、咨询、OCR 后结构化等）应优先使用本函数。
 *
 * 行为：
 *   - DB 有启用配置 → 优先用 DB 配置（provider/base_url/api_key/model/num_ctx/temperature...）
 *   - DB 未配置 / 未启用 / 解密失败 → 回退到 .env 默认值（不报错，向后兼容）
 */
export async function generateWithDefaultModel(request: ModelRequest): Promise<string> {
  const cfg = await getResolvedConfig().catch((e) => {
    console.warn("[gateway] 读取 DB 配置失败，回退 .env:", (e as Error).message);
    return null;
  });

  // DB 没配好 → 走 demo（避免无配置时业务挂掉）
  if (!cfg) {
    return sanitizeModelOutput(demoResponse(request));
  }

  const prompt = buildPrompt(request);

  if (cfg.provider === "demo") {
    return sanitizeModelOutput(demoResponse(request));
  }

  const override = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || undefined,
    model: cfg.modelName,
    temperature: cfg.temperature,
    timeoutMs: cfg.timeoutMs,
    maxTokens: cfg.maxTokens
  };

  if (cfg.provider === "openai") {
    return callOpenAi(prompt, override);
  }
  if (cfg.provider.startsWith("ollama:")) {
    const modelName = cfg.provider.substring("ollama:".length);
    return callOllama(prompt, modelName, {
      baseUrl: cfg.baseUrl,
      numCtx: cfg.numCtx,
      temperature: cfg.temperature,
      timeoutMs: cfg.timeoutMs
    });
  }
  if (cfg.provider === "ollama") {
    return callOllama(prompt, undefined, {
      baseUrl: cfg.baseUrl,
      numCtx: cfg.numCtx,
      temperature: cfg.temperature,
      timeoutMs: cfg.timeoutMs
    });
  }

  // 未知 provider → demo 兜底
  console.warn(`[gateway] 未知 provider=${cfg.provider}，回退 demo`);
  return sanitizeModelOutput(demoResponse(request));
}

/**
 * V2.1：动态列出 Ollama 本地部署的所有模型
 * 调用 /api/tags，返回 [{name, size, ...}]
 * 自动过滤掉非文本生成模型（flux 等图像生成）
 */
export async function listOllamaModels(): Promise<Array<{
  name: string;
  size: number;  // bytes
  family?: string;
  parameter_size?: string;
  quantization_level?: string;
}>> {
  try {
    const baseUrl = config.ollama.baseUrl.replace(/\/$/, "");
    const r = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!r.ok) return [];
    const data = await r.json() as { models?: any[] };
    return (data.models || []).filter((m: any) => {
      const name = (m.name || "").toLowerCase();
      const family = (m.details?.family || "").toLowerCase();

      // V2.1：仅保留本地模型
      // 过滤 1：图像生成模型（flux/sdxl/image/diffusion）
      if (family.includes("image") || family.includes("diffusion")) return false;
      if (name.includes("flux") || name.includes("sdxl") || name.includes("image")) return false;

      // 过滤 2：远程 cloud 模型（kimi/glm/deepseek:cloud 等）- 用户要求只保留本地
      if (name.includes(":cloud")) return false;
      // size == 0 通常表示 cloud 模型（不占本地存储）
      if (m.size === 0 || m.size === undefined) return false;

      return true;
    }).map((m: any) => ({
      name: m.name || "unknown",
      size: m.size || 0,
      family: m.details?.family,
      parameter_size: m.details?.parameter_size,
      quantization_level: m.details?.quantization_level
    }));
  } catch (err) {
    console.warn("[Ollama] 列出模型失败:", (err as Error).message);
    return [];
  }
}

export async function getAvailableModels() {
  const ollamaModels = await listOllamaModels();

  const baseProviders = [
    {
      id: "demo",
      name: "内置演示模型",
      available: true,
      description: "无需配置，用于流程演示与结构化内容生成",
      category: "demo"
    },
    {
      id: "openai",
      name: `OpenAI 兼容 · ${config.openai.model}`,
      available: Boolean(config.openai.apiKey),
      description: "支持 OpenAI 及兼容 Chat Completions 的 API",
      category: "openai"
    }
  ];

  // V2.1：每个 Ollama 本地模型作为独立 provider
  const ollamaProviders = ollamaModels.map((m) => {
    const sizeGB = (m.size / 1024 / 1024 / 1024).toFixed(2);
    return {
      id: `ollama:${m.name}`,  // 用 namespace 区分 provider 和 model
      name: `🐑 Ollama · ${m.name}`,
      available: true,
      description: `${m.parameter_size || "?"} ${m.quantization_level ? `(${m.quantization_level})` : ""} · ${sizeGB} GB`,
      category: "ollama",
      model: m.name,
      size: m.size
    };
  });

  // 如果 Ollama 调用失败，至少显示默认模型
  if (ollamaProviders.length === 0) {
    ollamaProviders.push({
      id: "ollama",
      name: `本地 Ollama · ${config.ollama.model}`,
      available: true,
      description: "调用本机或局域网 Ollama 服务（默认模型）",
      category: "ollama",
      model: config.ollama.model,
      size: 0
    });
  }

  return [...baseProviders, ...ollamaProviders];
}
