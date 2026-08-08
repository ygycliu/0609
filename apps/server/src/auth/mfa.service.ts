/**
 * MFA 模块 - TOTP 双因素认证（otplib v13）
 *
 * - 符合 RFC 6238（Google Authenticator / Authy / 1Password 兼容）
 * - 30 秒时间窗口（±1 步 = ±30 秒）
 * - 8 个一次性备份码（10 个字符）
 */
import * as crypto from "crypto";
import {
  generateSecret as otpGenerateSecret,
  generateSync as otpGenerate,
  verifySync as otpVerify,
  generateURI as otpKeyUri
} from "otplib";

const BACKUP_CODES_COUNT = 8;
const BACKUP_CODE_LENGTH = 10;

/** 生成 TOTP secret (base32) */
export function generateSecret(): string {
  return otpGenerateSecret();
}

/** 验证 TOTP code */
export function verifyTotp(secret: string, code: string): boolean {
  try {
    const result = otpVerify({ token: code.replace(/\s/g, ""), secret });
    // v13 返回 {valid: boolean}，老版本返回 boolean
    if (typeof result === "boolean") return result;
    return Boolean((result as any)?.valid);
  } catch {
    return false;
  }
}

/** 生成 otpauth:// URL（用于 QR 码） */
export function generateOtpAuthUrl(email: string, secret: string, issuer = "AI 数字化咨询中心"): string {
  // 手写 otpauth URL（避免 otplib v13 generateURI 参数变化）
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** 同步生成当前 TOTP code（仅测试用） */
export function generateTotp(secret: string): string {
  return otpGenerate({ secret });
}

/** 生成 8 个一次性备份码 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODES_COUNT; i++) {
    const code = Array.from(crypto.randomBytes(BACKUP_CODE_LENGTH / 2))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, BACKUP_CODE_LENGTH);
    codes.push(code);
  }
  return codes;
}

/** 验证备份码（一次性使用） */
export function findAndConsumeBackupCode(
  storedCodes: string[] | null,
  input: string
): { ok: boolean; remaining: string[] } {
  if (!storedCodes) return { ok: false, remaining: [] };
  const clean = input.replace(/\s/g, "").toLowerCase();
  const idx = storedCodes.findIndex(c => c.toLowerCase() === clean);
  if (idx === -1) return { ok: false, remaining: storedCodes };
  const remaining = [...storedCodes.slice(0, idx), ...storedCodes.slice(idx + 1)];
  return { ok: true, remaining };
}