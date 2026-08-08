/**
 * 调用 AI 中心 RAG 接口
 */
import { config } from "../../config.js";

interface AskInput {
  role: string;
  industry: string;
  companyContext: string;
  request: string;
  deliverable: string;
}

export async function askAI(input: AskInput): Promise<string> {
  const resp = await fetch(`http://127.0.0.1:${config.port}/api/consultations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, model: "openai" })
  });
  
  if (!resp.ok) {
    return `❌ AI 中心调用失败：${resp.status}`;
  }
  
  const data = await resp.json() as { data?: { result?: string } };
  return data.data?.result ?? "无回复";
}
