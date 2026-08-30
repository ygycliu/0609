/**
 * 飞书消息路由器
 * 把飞书消息路由到 AI 中心对应员工
 */
import { askAI } from "./ask.js";
import { sendMessage } from "./client.js";

const EMPLOYEE_KEYWORDS: Record<string, string> = {
  // 飞书关键词 → AI 中心员工 ID
  // V2.0 简化：只有 3 个员工
  "咨询": "trainer",
  "培训": "trainer",
  "课程": "trainer",
  "学习": "trainer",
  "知识": "knowledge-assistant",
  "问答": "knowledge-assistant",
  "文档": "knowledge-assistant",
  "认证": "certification-expert",
  "ISO": "certification-expert",
  "诊断": "certification-expert",         // V2.0：诊断 → 认证专家（体系诊断）
  "规划": "certification-expert",
  "方案": "certification-expert",         // V2.0：方案 → 认证专家（认证方案）
  "架构": "certification-expert",
  "实施": "certification-expert",
  "审核": "certification-expert",         // V2.0：审核 → 认证专家（审核准备）
  "报价": "certification-expert"          // V2.0：报价 → 认证专家（认证报价建议）
};

const DEFAULT_EMPLOYEE = "knowledge-assistant";

export function detectEmployee(text: string): string {
  for (const [kw, employee] of Object.entries(EMPLOYEE_KEYWORDS)) {
    if (text.includes(kw)) return employee;
  }
  return DEFAULT_EMPLOYEE;
}

export async function handleFeishuMessage(
  chatId: string,
  text: string,
  senderOpenId: string
): Promise<string> {
  const role = detectEmployee(text);
  
  // 调用 AI 中心
  const result = await askAI({
    role,
    industry: "通用",
    companyContext: "",
    request: text,
    deliverable: "问答结论"
  });
  
  // 发送回飞书
  const response = formatResponse(result, role);
  await sendMessage("chat_id", {
    receive_id: chatId,
    msg_type: "text",
    content: JSON.stringify({ text: response })
  });
  
  return response;
}

function formatResponse(result: string, role: string): string {
  const employeeNames: Record<string, string> = {
    "consultant": "数字化咨询顾问",
    "solution-engineer": "方案工程师",
    "trainer": "培训讲师",
    "knowledge-assistant": "知识助手",
    "certification-expert": "认证专家"
  };
  
  // 截断到 4000 字（飞书限制）
  const truncated = result.length > 4000 
    ? result.slice(0, 3900) + "\n\n...(内容过长，已截断)" 
    : result;
  
  return `【${employeeNames[role]}】\n\n${truncated}`;
}
