/**
 * 认证路由（/api/auth/*）
 *
 * 业务：登录、MFA 启用/验证/禁用、token 刷新、登出、改密码、当前用户、用户管理（admin）
 *
 * 拆分前：app.ts L341-558（218 行，11 个端点）
 * 拆分后：本文件 + app.ts 一行 app.use("/api/auth", createAuthRouter({ ... }))
 *
 * ⚠️ 关键：登录/refresh 不走 authMiddleware（用户未登录），其他端点都用 getUserFromReq 检查
 *
 * 创建：阶段 1 重构（commit 9821bd0 样板后第二批）
 */

import express, { type Router } from "express";
import { z } from "zod";
import {
  login,
  logout,
  createUser,
  listUsers,
  resetPassword,
  changeOwnPassword,
  setUserActive,
  verifyMfa,
  enableMfa,
  disableMfa,
  refresh as refreshToken
} from "../auth/auth.service.js";
import type { UserRecord } from "../auth/auth.service.js";
import {
  ACCESS_COOKIE,
  MFA_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  readCookie,
  setMfaCookie,
  setSessionCookies
} from "../auth/session.js";
import { ValidationError, UnauthorizedError, ForbiddenError } from "../shared/errors.js";
import { query } from "../db/pool.js";

export interface AuthRouterDeps {
  getUserFromReq: (request: express.Request) => UserRecord;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { getUserFromReq } = deps;
  const router = express.Router();

  // ============================================================
  // 登录（不走 authMiddleware）
  // ============================================================
  router.post("/login", async (request, response, next) => {
    try {
      const { username, password } = request.body ?? {};
      if (!username || !password) {
        throw new ValidationError("请输入用户名和密码");
      }
      const ip = (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        || request.socket?.remoteAddress;
      const ua = request.headers["user-agent"] as string;
      const result = await login(username, password, { ip, userAgent: ua });
      if (!result) {
        throw new UnauthorizedError("用户名或密码错误");
      }
      // 如果需要 MFA，只返回 mfaToken
      if (result.mfaRequired) {
        setMfaCookie(response, result.mfaToken ?? "");
        response.json({
          data: {
            mfaRequired: true,
            user: result.user
          }
        });
        return;
      }
      setSessionCookies(response, result.token, result.refreshToken, result.expiresAt);
      response.json({
        data: {
          expiresAt: result.expiresAt,
          user: result.user
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // MFA 验证第二步
  // ============================================================
  router.post("/mfa/verify", async (request, response, next) => {
    try {
      const { code } = request.body ?? {};
      const mfaToken = readCookie(request, MFA_COOKIE);
      if (!mfaToken || !code) {
        throw new ValidationError("请提供MFA验证码");
      }
      const result = await verifyMfa(mfaToken, code);
      if (!result) {
        throw new UnauthorizedError("MFA验证码错误或已过期");
      }
      setSessionCookies(response, result.token, result.refreshToken, result.expiresAt);
      response.json({
        data: {
          expiresAt: result.expiresAt,
          user: result.user
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // 启用 MFA（用户主动开）
  // ============================================================
  router.post("/mfa/enable", async (request, response, next) => {
    try {
      const u = await getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const result = await enableMfa(u.id);
      if (!result) throw new ValidationError("启用失败");
      response.json({
        data: {
          secret: result.secret,
          otpauthUrl: result.otpauthUrl,
          backupCodes: result.backupCodes
        }
      });
    } catch (error) { next(error); }
  });

  // ============================================================
  // 禁用 MFA
  // ============================================================
  router.post("/mfa/disable", async (request, response, next) => {
    try {
      const u = await getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const ok = await disableMfa(u.id);
      response.json({ data: { ok } });
    } catch (error) { next(error); }
  });

  // ============================================================
  // 刷新 token
  // ============================================================
  router.post("/refresh", async (request, response, next) => {
    try {
      const rt = readCookie(request, REFRESH_COOKIE);
      if (!rt) throw new UnauthorizedError("登录已过期");
      const result = await refreshToken(rt);
      if (!result) {
        clearAuthCookies(response);
        throw new UnauthorizedError("登录已过期");
      }
      setSessionCookies(response, result.token, result.refreshToken, result.expiresAt);
      response.json({
        data: {
          expiresAt: result.expiresAt,
          user: result.user
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // 当前用户（带公司信息）
  // ============================================================
  router.get("/me", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      // 返回用户信息 + 公司信息
      const company = await query<{ id: string; name: string; short_name: string; industry: string }>(
        `SELECT id, name, short_name, industry FROM company WHERE id = $1`,
        [u.companyId]
      );
      response.json({
        data: {
          user: u,
          company: company.rows[0] ?? null
        }
      });
    } catch (error) { next(error); }
  });

  // ============================================================
  // 登出
  // ============================================================
  router.post("/logout", async (request, response, next) => {
    try {
      const token = readCookie(request, ACCESS_COOKIE);
      await logout(token);
      clearAuthCookies(response);
      response.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  // ============================================================
  // 改自己密码
  // ============================================================
  router.post("/change-password", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(12).max(128)
      }).safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError("新密码至少12位");
      }
      if (!(await changeOwnPassword(u.id, parsed.data.currentPassword, parsed.data.newPassword))) {
        throw new UnauthorizedError("当前密码错误");
      }
      clearAuthCookies(response);
      response.json({ data: { ok: true, reloginRequired: true } });
    } catch (error) { next(error); }
  });

  // ============================================================
  // 用户管理（admin）
  // ============================================================
  router.get("/users", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      response.json({ data: await listUsers(u.companyId) });
    } catch (error) { next(error); }
  });

  router.post("/users", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      const parsed = z.object({
        username: z.string().trim().min(2).max(50),
        email: z.string().email(),
        password: z.string().min(8).max(100),
        displayName: z.string().trim().max(100).optional(),
        role: z.enum(["admin", "regular"]).default("regular")
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
      const created = await createUser({ ...parsed.data, companyId: u.companyId });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  router.patch("/users/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      const id = request.params.id;
      const parsed = z.object({
        isActive: z.boolean().optional(),
        newPassword: z.string().min(8).max(100).optional()
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
      if (parsed.data.isActive !== undefined) {
        await setUserActive(u.companyId, id, parsed.data.isActive);
      }
      if (parsed.data.newPassword) {
        await resetPassword(u.companyId, id, parsed.data.newPassword);
      }
      response.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  return router;
}
