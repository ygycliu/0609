/**
 * 飞书 HTTP 端点
 */
import type { Request, Response, NextFunction } from "express";
import type { FeishuEvent } from "./types.js";
import { verifyChallenge, handleMessageEvent } from "./events.js";
import { handleFeishuMessage } from "./router.js";
import { sendWebhookMessage } from "./client.js";

const WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL ?? "";

/**
 * 事件订阅端点（飞书主动推送消息到这里）
 */
export async function handleEvent(request: Request, response: Response, _next: NextFunction) {
  const body = request.body as FeishuEvent;
  
  // URL 验证（飞书配置时调用）
  if (body.challenge) {
    if (verifyChallenge(body.challenge, body.token ?? "")) {
      return response.json({ challenge: body.challenge });
    }
    return response.status(403).json({ error: "verification failed" });
  }
  
  // 处理事件
  if (body.header?.event_type === "im.message.receive_v1") {
    const text = handleMessageEvent(body);
    const chatId = body.event?.message?.chat_id;
    const senderId = body.event?.sender?.sender_id?.open_id;
    
    if (chatId && text) {
      // 异步处理（立即返回 200 避免飞书重试）
      handleFeishuMessage(chatId, text, senderId ?? "").catch(err => {
        console.error("Feishu handler error:", err);
      });
    }
  }
  
  return response.json({ code: 0 });
}

/**
 * 主动推送消息端点（用于定时推送）
 */
export async function pushMessage(request: Request, response: Response, _next: NextFunction) {
  const { content, msgType = "interactive" } = request.body as {
    content: any;
    msgType?: "text" | "interactive";
  };
  
  if (!WEBHOOK_URL) {
    return response.status(500).json({ error: "FEISHU_WEBHOOK_URL not set" });
  }
  
  const result = await sendWebhookMessage(WEBHOOK_URL, {
    msg_type: msgType,
    content
  });
  
  return response.json(result);
}
