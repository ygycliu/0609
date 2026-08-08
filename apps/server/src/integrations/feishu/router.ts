/**
 * 飞书消息路由器
 * 把飞书消息路由到 AI 中心对应员工
 */
import { askAI } from "./ask.js";
import { sendMessage } from "./client.js";

const EMPLOYEE_KEYWORDS: Record<string, string> = {
  // 飞书关键词 → AI 中心员工 ID
  "咨询": "consultant",
  "诊断": "consultant",
  "规划": "consultant",
  "方案": "solution-engineer",
  "架构": "solution-engineer",
  "实施": "solution-engineer",
  "培训": "trainer",
  "课程": "trainer",
  "学习": "trainer",
  "知识": "knowledge-assistant",
  "问答": "knowledge-assistant",
  "认证": "certification-expert",
  "ISO": "certification-expert",
  "审核": "certification-expert",
  "报价": "certification-expert"
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
