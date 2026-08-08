/**
 * 飞书事件处理
 */
import crypto from "node:crypto";
import type { FeishuEvent } from "./types.js";

const VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN ?? "";
const ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY ?? "";

export function verifyChallenge(challenge: string, token: string): boolean {
  if (!VERIFICATION_TOKEN) return false;
  return token === VERIFICATION_TOKEN;
}

export function decryptEvent(encrypted: string): string {
  if (!ENCRYPT_KEY) return encrypted;
  const key = crypto.createHash("sha256").update(ENCRYPT_KEY).digest();
  // 飞书 AES-256-CBC 加密
  // 实际解密略，需要前端公钥加密
  return encrypted;
}

export function handleMessageEvent(event: FeishuEvent): string {
  // 解析 @机器人 消息
  const message = event.event?.message;
  if (!message) return "no message";
  
  // 提取 @ 之后的文本
  const text = message.content?.text ?? "";
  const mentions = message.mentions ?? [];
  
  // 去掉 @ 机器人 部分
  let cleanText = text;
  for (const mention of mentions) {
    if (mention.key) {
      cleanText = cleanText.replace(mention.key, "").trim();
    }
  }
  
  return cleanText;
}
