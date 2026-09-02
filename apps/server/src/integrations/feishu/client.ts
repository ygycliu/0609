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

/**
 * V2.1：主动推送到指定群聊（chat_id）
 * 用于定时任务 + 系统预警推送
 */
export async function notifyGroup(chatId: string, content: {
  text?: string;
  title?: string;
  fields?: Array<{ key: string; value: string }>;
  link?: string;
}) {
  if (!chatId) {
    console.warn("[Feishu] notifyGroup: chatId 为空");
    return { code: -1, msg: "chatId 为空" };
  }
  if (!APP_ID || !APP_SECRET) {
    // V2.1: 优先用 webhook（更简单 + 含关键词防护）
    const webhookUrl = process.env.FEISHU_WEBHOOK_URL ?? "";
    if (!webhookUrl) {
      return { code: -2, msg: "飞书未配置：既无 APP_ID/SECRET 也无 FEISHU_WEBHOOK_URL" };
    }
    const baseText = content.text || "";
    const safeText = baseText + (baseText.includes("合同") ? "" : "\n\n（含合同关键词）");
    return await sendWebhookMessage(webhookUrl, {
      msg_type: "text",
      content: { text: safeText }
    });
  }

  // 构造 text 消息（最兼容，含关键词防 19024）
  // V2.1: 飞书群机器人可能设关键词防护，自动添加"合同"关键词以保证通过
  const baseText = content.text || "";
  const safeText = baseText + (baseText.includes("合同") ? "" : "\n\n（含合同关键词）");

  // text 消息格式（webhook 和 im/v1/messages 都接受）
  const card = {
    msg_type: "text",
    content: { text: safeText }
  };

  // sendMessage 内部会再次 stringify content，所以这里传 plain text object
  return await sendMessage("chat_id", {
    receive_id: chatId,
    msg_type: "text",
    content: JSON.stringify(card.content)
  });
}

/**
 * V2.1：批量推送到多个 chat_id
 */
export async function notifyGroups(chatIds: string[], content: Parameters<typeof notifyGroup>[1]) {
  const results = [];
  for (const chatId of chatIds) {
    try {
      const r = await notifyGroup(chatId, content);
      results.push({ chatId, success: r.code === 0, result: r });
    } catch (e) {
      results.push({ chatId, success: false, error: (e as Error).message });
    }
  }
  return results;
}
