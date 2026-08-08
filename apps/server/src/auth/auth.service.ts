/**
 * 认证模块 - JWT + bcrypt + DB 持久化 token
 *
 * Token 存 PostgreSQL（重启不丢）
 * - SHA-256 哈希 token（不存原 token 防泄露）
 * - 支持撤销（revoked_at）
 * - 登录设备追踪（IP / UA）
 */
import * as crypto from "crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { generateSecret, generateOtpAuthUrl, generateBackupCodes, verifyTotp, findAndConsumeBackupCode } from "./mfa.service.js";

const REFRESH_EXPIRY_DAYS = 7;

export interface UserRecord {
  id: string;
  companyId: string;
  username: string;
  email: string;
  displayName: string | null;
  role: "admin" | "regular";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface DbUserRow {
  id: string;
  company_id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

function rowToUser(r: DbUserRow): UserRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    username: r.username,
    email: r.email,
    displayName: r.display_name,
    role: r.role as "admin" | "regular",
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString(),
    lastLoginAt: r.last_login_at?.toISOString() ?? null
  };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function unbase64url(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function signJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  // 加 iat (毫秒级) + jti (UUID) 保证每次唯一
  const fullPayload = {
    iat: Date.now(),
    jti: crypto.randomUUID(),
    ...payload
  };
  const body = base64url(JSON.stringify(fullPayload));
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${base64url(sig)}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(`${h}.${b}`).digest();
  const actual = unbase64url(s);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload = JSON.parse(unbase64url(b).toString("utf8"));
    // exp 可能是秒或毫秒
    if (typeof payload.exp === "number") {
      const expMs = payload.exp > 1e12 ? payload.exp : payload.exp * 1000;
      if (Date.now() > expMs) return null;
    }
    return payload;
  } catch {
    return null;
  }
}

interface LoginContext {
  ip?: string;
  userAgent?: string;
}

interface LoginResult {
  token: string;
  refreshToken: string;
  user: UserRecord;
  expiresAt: number;
  /** 当 MFA 启用时，返回 mfaToken 用于第二步 */
  mfaToken?: string;
  mfaRequired?: boolean;
}

interface DbUserRowWithMfa extends DbUserRow {
  mfa_enabled: boolean;
  mfa_secret: string | null;
  mfa_backup_codes: string[] | null;
}

/** 登录 */
export async function login(
  username: string,
  password: string,
  ctx: LoginContext = {}
): Promise<LoginResult | null> {
  const r = await query<DbUserRowWithMfa>(
    `SELECT id, company_id, username, email, password_hash, display_name,
            role, is_active, must_change_password, created_at, last_login_at,
            mfa_enabled, mfa_secret, mfa_backup_codes
     FROM app_user
     WHERE username = $1 AND deleted_at IS NULL`,
    [username]
  );
  if (r.rows.length === 0) return null;
  const user = r.rows[0];
  if (!user.is_active) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  // 更新最后登录
  await query(
    `UPDATE app_user SET last_login_at = NOW(), last_login_ip = $2 WHERE id = $1`,
    [user.id, ctx.ip ?? null]
  );

  // 如果启用了 MFA，返回 mfaToken（短时 5 分钟）
  if (user.mfa_enabled) {
    const mfaTokenValue = crypto.randomUUID() + "." + crypto.randomBytes(16).toString("hex");
    const mfaTokenHash = hashToken(mfaTokenValue);
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await query(
      `INSERT INTO mfa_pending_token (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, mfaTokenHash, new Date(expiresAt)]
    );
    return {
      token: "",
      refreshToken: "",
      user: rowToUser(user),
      expiresAt: 0,
      mfaToken: mfaTokenValue,
      mfaRequired: true
    };
  }

  // 签发 access token (24h) + refresh token (7d)
  const accessExpiresAt = Date.now() + config.jwtExpiryHours * 3600 * 1000;
  const refreshExpiresAt = Date.now() + REFRESH_EXPIRY_DAYS * 24 * 3600 * 1000;

  const accessToken = signJwt({
    sub: user.id, type: "access", username: user.username, role: user.role, companyId: user.company_id,
    exp: accessExpiresAt  // 毫秒
  });
  const refreshToken = signJwt({
    sub: user.id, type: "refresh", exp: refreshExpiresAt  // 毫秒
  });

  // 存 DB
  const accessHash = hashToken(accessToken);
  const refreshHash = hashToken(refreshToken);
  await query(
    `INSERT INTO active_token
       (id, company_id, user_id, token_hash, expires_at, created_ip, user_agent)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6)`,
    [
      user.company_id, user.id,
      accessHash, new Date(accessExpiresAt),
      ctx.ip ?? null, ctx.userAgent ?? null
    ]
  );
  await query(
    `INSERT INTO active_token
       (id, company_id, user_id, token_hash, expires_at, created_ip, user_agent)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6)`,
    [
      user.company_id, user.id,
      refreshHash, new Date(refreshExpiresAt),
      ctx.ip ?? null, ctx.userAgent ?? null
    ]
  );

  return {
    token: accessToken,
    refreshToken,
    user: rowToUser(user),
    expiresAt: accessExpiresAt
  };
}

/** 验证 token */
export async function authenticate(token: string): Promise<UserRecord | null> {
  // 1. JWT 签名验证
  const payload = verifyJwt(token);
  if (!payload || typeof payload.sub !== "string") return null;

  // 2. 类型必须是 access
  if (payload.type !== "access") return null;

  // 3. DB 中查（不存原 token，只查 hash）
  const tokenHash = hashToken(token);
  const r = await query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT user_id, expires_at, revoked_at FROM active_token
     WHERE token_hash = $1`,
    [tokenHash]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // 4. 用户存在 + 活跃
  const ur = await query<DbUserRow>(
    `SELECT id, company_id, username, email, password_hash, display_name,
            role, is_active, must_change_password, created_at, last_login_at
     FROM app_user WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
    [row.user_id]
  );
  if (ur.rows.length === 0) return null;
  return rowToUser(ur.rows[0]);
}

/** 刷新 token */
export async function refresh(oldRefreshToken: string): Promise<LoginResult | null> {
  const payload = verifyJwt(oldRefreshToken);
  if (!payload || payload.type !== "refresh" || typeof payload.sub !== "string") {
    return null;
  }
  // 撤销旧 refresh token
  const oldHash = hashToken(oldRefreshToken);
  const upd = await query(
    `UPDATE active_token SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [oldHash]
  );
  // 如果没有撤销任何记录，说明这个 refresh token 已经无效（被撤销或不存在）
  if ((upd.rowCount ?? 0) === 0) {
    return null;
  }

  // 查 user
  const ur = await query<DbUserRow>(
    `SELECT id, company_id, username, email, password_hash, display_name,
            role, is_active, must_change_password, created_at, last_login_at
     FROM app_user WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
    [payload.sub]
  );
  if (ur.rows.length === 0) return null;
  const user = ur.rows[0];

  // 重新签发
  const accessExpiresAt = Date.now() + config.jwtExpiryHours * 3600 * 1000;
  const refreshExpiresAt = Date.now() + REFRESH_EXPIRY_DAYS * 24 * 3600 * 1000;
  const accessToken = signJwt({
    sub: user.id, type: "access", username: user.username, role: user.role, companyId: user.company_id,
    exp: accessExpiresAt
  });
  const refreshToken = signJwt({
    sub: user.id, type: "refresh", exp: refreshExpiresAt
  });

  await query(
    `INSERT INTO active_token (id, company_id, user_id, token_hash, expires_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4), (uuid_generate_v4(), $1, $2, $5, $6)`,
    [user.company_id, user.id,
     hashToken(accessToken), new Date(accessExpiresAt),
     hashToken(refreshToken), new Date(refreshExpiresAt)]
  );

  return {
    token: accessToken,
    refreshToken,
    user: rowToUser(user),
    expiresAt: accessExpiresAt
  };
}

/** 登出（撤销当前 token）*/
export async function logout(token: string): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const r = await query(
    `UPDATE active_token SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
  return r.rowCount !== null && r.rowCount > 0;
}

/** 撤销用户所有 token（管理员操作）*/
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const r = await query(
    `UPDATE active_token SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return r.rowCount ?? 0;
}

/** MFA 验证第二步 */
export async function verifyMfa(
  mfaToken: string,
  code: string
): Promise<LoginResult | null> {
  const tokenHash = hashToken(mfaToken);
  const r = await query<{
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `SELECT user_id, expires_at, used_at
     FROM mfa_pending_token
     WHERE token_hash = $1`,
    [tokenHash]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (row.used_at) return null;  // 一次性
  if (new Date(row.expires_at) < new Date()) return null;

  // 查 user + MFA secret
  const ur = await query<DbUserRowWithMfa>(
    `SELECT id, company_id, username, email, password_hash, display_name,
            role, is_active, must_change_password, created_at, last_login_at,
            mfa_enabled, mfa_secret, mfa_backup_codes
     FROM app_user WHERE id = $1 AND is_active = true`,
    [row.user_id]
  );
  if (ur.rows.length === 0) return null;
  const user = ur.rows[0];

  // 验证 TOTP 或 备份码
  let verified = false;
  if (user.mfa_secret && verifyTotp(user.mfa_secret, code)) {
    verified = true;
  } else if (user.mfa_backup_codes) {
    const result = findAndConsumeBackupCode(user.mfa_backup_codes, code);
    if (result.ok) {
      // 消耗一个备份码
      await query(
        `UPDATE app_user SET mfa_backup_codes = $1 WHERE id = $2`,
        [result.remaining, user.id]
      );
      verified = true;
    }
  }
  if (!verified) return null;

  // 标记 mfa_token 已用
  await query(
    `UPDATE mfa_pending_token SET used_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );

  // 签发 access + refresh
  const accessExpiresAt = Date.now() + config.jwtExpiryHours * 3600 * 1000;
  const refreshExpiresAt = Date.now() + REFRESH_EXPIRY_DAYS * 24 * 3600 * 1000;
  const accessToken = signJwt({
    sub: user.id, type: "access", username: user.username, role: user.role, companyId: user.company_id,
    exp: accessExpiresAt
  });
  const refreshToken = signJwt({
    sub: user.id, type: "refresh", exp: refreshExpiresAt
  });
  await query(
    `INSERT INTO active_token (id, company_id, user_id, token_hash, expires_at, created_ip, user_agent)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6), (uuid_generate_v4(), $1, $2, $7, $8, $5, $6)`,
    [user.company_id, user.id,
     hashToken(accessToken), new Date(accessExpiresAt),
     null, null,
     hashToken(refreshToken), new Date(refreshExpiresAt)]
  );
  return {
    token: accessToken,
    refreshToken,
    user: rowToUser(user),
    expiresAt: accessExpiresAt
  };
}

/** 设置 MFA（首次启用） */
export async function enableMfa(userId: string): Promise<{ secret: string; otpauthUrl: string; backupCodes: string[] } | null> {
  const secret = generateSecret();
  const backupCodes = generateBackupCodes();

  // 写 DB
  const r = await query<{ email: string; display_name: string | null }>(
    `SELECT email, display_name FROM app_user WHERE id = $1`,
    [userId]
  );
  if (r.rows.length === 0) return null;
  const email = r.rows[0].email;

  await query(
    `UPDATE app_user SET mfa_enabled = true, mfa_secret = $1, mfa_backup_codes = $2, mfa_enabled_at = NOW() WHERE id = $3`,
    [secret, backupCodes, userId]
  );

  return {
    secret,
    otpauthUrl: generateOtpAuthUrl(email, secret),
    backupCodes
  };
}

/** 禁用 MFA */
export async function disableMfa(userId: string): Promise<boolean> {
  const r = await query(
    `UPDATE app_user SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL, mfa_enabled_at = NULL WHERE id = $1`,
    [userId]
  );
  return r.rowCount !== null && r.rowCount > 0;
}

/** 创建用户 */
export async function createUser(input: {
  companyId: string;
  username: string;
  email: string;
  password: string;
  displayName?: string;
  role?: "admin" | "regular";
}): Promise<UserRecord> {
  const hash = await bcrypt.hash(input.password, 10);
  const r = await query<DbUserRow>(
    `INSERT INTO app_user
       (id, company_id, username, email, password_hash, display_name, role,
        is_active, must_change_password, created_at, updated_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, true, true, NOW(), NOW())
     RETURNING id, company_id, username, email, password_hash, display_name,
               role, is_active, must_change_password, created_at, last_login_at`,
    [
      input.companyId,
      input.username,
      input.email,
      hash,
      input.displayName ?? input.username,
      input.role ?? "regular"
    ]
  );
  return rowToUser(r.rows[0]);
}

export async function listUsers(companyId: string): Promise<UserRecord[]> {
  const r = await query<DbUserRow>(
    `SELECT id, company_id, username, email, password_hash, display_name,
            role, is_active, must_change_password, created_at, last_login_at
     FROM app_user
     WHERE company_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [companyId]
  );
  return r.rows.map(rowToUser);
}

export async function resetPassword(companyId: string, userId: string, newPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(newPassword, 10);
  const r = await query(
    `UPDATE app_user
     SET password_hash = $1, must_change_password = true, updated_at = NOW()
     WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL`,
    [hash, userId, companyId]
  );
  if ((r.rowCount ?? 0) > 0) await revokeAllUserTokens(userId);
  return r.rowCount !== null && r.rowCount > 0;
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const current = await query<{ password_hash: string }>(
    `SELECT password_hash FROM app_user
     WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
    [userId]
  );
  if (!current.rows[0] || !(await bcrypt.compare(currentPassword, current.rows[0].password_hash))) {
    return false;
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await query(
    `UPDATE app_user
     SET password_hash = $1, must_change_password = false, updated_at = NOW()
     WHERE id = $2`,
    [hash, userId]
  );
  await revokeAllUserTokens(userId);
  return true;
}

export async function setUserActive(companyId: string, userId: string, active: boolean): Promise<boolean> {
  const r = await query(
    `UPDATE app_user SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3 AND deleted_at IS NULL`,
    [active, userId, companyId]
  );
  if (r.rowCount && r.rowCount > 0 && !active) {
    // 禁用时撤销所有 token
    await revokeAllUserTokens(userId);
  }
  return r.rowCount !== null && r.rowCount > 0;
}

/** Express 中间件：从 Authorization 取 user */
export async function authMiddleware(token: string | undefined): Promise<UserRecord | null> {
  if (!token) return null;
  const t = token.startsWith("Bearer ") ? token.slice(7) : token;
  return await authenticate(t);
}
