/**
 * LLM API Key 加密（AES-256-GCM）
 *
 * V2.3.3：AI 中心配置大模型 — API key 入库前 AES-256-GCM 加密
 * - master key 从环境变量 LLM_ENCRYPTION_KEY（32 字节 base64）派生
 * - 每条配置独立 IV
 * - 16 字节 GCM auth tag 防篡改
 * - 密文、IV、tag 三段都存 DB，缺一不可解密
 *
 * 部署要求：
 *   生成密钥：openssl rand -base64 32
 *   写入 .env：LLM_ENCRYPTION_KEY=<base64>
 *   生产环境强制要求（config.ts 启动校验）
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;          // GCM 推荐 12 字节
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const raw = process.env.LLM_ENCRYPTION_KEY;
  if (!raw) {
    // 开发环境用固定 fallback（生产环境应在 config.ts 启动校验必填）
    if (config.production) {
      throw new Error("LLM_ENCRYPTION_KEY is required in production");
    }
    return Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // 32 字节
  }
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`LLM_ENCRYPTION_KEY must be 32 bytes (base64). Got ${key.length}`);
  }
  return key;
}

export interface EncryptedKey {
  ciphertext: string;  // base64
  iv: string;          // base64
  tag: string;         // base64
}

/** 加密 API key */
export function encryptApiKey(plaintext: string): EncryptedKey {
  if (!plaintext) {
    throw new Error("API key 不能为空");
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64")
  };
}

/** 解密 API key */
export function decryptApiKey(enc: EncryptedKey): string {
  if (!enc?.ciphertext || !enc?.iv || !enc?.tag) {
    throw new Error("密文/IV/tag 缺失，无法解密");
  }
  const key = getMasterKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final()
  ]);
  return dec.toString("utf8");
}

/** 校验 LLM_ENCRYPTION_KEY 是否配置（启动时调用） */
export function assertEncryptionKeyConfigured(): void {
  if (config.production && !process.env.LLM_ENCRYPTION_KEY) {
    throw new Error("生产环境必须配置 LLM_ENCRYPTION_KEY（openssl rand -base64 32）");
  }
}