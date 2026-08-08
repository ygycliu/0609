/**
 * 飞书 OpenAPI 客户端
 * 用于发送消息、读表格
 */
import crypto from "node:crypto";

const APP_ID = process.env.FEISHU_APP_ID ?? "";
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? "";
const TENANT_TOKEN_CACHE: { token: string; expiresAt: number } = {
  token: "",
  expiresAt: 0
};

export async function getTenantToken(): Promise<string> {
  // 缓存
  if (TENANT_TOKEN_CACHE.token && Date.now() < TENANT_TOKEN_CACHE.expiresAt - 60_000) {
    return TENANT_TOKEN_CACHE.token;
  }
  
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await resp.json() as { tenant_access_token?: string; expire?: number; code?: number; msg?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书 token 获取失败: ${data.msg ?? data.code}`);
  }
  TENANT_TOKEN_CACHE.token = data.tenant_access_token;
  TENANT_TOKEN_CACHE.expiresAt = Date.now() + (data.expire ?? 7200) * 1000;
  return TENANT_TOKEN_CACHE.token;
}

export interface FeishuMessage {
  receive_id: string;          // open_id 或 chat_id
  msg_type: "text" | "interactive" | "post";
  content: string;             // JSON 字符串
}

export async function sendMessage(receive_id_type: "open_id" | "chat_id", message: FeishuMessage) {
  const token = await getTenantToken();
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receive_id_type}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(message)
    }
  );
  return await resp.json() as { code?: number; msg?: string; data?: any };
}

export async function sendWebhookMessage(webhookUrl: string, content: object) {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content)
  });
  return await resp.json() as { code?: number; msg?: string };
}
