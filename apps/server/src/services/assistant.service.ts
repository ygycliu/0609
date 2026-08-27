/**
 * 页面助手服务（Agent + Tools）
 *
 * 能力：
 * 1. 讲解系统功能（任何问题 → 自然语言回答）
 * 2. 调用系统功能（创建项目/查客户/查项目等）
 *
 * 设计原则：
 * - 工具调用前必须用户确认（防误操作）
 * - 所有操作走已有 API（不绕过权限）
 * - 失败时回退到普通聊天
 */

import { query } from "../db/pool.js";
import * as projectRepo from "../project/project.repository.js";
import { listSignatories } from "../project/project.repository.js";

const OPENAI_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const LLM_BASE = process.env.OPENAI_BASE_URL || "http://127.0.0.1:8000";

// 自动发现端点
async function findLLMEndpoint(): Promise<string> {
  const candidates = [
    process.env.OPENAI_BASE_URL,
    "http://127.0.0.1:8000",
    "http://127.0.0.1:11434",
    "http://localhost:11434"
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const baseClean = base.endsWith("/v1") ? base : base;
    try {
      const res = await fetch(`${baseClean}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer ollama" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      });
      if (res.ok || res.status === 400) {
        return baseClean.endsWith("/v1") ? baseClean : `${baseClean}/v1`;
      }
    } catch {}
  }
  return (process.env.OPENAI_BASE_URL || "http://127.0.0.1:8000") + (process.env.OPENAI_BASE_URL?.endsWith("/v1") ? "" : "/v1");
}

// ========== 工具定义 ==========

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export const ASSISTANT_TOOLS: ToolDef[] = [
  {
    name: "list_recent_projects",
    description: "查询最近的项目列表（用于查看工作台项目）",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "返回数量（默认 10）" }
      },
      required: []
    }
  },
  {
    name: "get_project_stats",
    description: "查询项目统计（总数、各状态分布、转化漏斗）",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "search_customers",
    description: "搜索客户（按名称关键词）",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "客户名关键词" }
      },
      required: ["keyword"]
    }
  },
  {
    name: "create_project",
    description: "创建一个新的认证项目。需要客户ID、服务类型ID、签约主体ID。建议在用户已确认信息后调用。",
    parameters: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "客户 UUID" },
        customerName: { type: "string", description: "客户名称（自动查找）" },
        serviceTypeCode: { type: "string", description: "服务类型代码：consulting/certification/bundle" },
        signatoryId: { type: "string", description: "签约主体 UUID" },
        industry: { type: "string", description: "行业（可选）" },
        contactPerson: { type: "string", description: "联系人（可选）" }
      },
      required: ["serviceTypeCode", "signatoryId"]
    }
  },
  {
    name: "list_pending_todos",
    description: "查询待办事项",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "返回数量（默认 10）" } },
      required: []
    }
  },
  {
    name: "get_funnel_summary",
    description: "查询项目转化漏斗数据（从线索到出证各阶段数量）",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "explain_system",
    description: "讲解系统功能（不调用任何数据，纯文档说明）",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "要讲解的主题",
          enum: [
            "project_workflow", "pricing_formula", "status_machine",
            "yoooclaw_integration", "customer_followup",
            "data_model", "todo_system", "general"
          ]
        }
      },
      required: ["topic"]
    }
  }
];

// ========== 工具执行 ==========

export async function executeTool(
  toolName: string,
  args: any,
  context: { companyId: string; userId: string; userName?: string }
): Promise<{ success: boolean; data: any; error?: string }> {
  try {
    switch (toolName) {
      case "list_recent_projects": {
        const limit = args.limit || 10;
        const r = await query<any>(
          `SELECT p.id, p.project_code, p.customer_name, p.service_type_name,
                  p.signing_entity_name AS signatory_name, p.status,
                  p.contract_amount, p.paid_amount, p.created_at
           FROM certification_project p
           WHERE p.company_id = $1 AND p.deleted_at IS NULL
           ORDER BY p.created_at DESC LIMIT $2`,
          [context.companyId, limit]
        );
        return { success: true, data: r.rows };
      }

      case "get_project_stats": {
        const r = await query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text AS count FROM certification_project
           WHERE company_id = $1 AND deleted_at IS NULL GROUP BY status`,
          [context.companyId]
        );
        const stats: Record<string, number> = {};
        let total = 0;
        for (const row of r.rows) {
          stats[row.status] = parseInt(row.count);
          total += parseInt(row.count);
        }
        return { success: true, data: { total, byStatus: stats } };
      }

      case "search_customers": {
        const r = await query<{ id: string; name: string; customer_code: string; industry: string | null; status: string }>(
          `SELECT id, name, customer_code, industry, status
           FROM customer
           WHERE company_id = $1 AND deleted_at IS NULL
             AND name ILIKE $2
           ORDER BY name LIMIT 10`,
          [context.companyId, `%${args.keyword}%`]
        );
        return { success: true, data: r.rows };
      }

      case "create_project": {
        // 校验 + 查/建关联
        let customerId = args.customerId;
        if (!customerId && args.customerName) {
          const c = await query<{ id: string }>(
            `SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
            [context.companyId, args.customerName.trim()]
          );
          if (c.rows.length === 0) {
            return { success: false, data: null, error: `客户"${args.customerName}"不存在` };
          }
          customerId = c.rows[0].id;
        }
        if (!customerId) {
          return { success: false, data: null, error: "缺少 customerId 或 customerName" };
        }

        // 查服务类型
        const svcRes = await query<{ id: string; code: string; name: string }>(
          `SELECT id, code, name FROM service_type WHERE code = $1 LIMIT 1`,
          [args.serviceTypeCode]
        );
        if (svcRes.rows.length === 0) {
          return { success: false, data: null, error: `服务类型 ${args.serviceTypeCode} 不存在` };
        }
        const svc = svcRes.rows[0];

        // 创建项目
        const newProject = await projectRepo.createProject({
          companyId: context.companyId,
          customerId,
          contactPerson: args.contactPerson,
          industry: args.industry,
          serviceTypeId: svc.id,
          signatoryId: args.signatoryId,
          createdBy: context.userId
        } as any);
        return { success: true, data: newProject };
      }

      case "list_pending_todos": {
        const limit = args.limit || 10;
        const r = await query<any>(
          `SELECT id, title, priority, due_at, status, source
           FROM todo
           WHERE company_id = $1 AND status = 'pending' AND deleted_at IS NULL
           ORDER BY due_at NULLS LAST, created_at DESC
           LIMIT $2`,
          [context.companyId, limit]
        );
        return { success: true, data: r.rows };
      }

      case "get_funnel_summary": {
        const stats = await projectRepo.getProjectStats(context.companyId);
        return { success: true, data: stats };
      }

      case "explain_system": {
        const explanations: Record<string, string> = {
          project_workflow: `**项目工作流 12 步闭环**：
1. 销售线索（lead）→ 2. 沟通中（communicating）→ 3. 报价（quoted）→ 4. 合同（contract_signed）→ 5. 收首付款（first_paid）
→ 6. 资料收集（doc_collecting）→ 7. 合同评审（contract_review）→ 8. 专家评审（expert_reviewing）→ 9. 整改（correcting）→ 10. 尾款（final_pay_pending）→ 11. 出证（certified）→ 12. 邮寄/完成

每个项目可在"项目详情页"维护时间线、收款、发票、资料、整改闭环。`,

          pricing_formula: `**报价计算公式**（按体系收费）：
- 基础价 = 预估人日 × 500 + 体系数 × 1100 + 280（QES时）+ 预估人日/专家人数 × 200
- 税费 = 基础价 / 0.92
- 企业经营管理费 = 基础价 × 18%
- 最终客户报价 = 基础价 + 税费 + 经营管理费

差旅住宿不包含，实报实销。`,

          status_machine: `**22 个项目状态**（22 状态机）：
主流程：lead → communicating → quoted → contract_pending → contract_signed → contract_archived → first_pay_pending → first_paid → delivery_prep → doc_collecting → contract_review → expert_review_pending → expert_reviewing → correcting → final_pay_pending → invoice_pending → cert_pending → certified → shipment_pending → completed

异常：suspended（暂停）/ at_risk（风险）/ cancelled（取消）/ archived（归档）

只能在 PROJECT_STATUS_TRANSITIONS 允许的状态间流转。`,

          yoooclaw_integration: `**YoooClaw 录音 → 自动 Todo**：
1. 在 YoooClaw App 完成录音 + 转写
2. 复制转写文本 → AI 中心"待办事项" → "智能提取"按钮
3. 粘贴转写 → 填写录音 ID + 标题 → "开始提取"
4. AI 自动识别待办/客户跟进/知识要点
5. 写入 todo 表 + customer_follow_up 表 + 知识库

API: POST /api/yoooclaw/auto-extract`,

          customer_followup: `**客户跟进管理**：
- 客户主档 518 个（5 个字段：客户名/客户代码/行业/区域/状态）
- 跟进记录 226 条：阶段（已报价/合同签订/项目实施/出证/完成/归档）
- 跟进关闭：必填关闭原因（出证交付/客户拒绝/价格/联系不上/客户流失/选竞品/重复/其他）
- 自动匹配客户（按录音中提到的公司名）`,

          data_model: `**数据库主要表**：
- customer（客户 518）
- certification_project（项目）
- project_payment（收款）
- project_invoice（发票）
- project_correction（整改）
- project_document（资料）
- project_event（时间线）
- signing_entity（签约主体）
- service_type（服务类型）
- partner_cert_unit（外协）
- todo（待办）
- knowledge_document（知识库 1483）`,

          todo_system: `**待办系统 4 大来源**：
1. 手动创建（待办页面"新建待办"）
2. YoooClaw 智能提取（粘贴转写 → AI 自动生成）
3. 项目状态变更自动生成（contract_signed/correcting/cert_pending 等）
4. 收款到账自动生成（首付款到账 → 启动项目准备）

筛选：待办/进行中/已完成/全部`,

          general: `**AI 数字化咨询中心** 是华中国际认证的数字化业务平台，主要功能：
- 客户管理（518 客户库）
- 项目工作台（从线索到出证 12 步闭环）
- 财务收款/发票管理
- 客户跟进 + 待办事项
- 知识库（1483 条 + YoooClaw 录音转写）
- 数字审核员（QES 三体系审核）

您可以问"项目工作台怎么用"或"怎么创建项目"等具体问题。`
        };
        return { success: true, data: { topic: args.topic, text: explanations[args.topic] || explanations.general } };
      }

      default:
        return { success: false, data: null, error: `未知工具: ${toolName}` };
    }
  } catch (e: any) {
    return { success: false, data: null, error: e.message };
  }
}

// ========== 主对话函数 ==========

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  tool_name?: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: {
    currentPage?: string;
  };
}

export interface ChatResponse {
  reply: string;
  toolCalls?: Array<{ name: string; args: any; result: any }>;
  needsConfirmation?: boolean;
}

export async function handleChat(
  req: ChatRequest,
  context: { companyId: string; userId: string; userName?: string }
): Promise<ChatResponse> {
  const SYSTEM_PROMPT = `你是 AI 数字化咨询中心（华中认证宁夏分公司）的页面助手。

**你的能力**：
1. 讲解系统功能（任何问题 → 自然语言回答，简洁）
2. 调用系统功能（创建项目、查客户、查漏斗、查待办等）

**重要原则**：
- 讲解时简洁，3-5 行回答，必要时用列表
- 工具调用结果用中文自然语言总结
- 涉及数据操作时，先说明要做什么，等用户确认
- 用户问你"这个系统能做什么"时，主动列举主要功能

**当前用户**：${context.userName || "用户"}
${req.context?.currentPage ? `**当前所在页面**：${req.context.currentPage}` : ""}

**系统核心**：
- 客户库 518 个 + 项目工作台 + 财务 + 跟进 + 待办 + 知识库
- 12 步项目闭环：线索 → 沟通 → 报价 → 合同 → 付款 → 评审 → 整改 → 出证
- 22 个状态机 + 自动状态推进（首付款到账 → first_paid）
- YoooClaw 录音 → 自动 Todo/跟进/知识库

请用中文回答。`;

  // 转换工具为 LLM 格式
  const tools = ASSISTANT_TOOLS.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(req.history || []).slice(-10),  // 只保留最近 10 条历史
    { role: "user", content: req.message }
  ];

  // 第 1 轮：让 LLM 决定是否调用工具
  const endpoint = await findLLMEndpoint();
  let response: any;
  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.OPENAI_API_KEY || "ollama")
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.3
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LLM ${res.status}: ${errBody.slice(0, 200)}`);
    }
    response = await res.json();
  } catch (e: any) {
    // 降级：直接用 LLM 聊天（不调用工具）
    return await fallbackChat(req.message, messages, endpoint);
  }

  const choice = response.choices?.[0];
  if (!choice) return { reply: "抱歉，没有响应。" };

  // 如果 LLM 调用工具
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    const toolCall = choice.message.tool_calls[0];
    const toolName = toolCall.function.name;
    let toolArgs: any = {};
    try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

    // 安全检查：危险工具需要确认
    const DANGEROUS_TOOLS = new Set(["create_project"]);
    if (DANGEROUS_TOOLS.has(toolName)) {
      // 返回工具调用请求，前端展示确认弹窗
      return {
        reply: `准备执行：**${toolName}**\n\n参数：\n${JSON.stringify(toolArgs, null, 2)}\n\n⚠️ 确认后才会执行。请回复"确认"或"取消"。`,
        toolCalls: [{ name: toolName, args: toolArgs, result: null }],
        needsConfirmation: true
      };
    }

    // 直接执行（无确认）
    const result = await executeTool(toolName, toolArgs, context);

    // 第 2 轮：让 LLM 用工具结果生成最终回复
    const finalMessages = [
      ...messages,
      choice.message,
      { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) }
    ];

    try {
      const res2 = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (process.env.OPENAI_API_KEY || "ollama")
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: finalMessages,
          temperature: 0.3
        })
      });
      const r2 = await res2.json();
      const reply = r2.choices?.[0]?.message?.content || "已处理";
      return {
        reply,
        toolCalls: [{ name: toolName, args: toolArgs, result }]
      };
    } catch (e: any) {
      // 工具已执行成功，直接返回结果
      return {
        reply: formatToolResult(toolName, result),
        toolCalls: [{ name: toolName, args: toolArgs, result }]
      };
    }
  }

  // 普通回复
  return { reply: choice.message?.content || "抱歉，没听懂。" };
}

// 降级方案：直接聊天
async function fallbackChat(message: string, messages: any[], endpoint: string): Promise<ChatResponse> {
  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.OPENAI_API_KEY || "ollama")
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.3
      })
    });
    const r = await res.json();
    return { reply: r.choices?.[0]?.message?.content || "抱歉，助手暂不可用。" };
  } catch (e: any) {
    return { reply: `抱歉，助手连接失败：${e.message}\n\n您可以：\n- 查看左侧菜单了解各功能\n- 在项目工作台新建/查看项目\n- 在基础数据管理查找客户\n- 在待办事项智能提取 YoooClaw 录音` };
  }
}

// 工具结果的格式化
function formatToolResult(toolName: string, result: any): string {
  if (!result.success) return `执行失败：${result.error}`;

  switch (toolName) {
    case "list_recent_projects":
      if (result.data.length === 0) return "暂无项目。";
      return `最近 ${result.data.length} 个项目：\n` + result.data.map((p: any) =>
        `• ${p.project_code} | ${p.customer_name} | ${p.service_type_name} | ${p.status} | ¥${Number(p.contract_amount || 0).toLocaleString()}`
      ).join("\n");

    case "get_project_stats":
      const s = result.data;
      return `项目总数：${s.total}\n` + Object.entries(s.byStatus)
        .sort((a: any, b: any) => b[1] - a[1])
        .map(([k, v]) => `• ${k}: ${v}`)
        .join("\n");

    case "search_customers":
      if (result.data.length === 0) return "未找到匹配客户。";
      return `找到 ${result.data.length} 个客户：\n` + result.data.map((c: any) =>
        `• ${c.customer_code} | ${c.name} | ${c.industry || "未分类"} | ${c.status}`
      ).join("\n");

    case "list_pending_todos":
      if (result.data.length === 0) return "暂无待办。";
      return `待办事项（${result.data.length}）：\n` + result.data.map((t: any) =>
        `• [${t.priority}] ${t.title}${t.due_at ? " (截止 " + new Date(t.due_at).toLocaleDateString() + ")" : ""}`
      ).join("\n");

    case "get_funnel_summary":
      return "已查询漏斗数据，详见工作台页面。";

    case "create_project":
      return `✅ 项目创建成功！\n编号：${result.data.projectCode}\n客户：${result.data.customerName}\n可在"项目工作台"查看。`;

    case "explain_system":
      return result.data.text;

    default:
      return JSON.stringify(result.data, null, 2);
  }
}

// 处理用户确认的工具调用
export async function handleToolConfirmation(
  toolName: string,
  args: any,
  context: { companyId: string; userId: string; userName?: string }
): Promise<{ reply: string; success: boolean }> {
  const result = await executeTool(toolName, args, context);
  return {
    reply: formatToolResult(toolName, result),
    success: result.success
  };
}