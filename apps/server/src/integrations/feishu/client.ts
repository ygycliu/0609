/**
 * 飞书 OpenAPI 客户端
 * 用于发送消息、读表格
 */
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

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

export interface SendOptions {
  atUserIds?: string[];        // @ 提醒的 user_id（open_id）
  atAll?: boolean;             // @所有人
}

export async function sendMessage(
  receive_id_type: "open_id" | "chat_id",
  message: FeishuMessage,
  options: SendOptions = {}
) {
  const token = await getTenantToken();
  const body: any = { ...message, uuid: randomUUID() };

  // V2.1: @ 提醒支持
  if (options.atUserIds && options.atUserIds.length > 0) {
    body.at = {
      at_user_ids: options.atUserIds,
      at_all: false
    };
  } else if (options.atAll) {
    body.at = { at_all: true };
  }

  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receive_id_type}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
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
 * 支持 @ 提醒（atUserIds / atAll）
 */
export async function notifyGroup(chatId: string, content: {
  text?: string;
  title?: string;
  fields?: Array<{ key: string; value: string }>;
  link?: string;
  atUserIds?: string[];   // @ 提醒特定用户
  atAll?: boolean;        // @所有人
}) {
  if (!chatId) {
    console.warn("[Feishu] notifyGroup: chatId 为空");
    return { code: -1, msg: "chatId 为空" };
  }

  // V2.1: 优先用 Open API（支持 @ + 卡片 + 更丰富）
  if (!APP_ID || !APP_SECRET) {
    // 回退到 webhook（只支持文本，不支持 @）
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

  // text 消息（含关键词防 19024）
  const baseText = content.text || "";
  const safeText = baseText + (baseText.includes("合同") ? "" : "\n\n（含合同关键词）");

  return await sendMessage(
    "chat_id",
    {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: safeText })
    },
    {
      atUserIds: content.atUserIds,
      atAll: content.atAll
    }
  );
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
