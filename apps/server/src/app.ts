import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import { config } from "./config.js";
const execFile = promisify(execFileCb);
import { ConsultationService } from "./consultations/consultation.service.js";
import { extractDocumentText } from "./documents/document.service.js";
import { ConsultationRepository } from "./consultations/consultation.repository.js";
import { generateAuditPlan, generateChecklist, detectNonConformances, generateAuditReport } from "./auditor/auditor.service.js";
import { autoGenerateAuditPlan, listTemplates as listAuditTemplates } from "./follow_up/autoAuditPlan.js";
import { QuoteRepository } from "./certification/quote.repository.js";
import { CustomerRepository } from "./customers/customer.repository.js";
import { FinanceRepository } from "./finance/finance.repository.js";
import { ARRepository } from "./finance/ar.repository.js";
import { FollowUpRepository, FOLLOW_UP_STAGES, ISSUING_BODIES } from "./follow_up/follow_up.repository.js";
import { login, logout, createUser, listUsers, resetPassword, changeOwnPassword, setUserActive, authMiddleware, refresh as refreshToken, verifyMfa, enableMfa, disableMfa } from "./auth/auth.service.js";
import type { UserRecord } from "./auth/auth.service.js";
import { ACCESS_COOKIE, MFA_COOKIE, REFRESH_COOKIE, clearAuthCookies, readCookie, setMfaCookie, setSessionCookies } from "./auth/session.js";
import {
  enterpriseTemplateBranding,
  enterpriseTemplateRecord,
  generateConsultationDocx,
  generateQuoteDocx
} from "./docx/docx-report.service.js";
import {
  generateConsultationPptx,
  presentationTemplateBranding,
  presentationTemplateRecord
} from "./pptx/pptx-presentation.service.js";
import { employees } from "./employees/employee.service.js";
import { KnowledgeRepository } from "./knowledge/knowledge.repository.js";
import { searchKnowledge } from "./knowledge/retrieval.service.js";
import { generateWithModel, getAvailableModels } from "./models/model.gateway.js";
import { handleEvent, pushMessage } from "./integrations/feishu/index.js";
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "./shared/errors.js";
import { createLogger } from "./shared/logger.js";
import { query } from "./db/pool.js";
import type { EmployeeRole, ModelProvider } from "./shared/types.js";
import { generateQuote, getAvailableCertifications, INDUSTRY_OPTIONS, RISK_LEVEL_OPTIONS } from "./certification/quote.service.js";
import { getVersionInfo } from "./version/version.service.js";

const logger = createLogger();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const consultationSchema = z.object({
  role: z.enum(["consultant", "solution-engineer", "trainer", "knowledge-assistant", "certification-expert", "certification-auditor"]),
  industry: z.string().trim().min(1, "请选择或填写行业"),
  companyContext: z.string().trim().max(5000).default(""),
  request: z.string().trim().min(10, "请至少输入 10 个字的需求描述").max(10000),
  deliverable: z.string().trim().min(1, "请选择交付物"),
  model: z.enum(["demo", "openai", "ollama"]).default("demo")
});

const docxExportSchema = z.object({
  companyName: z.string().trim().min(1, "请填写编制单位").max(100),
  clientName: z.string().trim().min(1, "请填写客户单位").max(100),
  projectName: z.string().trim().min(1, "请填写项目名称").max(150),
  documentTitle: z.string().trim().min(1, "请填写文档标题").max(150),
  version: z.string().trim().min(1, "请填写文档版本").max(30),
  preparedBy: z.string().trim().min(1, "请填写编制人员").max(100),
  confidentiality: z.string().trim().min(1, "请填写密级或使用范围").max(50),
  includeToc: z.boolean().default(true),
  includeReferences: z.boolean().default(true)
});

const pptxExportSchema = z.object({
  companyName: z.string().trim().min(1, "请填写编制单位").max(100),
  clientName: z.string().trim().min(1, "请填写客户单位").max(100),
  projectName: z.string().trim().min(1, "请填写项目名称").max(150),
  presentationTitle: z.string().trim().min(1, "请填写演示标题").max(150),
  version: z.string().trim().min(1, "请填写演示版本").max(30),
  presenter: z.string().trim().min(1, "请填写汇报人员").max(100),
  confidentiality: z.string().trim().min(1, "请填写密级或使用范围").max(50),
  includeReferences: z.boolean().default(true)
});

export const quoteExportPayloadSchema = z.object({
  companyName: z.string().trim().min(1).max(100),
  companyContext: z.string().trim().max(1000).optional().default(""),
  quote: z.object({
    companyName: z.string(),
    industry: z.string(),
    employeeCount: z.number(),
    certifications: z.array(z.object({
      certId: z.string(),
      certName: z.string(),
      basePrice: z.number(),
      industryFactor: z.number(),
      adjustedBase: z.number(),
      initialAuditDays: z.number(),
      supervisionAuditDays: z.number(),
      recertificationAuditDays: z.number(),
      auditorLevel: z.enum(["中级", "高级"])
    })),
    sizeFactor: z.number(),
    sizeTier: z.string(),
    subtotal: z.number(),
    afterSizeFactor: z.number(),
    bundleDiscount: z.number(),
    bundleTier: z.string(),
    initialPrice: z.number(),
    supervisionPrice: z.number(),
    expertReviewFee: z.number(),
    groupLeaderFee: z.number(),
    professionalSubsidy: z.number(),
    travelFee: z.number(),
    certificateFee: z.number(),
    accommodationFee: z.number(),
    totalPrice: z.number(),
    totalAuditDays: z.number(),
    priceIncludes: z.array(z.string()),
    priceExcludes: z.array(z.string()),
    estimatedAuditDays: z.number(),
    generatedAt: z.string()
  })
});

function encodedFileName(value: string, extension: "docx" | "pptx") {
  const safeName = value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "咨询报告";
  return `UTF-8''${encodeURIComponent(`${safeName}.${extension}`)}`;
}

export function createApp() {
  const app = express();
  const knowledgeRepository = new KnowledgeRepository();
  // 探测 DB 可用性（不阻塞启动，DB 不可用时 fallback 到 JSON）
  knowledgeRepository.init().catch((err) => {
    console.warn("KnowledgeRepository init failed:", err?.message ?? err);
  });
  const consultationRepository = new ConsultationRepository();
  consultationRepository.init().catch((err) => {
    console.warn("ConsultationRepository init failed:", err?.message ?? err);
  });
  const quoteRepository = new QuoteRepository();
  quoteRepository.init().catch((err) => {
    console.warn("QuoteRepository init failed:", err?.message ?? err);
  });
  const customerRepository = new CustomerRepository();
  const financeRepository = new FinanceRepository();
  const arRepository = new ARRepository();
  const followUpRepository = new FollowUpRepository();
  customerRepository.init().catch((err) => {
    console.warn("CustomerRepository init failed:", err?.message ?? err);
  });
  const consultationService = new ConsultationService(knowledgeRepository, consultationRepository);

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      // MVP 仅 HTTP 部署：禁用所有要求 HTTPS 安全源的特性，避免浏览器强制升级
      hsts: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // 不升级 insecure：HTTP 部署用
          upgradeInsecureRequests: null,
          // 允许 Ollama / 其他本地 API 的 fetch
          "connect-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:"],
          "style-src": ["'self'", "https:", "'unsafe-inline'"]
        }
      }
    })
  );
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (request) =>
        String(request.headers["x-request-id"] ?? randomUUID())
    })
  );

  const getUserFromReq = (request: express.Request): UserRecord => {
    const user = (request as express.Request & { user?: UserRecord }).user;
    if (!user) throw new UnauthorizedError();
    return user;
  };

  // 公开端点：健康检查、登录、MFA 验证和刷新。
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "ai-digital-consulting-center" });
  });

  // 版本信息端点：只读查询，无需认证
  app.get("/api/version", (_request, response) => {
    response.json(getVersionInfo());
  });

  const publicApiPaths = new Set([
    "/api/auth/login",
    "/api/auth/mfa/verify",
    "/api/auth/refresh"
  ]);
  const passwordChangePaths = new Set([
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/logout"
  ]);

  app.use(async (request, response, next) => {
    if (!request.path.startsWith("/api/") || publicApiPaths.has(request.path)) {
      next();
      return;
    }
    try {
      const token = readCookie(request, ACCESS_COOKIE);
      const user = await authMiddleware(token);
      if (!user) throw new UnauthorizedError();
      if (user.mustChangePassword && !passwordChangePaths.has(request.path)) {
        response.status(428).json({
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "首次登录必须先修改临时密码"
        });
        return;
      }
      (request as express.Request & { user?: UserRecord }).user = user;
      next();
    } catch (error) {
      next(error);
    }
  });

// ============== 文件浏览器 - /mnt/renz 浏览与上传 ==============

  const FILES_ROOT = "/mnt/renz";

  function resolveSafePath(relative: string): string {
    // 空路径 = 根目录（合法）
    if (relative == null) throw new ValidationError("路径无效");
    if (typeof relative !== "string") throw new ValidationError("路径无效");
    if (relative.includes("\0")) throw new ValidationError("路径包含非法字符");
    const normalized = path.posix.normalize(relative).replace(/^[/\\]+/, "");
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) {
      throw new ValidationError("禁止跳出根目录");
    }
    const abs = path.join(FILES_ROOT, normalized);
    const real = path.resolve(abs);
    const rootReal = path.resolve(FILES_ROOT);
    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
      throw new ValidationError("禁止跳出根目录");
    }
    return real;
  }

  // 1. 列出目录
  app.get("/api/files/list", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      const abs = resolveSafePath(relative);

      let stat;
      try { stat = await fs.stat(abs); } catch { throw new NotFoundError("目录"); }
      if (!stat.isDirectory()) throw new ValidationError("不是目录");

      const entries = await fs.readdir(abs, { withFileTypes: true });
      const items: any[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const fullPath = path.join(abs, e.name);
        const rel = path.posix.join(relative, e.name);
        try {
          const st = await fs.stat(fullPath);
          items.push({
            name: e.name,
            path: rel,
            isDir: e.isDirectory(),
            size: e.isDirectory() ? 0 : st.size,
            modifiedAt: st.mtime.toISOString()
          });
        } catch { /* ignore */ }
      }

      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-Hans-CN");
      });

      const breadcrumbs = relative
        ? relative.split("/").filter(Boolean).map((part: string, i: number, arr: string[]) => ({
            name: part,
            path: arr.slice(0, i + 1).join("/")
          }))
        : [];

      response.json({
        data: {
          path: relative,
          breadcrumbs,
          parent: relative ? relative.split("/").slice(0, -1).join("/") : null,
          items
        }
      });
    } catch (error) { next(error); }
  });

  // 2. 上传文件
  app.post("/api/files/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请选择文件");
      const target = (request.body?.path as string) || "";
      const absDir = resolveSafePath(target);
      let stat;
      try { stat = await fs.stat(absDir); } catch { throw new NotFoundError("目标目录"); }
      if (!stat.isDirectory()) throw new ValidationError("目标不是目录");

      const originalName = request.file.originalname;
      let final = path.join(absDir, originalName);
      let n = 1;
      while (true) {
        try {
          await fs.access(final);
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          final = path.join(absDir, `${base} (${n})${ext}`);
          n++;
        } catch { break; }
      }

      await fs.writeFile(final, request.file.buffer);

      response.status(201).json({
        data: {
          name: path.basename(final),
          path: path.posix.join(target, path.basename(final)),
          size: request.file.size,
          sizeBytes: request.file.size
        }
      });
    } catch (error) { next(error); }
  });

  // 3. 下载文件
  app.get("/api/files/download", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      const abs = resolveSafePath(relative);
      let stat;
      try { stat = await fs.stat(abs); } catch { throw new NotFoundError("文件"); }
      if (!stat.isFile()) throw new ValidationError("不是文件");

      const originalName = path.basename(abs);
      // RFC 6266 兼容 + 防 header 注入
      const safeAscii = originalName
        .replace(/[\r\n"]/g, "_")  // 移除危险字符
        .replace(/[^\x20-\x7E]/g, "_");  // 非 ASCII 替换为 _
      const encoded = encodeURIComponent(originalName);
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
      );
      // 用流避免 sendFile 兼容问题
            const fsSync = await import("node:fs");
            const stream = fsSync.createReadStream(abs);
            stream.on("error", (err: NodeJS.ErrnoException) => {
              console.error("[files/download] stream error:", err);
              if (!response.headersSent) next(err);
            });
            stream.pipe(response);
    } catch (error) { next(error); }
  });

  // 4. 删除
  app.delete("/api/files/delete", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      if (!relative) throw new ValidationError("路径必填");
      const abs = resolveSafePath(relative);
      let stat;
      try { stat = await fs.stat(abs); } catch { throw new NotFoundError("文件"); }

      if (abs === path.resolve(FILES_ROOT)) {
        throw new ValidationError("禁止删除根目录");
      }

      if (stat.isDirectory()) {
        await fs.rm(abs, { recursive: true, force: true });
      } else {
        await fs.unlink(abs);
      }
      response.status(204).send();
    } catch (error) { next(error); }
  });

  // 5. 创建子目录
  app.post("/api/files/mkdir", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const { path: parent = "", name } = request.body || {};
      if (!name || typeof name !== "string") throw new ValidationError("目录名必填");
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new ValidationError("目录名包含非法字符");
      }
      const absParent = resolveSafePath(parent);
      const target = path.join(absParent, name);
      const realTarget = path.resolve(target);
      const rootReal = path.resolve(FILES_ROOT);
      if (!realTarget.startsWith(rootReal + path.sep)) throw new ValidationError("禁止跳出根目录");

      await fs.mkdir(target, { recursive: false });
      response.status(201).json({
        data: { name, path: path.posix.join(parent, name) }
      });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/login", async (request, response, next) => {
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

  // MFA 验证第二步
  app.post("/api/auth/mfa/verify", async (request, response, next) => {
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

  // 启用 MFA（用户主动开）
  app.post("/api/auth/mfa/enable", async (request, response, next) => {
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

  // 禁用 MFA
  app.post("/api/auth/mfa/disable", async (request, response, next) => {
    try {
      const u = await getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const ok = await disableMfa(u.id);
      response.json({ data: { ok } });
    } catch (error) { next(error); }
  });

  // 刷新 token
  app.post("/api/auth/refresh", async (request, response, next) => {
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

  app.get("/api/employees", (_request, response) => response.json({ data: employees }));
  app.get("/api/models", (_request, response) =>
    response.json({ data: getAvailableModels() })
  );

  // 根据用户 company_id 过滤（多租户隔离）
  const listWithCompany = async <T extends Record<string, unknown>>(
    tableName: string,
    companyId: string,
    extraWhere: string = ""
  ): Promise<T[]> => {
    const r = await query<T>(
      `SELECT * FROM ${tableName}
       WHERE company_id = $1 AND deleted_at IS NULL ${extraWhere}
       ORDER BY created_at DESC LIMIT 200`,
      [companyId]
    );
    return r.rows;
  };

  app.get("/api/auth/me", async (request, response, next) => {
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

  app.post("/api/auth/logout", async (request, response, next) => {
    try {
      const token = readCookie(request, ACCESS_COOKIE);
      await logout(token);
      clearAuthCookies(response);
      response.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/change-password", async (request, response, next) => {
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

  // ===== 用户管理（admin） =====
  app.get("/api/auth/users", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      response.json({ data: await listUsers(u.companyId) });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/users", async (request, response, next) => {
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

  app.patch("/api/auth/users/:id", async (request, response, next) => {
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

  // ============== 数字审核员（certification-auditor）API ==============
  // 1. 生成审核计划
  app.post("/api/auditor/plan", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      console.log("[auditor/plan] user:", u.username, "company:", u.companyId);

      const body = (request.body ?? {}) as {
        customerName?: string;
        industry?: string;
        employeeCount?: number;
        auditType?: "initial" | "surveillance" | "recertification";
        standards?: Array<"iso9001" | "iso14001" | "iso45001">;
        address?: string;
        contactPerson?: string;
        contactPhone?: string;
        scheduledDate?: string;
      };

      if (!body.customerName || !body.industry || !body.standards || body.standards.length === 0) {
        throw new ValidationError("客户名/行业/标准 必填");
      }

      // 检索数字审核员知识库
      const retrieval = await import("./knowledge/retrieval.service.js");
      const { KnowledgeRepository } = await import("./knowledge/knowledge.repository.js");
      const repo = new KnowledgeRepository();
      await repo.init();
      const allKnowledge = await repo.list(u.companyId);
      const filtered = allKnowledge.filter((k) =>
        ["ISO标准审核要点", "中认内部审核资料", "QES案例研究"].includes(k.category)
      );
      const knowledge = retrieval.searchKnowledge(
        "QES 审核要点 计划 抽样",
        filtered,
        { limit: 5 }
      );
      const planMd = generateAuditPlan({
        customerName: body.customerName,
        industry: body.industry,
        employeeCount: body.employeeCount ?? 50,
        auditType: body.auditType ?? "surveillance",
        standards: body.standards,
        address: body.address ?? "未提供",
        contactPerson: body.contactPerson,
        contactPhone: body.contactPhone,
        scheduledDate: body.scheduledDate
      }, knowledge);

      response.json({ data: { plan: planMd, references: knowledge.map((k) => k.title) } });
    } catch (error: any) {
      console.error("[auditor/plan] error:", error?.message, error?.stack?.slice(0, 500));
      response.status(500).json({ code: "INTERNAL_ERROR", message: error?.message ?? "服务处理失败", stack: error?.stack?.slice(0, 500) });
    }
  });

  // 2. 生成现场检查表
  app.post("/api/auditor/checklist", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const body = (request.body ?? {}) as {
        customerName?: string;
        industry?: string;
        employeeCount?: number;
        auditType?: "initial" | "surveillance" | "recertification";
        standards?: Array<"iso9001" | "iso14001" | "iso45001">;
        address?: string;
      };

      if (!body.customerName || !body.standards || body.standards.length === 0) {
        throw new ValidationError("客户名/标准 必填");
      }

      const checklist = generateChecklist({
        customerName: body.customerName,
        industry: body.industry ?? "未指定",
        employeeCount: body.employeeCount ?? 50,
        auditType: body.auditType ?? "surveillance",
        standards: body.standards,
        address: body.address ?? "未提供"
      });

      response.json({ data: { checklist, totalItems: checklist.length } });
    } catch (error) { next(error); }
  });

  // 3. 不符合项识别 + 审核报告生成
  app.post("/api/auditor/report", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const body = (request.body ?? {}) as {
        customerName?: string;
        industry?: string;
        employeeCount?: number;
        auditType?: "initial" | "surveillance" | "recertification";
        standards?: Array<"iso9001" | "iso14001" | "iso45001">;
        address?: string;
        scheduledDate?: string;
        checklist?: Array<{
          clause: string;
          standard: string;
          department: string;
          question: string;
          result: "pass" | "ng_major" | "ng_minor" | "observation" | "pending";
          notes: string;
        }>;
      };

      if (!body.customerName || !body.checklist) {
        throw new ValidationError("客户名/检查表 必填");
      }

      const ngs = detectNonConformances(body.checklist as Array<{
        clause: string;
        standard: string;
        department: string;
        question: string;
        evidence: string;
        result: "pass" | "ng_major" | "ng_minor" | "observation" | "pending";
        notes: string;
      }>, "");

      // 判断结论
      const majorCount = ngs.filter(n => n.level === "major").length;
      const minorCount = ngs.filter(n => n.level === "minor").length;
      const conclusion: "recommend" | "recommend_with_action" | "not_recommend" =
        majorCount > 0 ? "not_recommend" :
        minorCount > 3 ? "recommend_with_action" : "recommend";

      const reportMd = generateAuditReport(
        body.customerName,
        {
          customerName: body.customerName,
          industry: body.industry ?? "未指定",
          employeeCount: body.employeeCount ?? 50,
          auditType: body.auditType ?? "surveillance",
          standards: body.standards ?? ["iso9001"],
          address: body.address ?? "未提供",
          scheduledDate: body.scheduledDate
        },
        ngs,
        conclusion
      );

      response.json({
        data: {
          nonConformances: ngs,
          report: reportMd,
          conclusion,
          summary: {
            total: ngs.length,
            major: majorCount,
            minor: minorCount,
            observation: ngs.filter(n => n.level === "observation").length
          }
        }
      });
    } catch (error) { next(error); }
  });

  // ============== 数字审核员 - 会话与附件 API ==============

  // 1. 创建审核会话
  app.post("/api/auditor/session", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const body = (request.body ?? {}) as {
        customerName?: string;
        industry?: string;
        employeeCount?: number;
        auditType?: "initial" | "surveillance" | "recertification";
        standards?: Array<"iso9001" | "iso14001" | "iso45001">;
        address?: string;
        contactPerson?: string;
        contactPhone?: string;
        scheduledDate?: string;
        checklist?: Array<{
          clause: string;
          standard: string;
          department: string;
          question: string;
          evidence: string;
          result?: string;
          notes?: string;
          sortOrder?: number;
        }>;
      };

      if (!body.customerName || !body.standards || body.standards.length === 0) {
        throw new ValidationError("客户名/标准 必填");
      }

      const sessionId = randomUUID();
      await query(
        `INSERT INTO audit_session
          (id, company_id, customer_name, industry, employee_count, audit_type, standards,
           address, contact_person, contact_phone, scheduled_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          sessionId, u.companyId, body.customerName,
          body.industry ?? null, body.employeeCount ?? null,
          body.auditType ?? "surveillance", body.standards,
          body.address ?? null, body.contactPerson ?? null,
          body.contactPhone ?? null, body.scheduledDate ?? null,
          u.id
        ]
      );

      if (body.checklist && body.checklist.length > 0) {
        for (let i = 0; i < body.checklist.length; i++) {
          const item = body.checklist[i];
          await query(
            `INSERT INTO audit_checklist_item
              (session_id, clause, standard, department, question, evidence, result, notes, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              sessionId, item.clause, item.standard, item.department,
              item.question, item.evidence,
              item.result ?? "pending", item.notes ?? "",
              item.sortOrder ?? i
            ]
          );
        }
      }

      response.status(201).json({ data: { sessionId, itemCount: body.checklist?.length ?? 0 } });
    } catch (error) { next(error); }
  });

  // 2. 更新单个 checklist 项
  app.patch("/api/auditor/item/:itemId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const body = (request.body ?? {}) as {
        result?: "pass" | "ng_major" | "ng_minor" | "observation" | "pending";
        notes?: string;
      };

      const r = await query(
        `UPDATE audit_checklist_item i
         SET result = COALESCE($2, result),
             notes = COALESCE($3, notes),
             updated_at = NOW()
         FROM audit_session s
         WHERE i.id = $1 AND i.session_id = s.id AND s.company_id = $4
         RETURNING i.id, i.result, i.notes`,
        [request.params.itemId, body.result ?? null, body.notes ?? null, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("检查项");
      response.json({ data: r.rows[0] });
    } catch (error) { next(error); }
  });

  // 3. 上传附件
  app.post("/api/auditor/item/:itemId/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请选择文件");

      const itemR = await query<{ session_id: string; company_id: string }>(
        `SELECT i.session_id, s.company_id FROM audit_checklist_item i
         JOIN audit_session s ON s.id = i.session_id
         WHERE i.id = $1 AND s.company_id = $2`,
        [request.params.itemId, u.companyId]
      );
      if (itemR.rows.length === 0) throw new NotFoundError("检查项");

      const { session_id, company_id } = itemR.rows[0];
      const attachmentId = randomUUID();
      const ext = path.extname(request.file.originalname).toLowerCase();
      const storedName = `${attachmentId}${ext}`;

      await fs.mkdir(config.uploadsDir, { recursive: true });
      await fs.writeFile(path.join(config.uploadsDir, storedName), request.file.buffer);

      await query(
        `INSERT INTO audit_attachment
          (id, company_id, session_id, item_id, original_name, stored_name, file_type, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          attachmentId, company_id, session_id, request.params.itemId,
          request.file.originalname, storedName,
          ext.slice(1).toLowerCase() || "bin",
          request.file.mimetype || "application/octet-stream",
          request.file.size, u.id
        ]
      );

      response.status(201).json({
        data: {
          id: attachmentId,
          originalName: request.file.originalname,
          sizeBytes: request.file.size,
          mimeType: request.file.mimetype,
          fileType: ext.slice(1).toLowerCase() || "bin",
          url: `/api/auditor/attachment/${attachmentId}`
        }
      });
    } catch (error) { next(error); }
  });

  // 4. 读取会话完整数据
  app.get("/api/auditor/session/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const sessionR = await query(
        `SELECT id, customer_name, industry, employee_count, audit_type, standards,
                address, contact_person, contact_phone, scheduled_date, created_at
         FROM audit_session WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (sessionR.rows.length === 0) throw new NotFoundError("审核会话");

      const itemsR = await query(
        `SELECT id, clause, standard, department, question, evidence, result, notes, sort_order
         FROM audit_checklist_item WHERE session_id = $1 ORDER BY sort_order`,
        [request.params.id]
      );

      const attachmentsR = await query(
        `SELECT id, item_id, original_name, file_type, size_bytes, mime_type, created_at
         FROM audit_attachment WHERE session_id = $1 ORDER BY created_at`,
        [request.params.id]
      );

      const attByItem: Record<string, any[]> = {};
      for (const att of attachmentsR.rows) {
        const key = att.item_id;
        if (!attByItem[key]) attByItem[key] = [];
        attByItem[key].push({ ...att, url: `/api/auditor/attachment/${att.id}` });
      }

      const items = itemsR.rows.map(item => ({
        ...item,
        attachments: attByItem[item.id] || []
      }));

      response.json({
        data: {
          session: sessionR.rows[0],
          items,
          attachmentCount: attachmentsR.rows.length
        }
      });
    } catch (error) { next(error); }
  });

  // 5. 下载附件
  app.get("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const r = await query<{ stored_name: string; original_name: string; mime_type: string }>(
        `SELECT stored_name, original_name, mime_type
         FROM audit_attachment WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");

      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      if (!fsSync.existsSync(filePath)) throw new NotFoundError("文件不存在");

      const stat = await fs.stat(filePath);
      response.setHeader("Content-Type", r.rows[0].mime_type || "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(r.rows[0].original_name)}`
      );
      fsSync.createReadStream(filePath).pipe(response);
    } catch (error) { next(error); }
  });

  // 6. 删除附件
  app.delete("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const r = await query<{ stored_name: string }>(
        `SELECT stored_name FROM audit_attachment
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");

      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      try { await fs.unlink(filePath); } catch { /* may already be deleted */ }

      await query(`DELETE FROM audit_attachment WHERE id = $1`, [request.params.id]);
      response.status(204).send();
    } catch (error) { next(error); }
  });

  // ============== 数字审核员 - 报告级附件 + YoooClaw 录音集成 ==============

  // 工具：判断文件分类
  function classifyFile(ext: string, mime: string): string {
    const e = ext.toLowerCase();
    const m = (mime || "").toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(e)) return "photo";
    if (["mp4", "mov", "avi", "webm", "mkv"].includes(e)) return "video";
    if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(e)) return "recording";
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md"].includes(e)) return "document";
    if (m.startsWith("image/")) return "photo";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "recording";
    return "other";
  }

  // 1. 列出会话的所有报告级附件
  app.get("/api/auditor/session/:id/report-attachments", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const sessionId = request.params.id;

      const r = await query<any>(
        `SELECT id, original_name, file_type, mime_type, size_bytes,
                category, source, yoooclaw_recording_id, duration_seconds,
                caption, created_at
         FROM audit_report_attachment
         WHERE session_id = $1 AND company_id = $2
         ORDER BY created_at DESC`,
        [sessionId, u.companyId]
      );

      const list = r.rows.map(a => ({
        id: a.id,
        original_name: a.original_name,
        file_type: a.file_type,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        category: a.category,
        source: a.source,
        yoooclaw_recording_id: a.yoooclaw_recording_id,
        duration_seconds: a.duration_seconds,
        caption: a.caption,
        created_at: a.created_at,
        url: `/api/auditor/report-attachment/${a.id}`
      }));

      // 统计
      const summary = {
        total: list.length,
        photo: list.filter((x: any) => x.category === "photo").length,
        recording: list.filter((x: any) => x.category === "recording").length,
        document: list.filter((x: any) => x.category === "document").length,
        video: list.filter((x: any) => x.category === "video").length,
        other: list.filter((x: any) => x.category === "other").length,
        yoooclaw: list.filter((x: any) => x.source === "yoooclaw_recording").length
      };

      response.json({ data: { items: list, summary } });
    } catch (error) { next(error); }
  });

  // 2. 上传报告级附件（手动）
  app.post("/api/auditor/session/:id/report-attachment/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请上传文件");

      const sessionId = request.params.id;
      const caption = (request.body?.caption as string) || "";
      const source = (request.body?.source as string) || "manual_upload";

      // 校验会话
      const sr = await query<{ customer_name: string }>(
        `SELECT customer_name FROM audit_session
         WHERE id = $1 AND company_id = $2`,
        [sessionId, u.companyId]
      );
      if (sr.rows.length === 0) throw new NotFoundError("审核会话");

      const originalName = request.file.originalname;
      const ext = path.extname(originalName).slice(1).toLowerCase() || "bin";
      const category = classifyFile(ext, request.file.mimetype);
      const storedName = `${sessionId}-rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = path.join(config.uploadsDir, storedName);

      await fs.mkdir(config.uploadsDir, { recursive: true });
      await fs.writeFile(filePath, request.file.buffer);

      const attachmentId = randomUUID();
      await query(
        `INSERT INTO audit_report_attachment
          (id, session_id, company_id, source, original_name, file_path,
           file_type, mime_type, size_bytes, category, caption, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [attachmentId, sessionId, u.companyId, source, originalName, storedName,
         ext, request.file.mimetype, request.file.size, category, caption || null,
         u.id]
      );

      response.status(201).json({
        data: {
          id: attachmentId,
          original_name: originalName,
          file_type: ext,
          mime_type: request.file.mimetype,
          size_bytes: request.file.size,
          category,
          source,
          url: `/api/auditor/report-attachment/${attachmentId}`
        }
      });
    } catch (error) { next(error); }
  });

  // 3. 下载报告级附件
  app.get("/api/auditor/report-attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const r = await query<any>(
        `SELECT file_path, original_name, mime_type FROM audit_report_attachment
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");

      const filePath = path.join(config.uploadsDir, r.rows[0].file_path);
      response.setHeader("Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(r.rows[0].original_name)}`);
      if (r.rows[0].mime_type) response.setHeader("Content-Type", r.rows[0].mime_type);
      response.sendFile(filePath);
    } catch (error) { next(error); }
  });

  // 4. 删除报告级附件
  app.delete("/api/auditor/report-attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const r = await query<{ file_path: string }>(
        `SELECT file_path FROM audit_report_attachment
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");

      const filePath = path.join(config.uploadsDir, r.rows[0].file_path);
      try { await fs.unlink(filePath); } catch { /* may already be deleted */ }
      await query(`DELETE FROM audit_report_attachment WHERE id = $1`, [request.params.id]);

      response.status(204).send();
    } catch (error) { next(error); }
  });

  // 5. 标记会话"附件就绪"（出报告前必须调用）
  app.post("/api/auditor/session/:id/attachments-ready", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");

      const { ready } = request.body || {};
      await query(
        `UPDATE audit_session SET attachments_ready = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [ready === true, request.params.id, u.companyId]
      );
      response.json({ data: { ready: ready === true } });
    } catch (error) { next(error); }
  });

  // 6. YoooClaw 录音：按手机号/客户名匹配会话
  app.post("/api/auditor/session/:id/import-yoooclaw", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const sessionId = request.params.id;

      // 校验会话 + 取客户电话（用于匹配）
      const sr = await query<{ customer_name: string; contact_phone: string | null }>(
        `SELECT customer_name, contact_phone FROM audit_session
         WHERE id = $1 AND company_id = $2`,
        [sessionId, u.companyId]
      );
      if (sr.rows.length === 0) throw new NotFoundError("审核会话");
      const session = sr.rows[0];

      // 列出 YoooClaw 录音（从镜像目录）
      const yoooBase = "/opt/ai-consulting-center/data/yoooclaw-mirror/recordings";
      let allRecordings: Array<{
        id: string;
        file: string;
        fullPath: string;
        title: string;
        customer_name?: string;
        contact_phone?: string;
        created_at: string;
        transcriptFile?: string;
      }> = [];

      try {
        const indexPath = path.join(yoooBase, "index.json");
        const indexContent = await fs.readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);
        const entries: any[] = Array.isArray(index.recordings) ? index.recordings : [];

        for (const entry of entries) {
          if (!entry || !entry.id || !entry.audioFile) continue;
          const audioFullPath = path.join(yoooBase, entry.audioFile);
          const id = String(entry.id);
          const file = path.basename(entry.audioFile);
          // 从 transcript-data/<id>.json 读客户元数据（如果有）
          let customer_name: string | undefined;
          let contact_phone: string | undefined;
          try {
            const tdPath = path.join(yoooBase, entry.transcriptDataFile || `transcript-data/${id}.json`);
            const tdContent = await fs.readFile(tdPath, "utf-8");
            const td = JSON.parse(tdContent);
            customer_name = td.customer_name || td.customerName || td.contact_name;
            contact_phone = td.contact_phone || td.contactPhone || td.phone;
          } catch { /* no transcript data */ }
          allRecordings.push({
            id,
            file,
            fullPath: audioFullPath,
            title: entry.title || entry.metadata?.name || file,
            customer_name,
            contact_phone,
            created_at: entry.metadata?.created_at || entry.ingestedAt || "",
            transcriptFile: entry.transcriptFile
          });
        }
      } catch (err) {
        return response.json({ data: { imported: 0, candidates: [], note: `YoooClaw 录音目录不存在: ${(err as Error).message}` } });
      }

      if (allRecordings.length === 0) {
        return response.json({ data: { imported: 0, candidates: [], note: "YoooClaw 录音目录为空" } });
      }

      // 匹配逻辑：客户名 OR 客户电话
      const candidates = allRecordings.filter(r => {
        if (session.contact_phone && r.contact_phone === session.contact_phone) return true;
        if (session.customer_name && r.customer_name &&
            r.customer_name.includes(session.customer_name.slice(0, 4))) return true;
        return false;
      });

      // 已同步的录音 ID（去重）
      const synced = await query<{ yoooclaw_recording_id: string }>(
        `SELECT yoooclaw_recording_id FROM audit_report_attachment
         WHERE session_id = $1 AND source = 'yoooclaw_recording'`,
        [sessionId]
      );
      const syncedIds = new Set(synced.rows.map(r => r.yoooclaw_recording_id));

      let imported = 0;
      for (const cand of candidates) {
        if (syncedIds.has(cand.id)) continue;
        const ext = path.extname(cand.file).slice(1).toLowerCase() || "audio";
        const storedName = `${sessionId}-yooo-${cand.id}-${Date.now()}.${ext}`;
        const src = cand.fullPath || path.join(yoooBase, "audio", cand.file);
        const dst = path.join(config.uploadsDir, storedName);

        try {
          await fs.copyFile(src, dst);
          const stat = await fs.stat(dst);
          const attachmentId = randomUUID();

          await query(
            `INSERT INTO audit_report_attachment
              (id, session_id, company_id, source, original_name, file_path,
               file_type, mime_type, size_bytes, category,
               yoooclaw_recording_id, uploaded_by_user_id)
             VALUES ($1,$2,$3,'yoooclaw_recording',$4,$5,$6,$7,$8,'recording',$9,$10)`,
            [attachmentId, sessionId, u.companyId, cand.file, storedName,
             ext, "audio/" + ext, stat.size, cand.id, u.id]
          );

          // 记录同步日志
          await query(
            `INSERT INTO yoooclaw_sync_log (recording_id, file_path, status, matched_session_id, matched_at)
             VALUES ($1, $2, 'matched', $3, NOW())
             ON CONFLICT (recording_id) DO UPDATE
               SET status = 'matched', matched_session_id = $3, matched_at = NOW()`,
            [cand.id, storedName, sessionId]
          );
          imported++;
        } catch (e: any) {
          console.warn(`[yoooclaw] import failed: ${cand.id}`, e.message);
        }
      }

      response.json({
        data: {
          imported,
          candidates: candidates.map(c => ({
            id: c.id,
            file: c.file,
            customer_name: c.customer_name,
            contact_phone: c.contact_phone,
            already_imported: syncedIds.has(c.id)
          }))
        }
      });
    } catch (error) { next(error); }
  });

  // ============== 数字审核员 - 会话与附件 API ==============
  // 1. 创建审核会话
  app.post("/api/auditor/session", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const body = (request.body ?? {}) as any;
      if (!body.customerName || !body.standards || body.standards.length === 0) {
        throw new ValidationError("客户名/标准 必填");
      }
      const sessionId = randomUUID();
      await query(
        `INSERT INTO audit_session
          (id, company_id, customer_name, industry, employee_count, audit_type, standards,
           address, contact_person, contact_phone, scheduled_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [sessionId, u.companyId, body.customerName, body.industry ?? null,
         body.employeeCount ?? null, body.auditType ?? "surveillance", body.standards,
         body.address ?? null, body.contactPerson ?? null, body.contactPhone ?? null,
         body.scheduledDate ?? null, u.id]
      );
      if (body.checklist && body.checklist.length > 0) {
        for (let i = 0; i < body.checklist.length; i++) {
          const item = body.checklist[i];
          await query(
            `INSERT INTO audit_checklist_item
              (session_id, clause, standard, department, question, evidence, result, notes, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [sessionId, item.clause, item.standard, item.department,
             item.question, item.evidence, item.result ?? "pending", item.notes ?? "", i]
          );
        }
      }
      response.status(201).json({ data: { sessionId, itemCount: body.checklist?.length ?? 0 } });
    } catch (error) { next(error); }
  });

  // 2. 更新检查项
  app.patch("/api/auditor/item/:itemId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const body = (request.body ?? {}) as any;
      const r = await query(
        `UPDATE audit_checklist_item i SET result = COALESCE($2, result),
          notes = COALESCE($3, notes), updated_at = NOW()
         FROM audit_session s WHERE i.id = $1 AND i.session_id = s.id AND s.company_id = $4
         RETURNING i.id, i.result, i.notes`,
        [request.params.itemId, body.result ?? null, body.notes ?? null, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("检查项");
      response.json({ data: r.rows[0] });
    } catch (error) { next(error); }
  });

  // 3. 上传附件
  app.post("/api/auditor/item/:itemId/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请选择文件");
      const itemR = await query<{ session_id: string; company_id: string }>(
        `SELECT i.session_id, s.company_id FROM audit_checklist_item i
         JOIN audit_session s ON s.id = i.session_id
         WHERE i.id = $1 AND s.company_id = $2`,
        [request.params.itemId, u.companyId]
      );
      if (itemR.rows.length === 0) throw new NotFoundError("检查项");
      const { session_id, company_id } = itemR.rows[0];
      const attachmentId = randomUUID();
      const ext = path.extname(request.file.originalname).toLowerCase();
      const storedName = `${attachmentId}${ext}`;
      await fs.mkdir(config.uploadsDir, { recursive: true });
      await fs.writeFile(path.join(config.uploadsDir, storedName), request.file.buffer);
      await query(
        `INSERT INTO audit_attachment
          (id, company_id, session_id, item_id, original_name, stored_name, file_type, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [attachmentId, company_id, session_id, request.params.itemId,
         request.file.originalname, storedName, ext.slice(1).toLowerCase() || "bin",
         request.file.mimetype || "application/octet-stream", request.file.size, u.id]
      );
      response.status(201).json({
        data: {
          id: attachmentId,
          originalName: request.file.originalname,
          sizeBytes: request.file.size,
          mimeType: request.file.mimetype,
          fileType: ext.slice(1).toLowerCase() || "bin",
          url: `/api/auditor/attachment/${attachmentId}`
        }
      });
    } catch (error) { next(error); }
  });

  // 4. 读取会话完整
  app.get("/api/auditor/session/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const sessionR = await query(
        `SELECT id, customer_name, industry, employee_count, audit_type, standards,
                address, contact_person, contact_phone, scheduled_date, created_at
         FROM audit_session WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (sessionR.rows.length === 0) throw new NotFoundError("审核会话");
      const itemsR = await query(
        `SELECT id, clause, standard, department, question, evidence, result, notes, sort_order
         FROM audit_checklist_item WHERE session_id = $1 ORDER BY sort_order`,
        [request.params.id]
      );
      const attachmentsR = await query(
        `SELECT id, item_id, original_name, file_type, size_bytes, mime_type, created_at
         FROM audit_attachment WHERE session_id = $1 ORDER BY created_at`,
        [request.params.id]
      );
      const attByItem: Record<string, any[]> = {};
      for (const att of attachmentsR.rows) {
        if (!attByItem[att.item_id]) attByItem[att.item_id] = [];
        attByItem[att.item_id].push({ ...att, url: `/api/auditor/attachment/${att.id}` });
      }
      const items = itemsR.rows.map(item => ({ ...item, attachments: attByItem[item.id] || [] }));
      response.json({
        data: {
          session: sessionR.rows[0],
          items,
          attachmentCount: attachmentsR.rows.length
        }
      });
    } catch (error) { next(error); }
  });

  // 5. 下载附件
  app.get("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const r = await query<{ stored_name: string; original_name: string; mime_type: string }>(
        `SELECT stored_name, original_name, mime_type FROM audit_attachment
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");
      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      if (!fsSync.existsSync(filePath)) throw new NotFoundError("文件不存在");
      const stat = await fs.stat(filePath);
      response.setHeader("Content-Type", r.rows[0].mime_type || "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(r.rows[0].original_name)}`
      );
      fsSync.createReadStream(filePath).pipe(response);
    } catch (error) { next(error); }
  });

  // 6. 删除附件
  app.delete("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const r = await query<{ stored_name: string }>(
        `SELECT stored_name FROM audit_attachment WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");
      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      try { await fs.unlink(filePath); } catch { /* */ }
      await query(`DELETE FROM audit_attachment WHERE id = $1`, [request.params.id]);
      response.status(204).send();
    } catch (error) { next(error); }
  });
  // … 会话与附件 API
  app.post("/api/auditor/session", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const body = (request.body ?? {}) as any;
      if (!body.customerName || !body.standards || body.standards.length === 0) {
        throw new ValidationError("客户名/标准 必填");
      }
      const sessionId = randomUUID();
      await query(
        `INSERT INTO audit_session (id, company_id, customer_name, industry, employee_count, audit_type, standards, address, contact_person, contact_phone, scheduled_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [sessionId, u.companyId, body.customerName, body.industry ?? null, body.employeeCount ?? null, body.auditType ?? "surveillance", body.standards, body.address ?? null, body.contactPerson ?? null, body.contactPhone ?? null, body.scheduledDate ?? null, u.id]
      );
      if (body.checklist && body.checklist.length > 0) {
        for (let i = 0; i < body.checklist.length; i++) {
          const item = body.checklist[i];
          await query(
            `INSERT INTO audit_checklist_item (session_id, clause, standard, department, question, evidence, result, notes, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [sessionId, item.clause, item.standard, item.department, item.question, item.evidence, item.result ?? "pending", item.notes ?? "", i]
          );
        }
      }
      response.status(201).json({ data: { sessionId, itemCount: body.checklist?.length ?? 0 } });
    } catch (error) { next(error); }
  });

  app.patch("/api/auditor/item/:itemId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const body = (request.body ?? {}) as any;
      const r = await query(
        `UPDATE audit_checklist_item i SET result = COALESCE($2, result), notes = COALESCE($3, notes), updated_at = NOW() FROM audit_session s WHERE i.id = $1 AND i.session_id = s.id AND s.company_id = $4 RETURNING i.id, i.result, i.notes`,
        [request.params.itemId, body.result ?? null, body.notes ?? null, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("检查项");
      response.json({ data: r.rows[0] });
    } catch (error) { next(error); }
  });

  app.post("/api/auditor/item/:itemId/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请选择文件");
      const itemR = await query<{ session_id: string; company_id: string }>(
        `SELECT i.session_id, s.company_id FROM audit_checklist_item i JOIN audit_session s ON s.id = i.session_id WHERE i.id = $1 AND s.company_id = $2`,
        [request.params.itemId, u.companyId]
      );
      if (itemR.rows.length === 0) throw new NotFoundError("检查项");
      const { session_id, company_id } = itemR.rows[0];
      const attachmentId = randomUUID();
      const ext = path.extname(request.file.originalname).toLowerCase();
      const storedName = `${attachmentId}${ext}`;
      await fs.mkdir(config.uploadsDir, { recursive: true });
      await fs.writeFile(path.join(config.uploadsDir, storedName), request.file.buffer);
      await query(
        `INSERT INTO audit_attachment (id, company_id, session_id, item_id, original_name, stored_name, file_type, mime_type, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [attachmentId, company_id, session_id, request.params.itemId, request.file.originalname, storedName, ext.slice(1).toLowerCase() || "bin", request.file.mimetype || "application/octet-stream", request.file.size, u.id]
      );
      response.status(201).json({ data: { id: attachmentId, originalName: request.file.originalname, sizeBytes: request.file.size, mimeType: request.file.mimetype, fileType: ext.slice(1).toLowerCase() || "bin", url: `/api/auditor/attachment/${attachmentId}` } });
    } catch (error) { next(error); }
  });

  app.get("/api/auditor/session/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const sessionR = await query(
        `SELECT id, customer_name, industry, employee_count, audit_type, standards, address, contact_person, contact_phone, scheduled_date, created_at FROM audit_session WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (sessionR.rows.length === 0) throw new NotFoundError("审核会话");
      const itemsR = await query(
        `SELECT id, clause, standard, department, question, evidence, result, notes, sort_order FROM audit_checklist_item WHERE session_id = $1 ORDER BY sort_order`,
        [request.params.id]
      );
      const attachmentsR = await query(
        `SELECT id, item_id, original_name, file_type, size_bytes, mime_type, created_at FROM audit_attachment WHERE session_id = $1 ORDER BY created_at`,
        [request.params.id]
      );
      const attByItem: Record<string, any[]> = {};
      for (const att of attachmentsR.rows) {
        if (!attByItem[att.item_id]) attByItem[att.item_id] = [];
        attByItem[att.item_id].push({ ...att, url: `/api/auditor/attachment/${att.id}` });
      }
      const items = itemsR.rows.map(item => ({ ...item, attachments: attByItem[item.id] || [] }));
      response.json({ data: { session: sessionR.rows[0], items, attachmentCount: attachmentsR.rows.length } });
    } catch (error) { next(error); }
  });

  app.get("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const r = await query<{ stored_name: string; original_name: string; mime_type: string }>(
        `SELECT stored_name, original_name, mime_type FROM audit_attachment WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");
      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      if (!fsSync.existsSync(filePath)) throw new NotFoundError("文件不存在");
      const stat = await fs.stat(filePath);
      response.setHeader("Content-Type", r.rows[0].mime_type || "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(r.rows[0].original_name)}`);
      fsSync.createReadStream(filePath).pipe(response);
    } catch (error) { next(error); }
  });

  app.delete("/api/auditor/attachment/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const r = await query<{ stored_name: string }>(
        `SELECT stored_name FROM audit_attachment WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("附件");
      const filePath = path.join(config.uploadsDir, r.rows[0].stored_name);
      try { await fs.unlink(filePath); } catch { /* */ }
      await query(`DELETE FROM audit_attachment WHERE id = $1`, [request.params.id]);
      response.status(204).send();
    } catch (error) { next(error); }
  });

  

  
  app.get("/api/knowledge", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await knowledgeRepository.list(u.companyId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/knowledge", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以上传知识");
      if (!request.file) throw new ValidationError("请选择需要入库的文件");
      const content = (await extractDocumentText(request.file)).trim();
      if (!content) throw new ValidationError("文件中没有提取到可用文本");
      const category = String(request.body.category ?? "").trim();
      if (!category) throw new ValidationError("请选择知识分类");
      const id = randomUUID();
      await fs.mkdir(config.uploadsDir, { recursive: true });
      const storedName = `${id}${path.extname(request.file.originalname)}`;
      await fs.writeFile(path.join(config.uploadsDir, storedName), request.file.buffer);
      const item = await knowledgeRepository.add(u.companyId, {
        id,
        title: String(request.body.title || request.file.originalname).trim(),
        category,
        sourceName: request.file.originalname,
        fileType: path.extname(request.file.originalname).slice(1).toLowerCase(),
        content: content.slice(0, 100_000),
        createdAt: new Date().toISOString(),
        tags: String(request.body.tags ?? "")
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      });
      response.status(201).json({ data: item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/knowledge/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以删除知识");
      if (!(await knowledgeRepository.remove(u.companyId, request.params.id))) {
        throw new NotFoundError("知识条目");
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/consultations", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await consultationService.list(u.companyId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/consultations", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = consultationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "请求参数无效");
      }
      response.status(201).json({ data: await consultationService.create(u.companyId, u.id, parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  // ====== 认证专家：报价 API ======
  app.get("/api/certification/options", (_request, response) => {
    response.json({
      data: {
        industries: INDUSTRY_OPTIONS,
        riskLevels: RISK_LEVEL_OPTIONS,
        certifications: getAvailableCertifications()
      }
    });
  });

  app.post("/api/certification/quote", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = z
        .object({
          companyName: z.string().trim().min(1, "请填写企业名称").max(100),
          industry: z.string().trim().min(1, "请选择企业类型"),
          employeeCount: z.number().int().min(1, "人数必须 ≥ 1").max(100000),
          certifications: z.array(z.string().trim().min(1)).min(1, "至少选择一项认证"),
          riskLevel: z.enum(["medium", "high"]).default("medium")
        })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "请求参数无效");
      }
      const result = await generateQuote(parsed.data);
      // 持久化到 DB（DB 不可用时 fallback 到 JSON 文件）
      let quoteId: string | undefined;
      try {
        const rec = await quoteRepository.save(u.companyId, u.id, parsed.data, result);
        quoteId = rec.id;
      } catch (err) {
        console.warn("Quote save failed (non-fatal):", (err as Error).message);
      }
      response.json({ data: result, quoteId });
    } catch (error) {
      next(error);
    }
  });

  // 知识库向量检索（基于分块的 embedding 相似度）
  app.post("/api/knowledge/search", async (request, response, next) => {
    try {
      const { query: q, limit = 5, threshold = 0.5 } = request.body || {};
      if (!q || typeof q !== "string" || q.length < 2) {
        throw new ValidationError("请输入查询文本（至少 2 字）");
      }
      // 用真向量服务（BGE-base-zh-v1.5 768维）
      const emb = await import("./knowledge/embedding.js");
      const queryVec = await emb.fakeEmbeddingText(q, 768);
      const vecStr = "[" + queryVec.map(v => v.toFixed(4)).join(",") + "]";
      const r = await query<{
        chunk_id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        title: string;
        doc_code: string;
        category: string;
        distance: number;
      }>(
        `SELECT kc.id AS chunk_id, kc.document_id, kc.chunk_index,
                kc.content, kd.title, kd.doc_code, kd.category,
                kc.embedding <=> $2::vector AS distance
         FROM knowledge_chunk kc
         JOIN knowledge_document kd ON kc.document_id = kd.id
         WHERE kd.company_id = $1 AND kd.deleted_at IS NULL AND kd.status = 'active'
           AND kc.embedding <=> $2::vector < $3
         ORDER BY distance ASC
         LIMIT $4`,
        [getUserFromReq(request).companyId, vecStr, threshold, limit]
      );
      response.json({
        data: r.rows.map((row, i) => ({
          rank: i + 1,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          title: row.title,
          category: row.category,
          preview: row.content.slice(0, 200),
          distance: row.distance
        }))
      });
    } catch (error) {
      console.error("[knowledge/search] error:", (error as Error).message);
      next(error);
    }
  });

  // 历史报价列表
  app.get("/api/certification/quotes", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await quoteRepository.list(u.companyId) });
    } catch (error) {
      next(error);
    }
  });

  // 客户列表
  app.get("/api/customers", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const industry = (request.query.industry as string) || "";
      const status = (request.query.status as string) || "";
      const serviceStage = (request.query.service_stage as string) || "";
      const tags = (request.query.tags as string) || "";

      const result = await customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        industry,
        status,
        serviceStage,
        tags: tags ? tags.split(",").filter(Boolean) : [],
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) {
      next(error);
    }
  });

  // 轻量客户名列表（用于 AI 扫描客户名匹配）
  app.get("/api/customers/names", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query<{ id: string; name: string }>(
        "SELECT id, name FROM customer WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name",
        [u.companyId]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 导出客户为 CSV
  app.get("/api/customers/export.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const industry = (request.query.industry as string) || "";
      const status = (request.query.status as string) || "";
      const serviceStage = (request.query.service_stage as string) || "";
      const tags = (request.query.tags as string) || "";

      // 用 searchAdvanced，但 limit 提到最大
      const result = await customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        industry,
        status,
        serviceStage,
        tags: tags ? tags.split(",").filter(Boolean) : [],
        offset: 0,
        limit: 10000
      });

      // 生成 CSV (BOM + UTF-8)
      const headers = [
        "客户编号", "客户名称", "行业", "规模", "地区", "联系人",
        "电话", "邮箱", "信用代码", "业务范围", "服务阶段", "状态",
        "来源", "来源渠道", "标签", "累计营收", "服务次数",
        "首次服务", "最近服务", "满意度", "备注", "创建时间"
      ];
      const esc = (v: any) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        // 转义 CSV 特殊字符
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };
      const rows = result.items.map((c: any) => [
        c.customer_code,
        c.name,
        c.industry,
        c.scale,
        c.region,
        c.contact_person,
        c.contact_phone,
        c.contact_email,
        c.credit_code,
        c.business_scope,
        c.service_stage,
        c.status,
        c.source,
        c.source_channel,
        Array.isArray(c.tags) ? c.tags.join("; ") : "",
        c.total_revenue ?? "",
        c.service_count ?? "",
        c.first_service_at,
        c.last_service_at,
        c.satisfaction_score,
        c.notes,
        c.created_at
      ]);
      const csv = [
        "\uFEFF" + headers.map(esc).join(","),
        ...rows.map(row => row.map(esc).join(","))
      ].join("\r\n");

      const filename = `客户列表_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });

  // 客户详情（含跟进统计）
  app.get("/api/customers/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const customer = await customerRepository.getById(u.companyId, id);
      if (!customer) throw new NotFoundError("客户不存在");

      // 跟进统计
      const statsRes = await query<{
        total_sessions: string;
        active_sessions: string;
        last_session_date: Date | null;
      }>(
        `SELECT
          COUNT(*) AS total_sessions,
          COUNT(*) FILTER (WHERE attachments_ready = false) AS active_sessions,
          MAX(created_at) AS last_session_date
         FROM audit_session
         WHERE company_id = $1 AND customer_name = $2`,
        [u.companyId, customer.name]
      );

      // 报价统计
      const quoteStatsRes = await query<{
        total_quotes: string;
        total_amount: number | null;
      }>(
        `SELECT
          COUNT(*) AS total_quotes,
          SUM(total) AS total_amount
         FROM quote
         WHERE customer_id = $1 AND deleted_at IS NULL`,
        [id]
      );

      response.json({
        data: {
          ...customer,
          audit_stats: statsRes.rows[0] || { total_sessions: 0, active_sessions: 0, last_session_date: null },
          quote_stats: quoteStatsRes.rows[0] || { total_quotes: 0, total_amount: 0 }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 创建客户
  app.post("/api/customers", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以维护客户资料");
      const parsed = z
        .object({
          customerCode: z.string().trim().min(1).max(50),
          name: z.string().trim().min(1).max(200),
          industry: z.string().trim().max(100).optional(),
          employeeCount: z.number().int().optional(),
          region: z.string().trim().max(100).optional(),
          contactPerson: z.string().trim().max(100).optional(),
          contactPhone: z.string().trim().max(50).optional(),
          tags: z.array(z.string()).optional(),
          status: z.string().default("active")
        })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
      }
      const created = await customerRepository.create(u.companyId, {
        ...parsed.data,
        industry: parsed.data.industry ?? null,
        employeeCount: parsed.data.employeeCount ?? null,
        region: parsed.data.region ?? null,
        contactPerson: parsed.data.contactPerson ?? null,
        contactPhone: parsed.data.contactPhone ?? null,
        tags: parsed.data.tags ?? []
      });
      response.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/customers/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const body = request.body as Record<string, unknown>;
      if (!body || typeof body !== "object") throw new ValidationError("请求体不能为空");

      // 提取允许的字段
      const allowedKeys = [
        "name", "customerCode", "industry", "employeeCount", "region", "address",
        "contactPerson", "contactPhone", "contactEmail", "source", "notes",
        "creditCode", "scale", "sourceChannel", "serviceStage", "businessScope",
        "status", "tags", "satisfactionScore"
      ];
      const update: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (key in body) update[key] = body[key];
      }

      const updated = await customerRepository.update(u.companyId, id, update);
      if (!updated) throw new NotFoundError("客户");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  app.delete("/api/customers/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const ok = await customerRepository.softDelete(u.companyId, id);
      if (!ok) throw new NotFoundError("客户");
      response.json({ data: { id, deleted: true } });
    } catch (error) { next(error); }
  });

  // ============== 财务管理 ==============

  // ----- 项目 CRUD -----
  app.get("/api/finance/projects", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const result = await financeRepository.listProjects(u.companyId, {
        q: (request.query.q as string) || "",
        status: (request.query.status as string) || "",
        customerId: (request.query.customer_id as string) || "",
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) { next(error); }
  });

  app.post("/api/finance/projects", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body || !body.name) throw new ValidationError("项目名称不能为空");
      const created = await financeRepository.createProject(u.companyId, {
        customerId: (body.customerId as string) || null,
        projectCode: (body.projectCode as string) || "",
        name: body.name as string,
        certificationType: (body.certificationType as string) || null,
        serviceType: (body.serviceType as string) || null,
        contractAmount: Number(body.contractAmount) || 0,
        status: (body.status as string) || "draft",
        signedAt: (body.signedAt as string) || null,
        startedAt: (body.startedAt as string) || null,
        completedAt: (body.completedAt as string) || null,
        deadlineAt: (body.deadlineAt as string) || null,
        notes: (body.notes as string) || null,
        ownerUserId: (body.ownerUserId as string) || u.id,
        tags: (body.tags as string[]) || []
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  app.get("/api/finance/projects/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const project = await financeRepository.getProject(u.companyId, request.params.id);
      if (!project) throw new NotFoundError("项目");
      response.json({ data: project });
    } catch (error) { next(error); }
  });

  app.patch("/api/finance/projects/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const allowedKeys = [
        "customerId", "projectCode", "name", "certificationType", "serviceType",
        "contractAmount", "status", "signedAt", "startedAt", "completedAt",
        "deadlineAt", "notes", "ownerUserId", "tags"
      ];
      const update: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in body) update[k] = body[k];
      }
      const updated = await financeRepository.updateProject(u.companyId, request.params.id, update);
      if (!updated) throw new NotFoundError("项目");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  app.delete("/api/finance/projects/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ok = await financeRepository.deleteProject(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("项目");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // ----- 交易流水 CRUD -----
  app.get("/api/finance/transactions", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const result = await financeRepository.listTransactions(u.companyId, {
        type: request.query.type as "income" | "expense" | undefined,
        category: (request.query.category as string) || "",
        projectId: (request.query.project_id as string) || "",
        customerId: (request.query.customer_id as string) || "",
        startDate: (request.query.start_date as string) || "",
        endDate: (request.query.end_date as string) || "",
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) { next(error); }
  });

  app.post("/api/finance/transactions", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.type || !["income", "expense"].includes(body.type as string)) {
        throw new ValidationError("type 必须是 income 或 expense");
      }
      if (!body.amount || isNaN(Number(body.amount))) {
        throw new ValidationError("金额不能为空");
      }
      const created = await financeRepository.createTransaction(u.companyId, {
        projectId: (body.projectId as string) || null,
        customerId: (body.customerId as string) || null,
        type: body.type as "income" | "expense",
        category: (body.category as string) || "其他",
        amount: Number(body.amount),
        transDate: (body.transDate as string) || new Date().toISOString(),
        description: (body.description as string) || null,
        paymentMethod: (body.paymentMethod as string) || null,
        reference: (body.reference as string) || null,
        ps: (body.ps as string) || null,
        invoiceNo: (body.invoiceNo as string) || null
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  app.patch("/api/finance/transactions/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const allowedKeys = [
        "projectId", "customerId", "type", "category", "amount",
        "transDate", "description", "paymentMethod", "reference", "ps", "invoiceNo"
      ];
      const update: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in body) update[k] = body[k];
      }
      const updated = await financeRepository.updateTransaction(u.companyId, request.params.id, update);
      if (!updated) throw new NotFoundError("交易");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  app.delete("/api/finance/transactions/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ok = await financeRepository.deleteTransaction(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("交易");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // ----- 财务统计 -----
  app.get("/api/finance/summary", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const result = await financeRepository.getSummary(u.companyId, {
        startDate: (request.query.start_date as string) || "",
        endDate: (request.query.end_date as string) || ""
      });
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // ============== 客户跟进 (Follow-up) ==============

  // 阶段字典
  app.get("/api/follow-up/stages", async (_request, response, next) => {
    try {
      response.json({ data: FOLLOW_UP_STAGES });
    } catch (error) { next(error); }
  });

  // 出证机构字典
  app.get("/api/follow-up/issuing-bodies", async (_request, response, next) => {
    try {
      response.json({ data: ISSUING_BODIES });
    } catch (error) { next(error); }
  });

  // 按出证机构聚合统计
  app.get("/api/follow-up/stats/by-issuing-body", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const year = request.query.year ? parseInt(request.query.year as string, 10) : undefined;
      const result = await followUpRepository.getStatsByIssuingBody(u.companyId, year);
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // 列表
  app.get("/api/follow-up", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const result = await followUpRepository.listFollowUps(u.companyId, {
        customerId: (request.query.customer_id as string) || "",
        stage: (request.query.stage as string) || "",
        year: request.query.year ? parseInt(request.query.year as string, 10) : undefined,
        isArchived: request.query.archived === "1" || request.query.archived === "true"
                       ? true : (request.query.archived === "0" ? false : undefined),
        issuingBody: (request.query.issuing_body as string) || undefined,
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total, totalAll: result.totalAll });
    } catch (error) { next(error); }
  });

  // 详情
  app.get("/api/follow-up/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const fu = await followUpRepository.getFollowUp(u.companyId, request.params.id);
      if (!fu) throw new NotFoundError("跟进记录");
      const logs = await followUpRepository.getFollowUpLogs(u.companyId, request.params.id);
      response.json({ data: { ...fu, logs } });
    } catch (error) { next(error); }
  });

  // 获取客户历史认证类型（自动建议）
  // 返回：
  // - 从 finance_project.name 解析的认证项目（如 "QES监督一"）
  // - 从 customer_follow_up.certification_type 字段
  // - 系统常用类型
  app.get("/api/follow-up/customer-types/:customerId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);

      // 1. 从 finance_project.name 解析（"客户名 | 描述"）
      const projectNames = await query<{ name: string }>(
        `SELECT name FROM finance_project
         WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
        [u.companyId, request.params.customerId]
      );

      // 2. 从 customer_follow_up.certification_type
      const fuTypes = await query<{ certification_type: string }>(
        `SELECT DISTINCT certification_type FROM customer_follow_up
         WHERE company_id = $1 AND customer_id = $2
           AND deleted_at IS NULL AND certification_type IS NOT NULL`,
        [u.companyId, request.params.customerId]
      );

      // 解析：取 "|" 后部分，去重
      const suggestions = new Set<string>();
      // 系统常用
      const commonTypes = ["QES", "Q", "E", "S", "27001", "14001", "45001", "HACCP", "50430"];
      commonTypes.forEach(t => suggestions.add(t));
      // 跟进表的认证类型
      fuTypes.rows.forEach(r => {
        if (r.certification_type) suggestions.add(r.certification_type.trim());
      });
      // 项目名称解析
      projectNames.rows.forEach(r => {
        const name = r.name;
        if (!name) return;
        // "客户名 | 描述" 格式
        const parts = name.split("|");
        if (parts.length > 1) {
          const desc = parts[1].trim();
          // 提取"QES监督一" → 加 "QES监督一" + "QES"
          if (desc) suggestions.add(desc);
          // 提取开头的字母 + 数字组合
          const prefixMatch = desc.match(/^([A-Z]+)/);
          if (prefixMatch) suggestions.add(prefixMatch[1]);
        }
      });

      response.json({
        data: Array.from(suggestions).sort()
      });
    } catch (error) { next(error); }
  });

  // 列出审核计划模板
  app.get("/api/audit-templates", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const templates = await listAuditTemplates(u.companyId);
      response.json({ data: templates });
    } catch (error) { next(error); }
  });

  // 根据跟进 ID 找审核计划
  app.get("/api/follow-up/:id/audit-plan", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query<any>(
        `SELECT s.*, count(i.id) AS item_count
         FROM audit_session s
         LEFT JOIN audit_checklist_item i ON i.session_id = s.id
         WHERE s.follow_up_id = $1 AND s.company_id = $2
         GROUP BY s.id`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 创建
  app.post("/api/follow-up", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.customerId) throw new ValidationError("客户必填");
      const created = await followUpRepository.createFollowUp(u.companyId, {
        customerId: body.customerId as string,
        projectId: (body.projectId as string) || null,
        certificationType: (body.certificationType as string) || null,
        stage: (body.stage as string) || "expired",
        year: body.year ? Number(body.year) : new Date().getFullYear(),
        expectedDate: (body.expectedDate as string) || null,
        expectedAmount: body.expectedAmount ? Number(body.expectedAmount) : null,
        contractAmount: body.contractAmount ? Number(body.contractAmount) : null,
        notes: (body.notes as string) || null,
        metadata: body.metadata || null,
        ownerUserId: (body.ownerUserId as string) || u.id
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  // 更新基础信息
  app.patch("/api/follow-up/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const allowedKeys = ["projectId", "certificationType", "year", "expectedDate", "expectedAmount", "contractAmount", "notes", "metadata", "ownerUserId"];
      const update: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in body) update[k] = body[k];
      }
      const updated = await followUpRepository.updateFollowUp(u.companyId, request.params.id, update);
      if (!updated) throw new NotFoundError("跟进记录");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  // 推进阶段
  app.post("/api/follow-up/:id/advance", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.stage) throw new ValidationError("目标阶段必填");
      const updated = await followUpRepository.advanceStage(
        u.companyId,
        request.params.id,
        body.stage as string,
        (body.notes as string) || null,
        u.id
      );
      if (!updated) throw new NotFoundError("跟进记录");

      // 🎯 自动生成审核计划：当推进到"项目实施"阶段时
      let auditPlan = null;
      if ((body.stage as string) === "implementing") {
        try {
          const cert = updated.certificationType || "QES";
            // 标准映射
            const stdMap: Record<string, string[]> = {
              "QES": ["iso9001","iso14001","iso45001"],
              "Q":   ["iso9001"],
              "E":   ["iso14001"],
              "S":   ["iso45001"],
              "27001": ["iso27001"],
              "14001": ["iso14001"],
              "45001": ["iso45001"],
            };
            const standards = stdMap[cert] || stdMap["QES"];
            auditPlan = await autoGenerateAuditPlan({
              followUpId: request.params.id,
              companyId: u.companyId,
              customerName: updated.customerName || "(未知客户)",
              industry: undefined,
              employeeCount: undefined,
              auditType: "initial",
              standards,
              certificationType: cert,
              createdBy: u.id
            });
            console.log(
              `[auto-audit] follow_up=${request.params.id} → session=${auditPlan.sessionId} ` +
              `(template=${auditPlan.templateCode}, items=${auditPlan.itemCount}, existed=${auditPlan.alreadyExisted})`
            );
        } catch (e) {
          console.warn("[auto-audit] failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }

      response.json({ data: updated, auditPlan });
    } catch (error) { next(error); }
  });

  // 关闭跟进（必须填写原因）
  app.post("/api/follow-up/:id/close", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const reason = (body.closeReason as string || "").trim();
      const notes = (body.closeNotes as string || "").trim();

      if (!reason) throw new ValidationError("关闭原因必填");
      if (!notes) throw new ValidationError("详细说明必填");

      // 有效原因
      const validReasons = [
        "certified_and_delivered",
        "customer_declined",
        "price_too_high",
        "unable_to_contact",
        "customer_lost",
        "competitor_chosen",
        "duplicate",
        "other"
      ];
      if (!validReasons.includes(reason)) {
        throw new ValidationError(`关闭原因必须是以下之一：${validReasons.join(", ")}`);
      }

      const updated = await query<any>(
        `UPDATE customer_follow_up
         SET stage = 'completed',
             is_archived = true,
             archived_at = NOW(),
             close_reason = $1,
             closed_at = NOW(),
             closed_by = $2,
             notes = COALESCE(notes || ' / ', '') || $3,
             updated_at = NOW()
         WHERE company_id = $4 AND id = $5 AND deleted_at IS NULL
         RETURNING *`,
        [reason, u.id, `关闭原因(${reason}): ${notes}`, u.companyId, request.params.id]
      );
      if (updated.rows.length === 0) throw new NotFoundError("跟进记录");

      response.json({ data: updated.rows[0] });
    } catch (error) { next(error); }
  });

  // 删除
  app.delete("/api/follow-up/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ok = await followUpRepository.deleteFollowUp(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("跟进记录");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // 年度归档
  app.post("/api/follow-up/archive-year/:year", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const year = parseInt(request.params.year, 10);
      const count = await followUpRepository.archiveYear(u.companyId, year);
      response.json({ data: { year, archived_count: count } });
    } catch (error) { next(error); }
  });

  // 为客户在某年自动创建跟进
  app.post("/api/follow-up/ensure-for-customer", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.customerId) throw new ValidationError("客户必填");
      const year = body.year ? Number(body.year) : new Date().getFullYear();
      const created = await followUpRepository.ensureCustomerForForYear(
        u.companyId,
        body.customerId as string,
        year,
        {
          certificationType: (body.certificationType as string) || null,
          expectedDate: (body.expectedDate as string) || null,
          issuingBody: (body.issuingBody as string) || "zhongren"
        }
      );
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  // 批量为客户在某年创建跟进（客户 ID 数组）
  app.post("/api/follow-up/batch-ensure", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const customerIds = (body.customerIds as string[]) || [];
      if (customerIds.length === 0) throw new ValidationError("请选择至少一个客户");
      const year = body.year ? Number(body.year) : new Date().getFullYear();
      const certificationType = (body.certificationType as string) || null;
      const issuingBody = (body.issuingBody as string) || "zhongren";

      const created: any[] = [];
      const skipped: string[] = [];

      for (const cid of customerIds) {
        try {
          const fu = await followUpRepository.ensureCustomerForForYear(
            u.companyId,
            cid,
            year,
            { certificationType, issuingBody }
          );
          created.push(fu);
        } catch (e: any) {
          if (e.code === "23505" || /duplicate key/i.test(String(e.message))) {
            skipped.push(cid);
          } else {
            throw e;
          }
        }
      }
      response.status(201).json({ data: { created: created.length, skipped: skipped.length, items: created } });
    } catch (error) { next(error); }
  });

  // 从 YoooClaw 通知批量导入跟进
  // 入参：notifications 数组，每项含 customerName, summary, stage, year, expectedDate, contractAmount, certificationType, issuingBody
  app.post("/api/follow-up/import-from-notifications", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const notifications = (body.notifications as Array<{
        customerName?: string;
        customerPhone?: string;
        stage?: string;
        year?: number;
        expectedDate?: string;
        contractAmount?: number;
        certificationType?: string;
        issuingBody?: string;
        summary?: string;
        sourceApp?: string;
        receivedAt?: string;
      }>) || [];

      if (notifications.length === 0) {
        throw new ValidationError("通知列表不能为空");
      }

      const results = {
        created: [] as any[],
        updated: [] as any[],
        skipped: [] as Array<{ customer: string; reason: string }>,
        newCustomers: 0
      };

      for (const notif of notifications) {
        const customerName = (notif.customerName || "").trim();
        if (!customerName) {
          results.skipped.push({ customer: "(空)", reason: "客户名为空" });
          continue;
        }

        // 1. 找/建客户
        let customerId: string | null = null;
        const custRes = await query<{ id: string }>(
          "SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1",
          [u.companyId, customerName]
        );
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        } else {
          // 自动建客户
          const newId = (await query<{ id: string }>(
            "SELECT uuid_generate_v4() AS id"
          )).rows[0].id;
          const codeRes = await query<{ max_code: number }>(
            "SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 2) AS INTEGER)), 0) AS max_code FROM customer WHERE company_id = $1 AND customer_code ~ '^C[0-9]+$'",
            [u.companyId]
          );
          const newCode = `C${String((codeRes.rows[0].max_code || 0) + 1).padStart(5, "0")}`;
          await query(
            `INSERT INTO customer (id, company_id, customer_code, name, region, status, service_stage, contact_phone, notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, '宁夏', 'active', 'potential', $5, $6, NOW(), NOW())`,
            [
              newId,
              u.companyId,
              newCode,
              customerName,
              notif.customerPhone || null,
              `从 YoooClaw 通知导入${notif.sourceApp ? ` (${notif.sourceApp})` : ""}${notif.summary ? ` - ${notif.summary.slice(0, 200)}` : ""}`
            ]
          );
          customerId = newId;
          results.newCustomers++;
        }

        // 2. 找现有跟进（按 customer + year + certType + issuingBody）
        const year = notif.year || new Date().getFullYear();
        const certType = notif.certificationType || null;
        const issuingBody = notif.issuingBody || "zhongren";
        const existingRes = await query<{ id: string }>(
          `SELECT id FROM customer_follow_up
           WHERE company_id = $1 AND customer_id = $2
             AND year = $3 AND certification_type IS NOT DISTINCT FROM $4
             AND issuing_body = $5
             AND deleted_at IS NULL
           LIMIT 1`,
          [u.companyId, customerId, year, certType, issuingBody]
        );

        const stage = notif.stage || "expired";

        if (existingRes.rows.length > 0) {
          // 更新现有跟进（备注追加）
          const fuId = existingRes.rows[0].id;
          await query(
            `UPDATE customer_follow_up
             SET notes = COALESCE(notes || ' / ', '') || $1,
                 expected_date = COALESCE($2, expected_date),
                 contract_amount = COALESCE($3, contract_amount),
                 updated_at = NOW()
             WHERE id = $4`,
            [
              `通知(${notif.sourceApp || "?"}): ${(notif.summary || "").slice(0, 200)}`,
              notif.expectedDate || null,
              notif.contractAmount ?? null,
              fuId
            ]
          );
          results.updated.push({ customerId, followUpId: fuId, customerName });
        } else {
          // 创建新跟进
          const fuRes = await query<{ id: string }>(
            `INSERT INTO customer_follow_up
              (id, company_id, customer_id, certification_type, issuing_body,
               stage, year, expected_date, contract_amount, notes, created_at, updated_at)
             VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
             RETURNING id`,
            [
              u.companyId,
              customerId,
              certType,
              issuingBody,
              stage,
              year,
              notif.expectedDate || null,
              notif.contractAmount ?? null,
              `从 YoooClaw 通知导入${notif.sourceApp ? ` (${notif.sourceApp})` : ""}: ${(notif.summary || "").slice(0, 300)}`
            ]
          );
          results.created.push({ customerId, followUpId: fuRes.rows[0].id, customerName });
        }
      }

      response.status(201).json({ data: results });
    } catch (error) { next(error); }
  });

  // ============================================================
  // Todo (待办) 模块
  // ============================================================

  // 列出 Todo
  app.get("/api/todo", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const status = (request.query.status as string) || "";
      const category = (request.query.category as string) || "";
      const limit = Math.min(parseInt((request.query.limit as string) || "100"), 500);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);

      const conditions: string[] = ["t.company_id = $1", "t.deleted_at IS NULL"];
      const params: any[] = [u.companyId];
      let paramIdx = 2;
      if (status) {
        conditions.push(`t.status = $${paramIdx}`);
        params.push(status);
        paramIdx++;
      }
      if (category) {
        conditions.push(`t.category = $${paramIdx}`);
        params.push(category);
        paramIdx++;
      }

      const items = await query<any>(
        `SELECT t.*, c.name AS customer_name
         FROM todo t LEFT JOIN customer c ON c.id = t.customer_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.completed_at NULLS FIRST,
                  CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                  t.due_at NULLS LAST, t.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );
      const total = await query<{ count: string }>(
        `SELECT count(*) FROM todo t WHERE ${conditions.join(" AND ")}`,
        params
      );
      response.json({ data: items.rows, total: parseInt(total.rows[0].count, 10) });
    } catch (error) { next(error); }
  });

  // 创建 Todo
  app.post("/api/todo", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.title) throw new ValidationError("标题必填");
      const r = await query<{ id: string }>(
        `INSERT INTO todo
          (company_id, owner_user_id, assigned_to, title, description, category,
           source, source_ref, recording_id, due_at, remind_at, status, priority,
           customer_id, follow_up_id, tags, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          u.companyId,
          u.id,
          (body.assignedTo as string) || u.id,
          body.title,
          (body.description as string) || null,
          (body.category as string) || "general",
          (body.source as string) || "manual",
          (body.sourceRef as string) || null,
          (body.recordingId as string) || null,
          body.dueAt || null,
          body.remindAt || null,
          (body.status as string) || "pending",
          (body.priority as string) || "normal",
          (body.customerId as string) || null,
          (body.followUpId as string) || null,
          body.tags ? JSON.stringify(body.tags) : null,
          body.metadata ? JSON.stringify(body.metadata) : null
        ]
      );
      const item = await query<any>("SELECT * FROM todo WHERE id = $1", [r.rows[0].id]);
      response.status(201).json({ data: item.rows[0] });
    } catch (error) { next(error); }
  });

  // 更新 Todo（标完成/改状态等）
  app.patch("/api/todo/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const map: Record<string, string> = {
        title: "title",
        description: "description",
        category: "category",
        status: "status",
        priority: "priority",
        dueAt: "due_at",
        remindAt: "remind_at",
        assignedTo: "assigned_to",
        customerId: "customer_id"
      };
      const fields: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;
      for (const [k, col] of Object.entries(map)) {
        if (k in body) {
          fields.push(`${col} = $${paramIdx}`);
          params.push(body[k]);
          paramIdx++;
        }
      }
      // 完成状态自动写 completed_at
      if (body.status === "done") {
        fields.push(`completed_at = NOW(), completed_by = $${paramIdx}`);
        params.push(u.id);
        paramIdx++;
      }
      if (fields.length === 0) return response.json({ data: null });

      fields.push(`updated_at = NOW()`);
      params.push(u.companyId);
      params.push(request.params.id);
      await query(
        `UPDATE todo SET ${fields.join(", ")}
         WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL`,
        params
      );
      const item = await query<any>("SELECT * FROM todo WHERE id = $1", [request.params.id]);
      response.json({ data: item.rows[0] });
    } catch (error) { next(error); }
  });

  // 删除 Todo（软删）
  app.delete("/api/todo/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      await query(
        `UPDATE todo SET deleted_at = NOW(), updated_at = NOW()
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [u.companyId, request.params.id]
      );
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // ============================================================
  // YoooClaw 录音转写智能导入
  // ============================================================

  // 导入一条录音转写
  // 入参：recordingId, recordingName, transcript (string), summary?, durationSec?
  // 路由智能：自动建 todo / knowledge_document / follow-up
  app.post("/api/yoooclaw/import-recording", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const recordingId = (body.recordingId as string || "").trim();
      const recordingName = (body.recordingName as string || "").trim();
      const transcript = (body.transcript as string || "").trim();
      const summary = (body.summary as string || "").trim();
      const durationSec = body.durationSec ? Number(body.durationSec) : null;

      if (!recordingId) throw new ValidationError("recordingId 必填");
      if (!transcript) throw new ValidationError("transcript 必填");

      // 检查是否已导入
      const exists = await query<{ id: string }>(
        "SELECT id FROM yoooclaw_recording_import WHERE company_id = $1 AND recording_id = $2 AND status = 'processed'",
        [u.companyId, recordingId]
      );
      if (exists.rows.length > 0) {
        response.status(200).json({
          data: { alreadyImported: true, importId: exists.rows[0].id }
        });
        return;
      }

      // 解析路线
      const routes = {
        knowledge: [] as Array<{ id: string; title: string }>,
        todo: [] as Array<{ id: string; title: string }>,
        follow_up: [] as Array<{ id: string; customer: string }>
      };

      // 1) 知识库（短摘要作为知识条目）
      if (summary || transcript.length < 5000) {
        const knowledgeId = (await query<{ id: string }>(
          "SELECT uuid_generate_v4() AS id"
        )).rows[0].id;
        const knowledgeTitle = summary
          ? `${recordingName} - ${recordingId.slice(0, 8)}`
          : `录音转写 - ${recordingName}`;
        const content = summary
          ? `## 摘要\n${summary}\n\n## 录音转写\n${transcript}`
          : transcript;
        await query(
          `INSERT INTO knowledge_document
            (id, company_id, doc_code, title, category, subcategory, file_path, file_type, file_size,
             content_text, confidentiality, business_value, source, status, current_version, tags, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, NOW(), NOW())
           ON CONFLICT (company_id, doc_code) DO UPDATE SET
             content_text = EXCLUDED.content_text,
             title = EXCLUDED.title,
             updated_at = NOW(),
             deleted_at = NULL`,
          [
            knowledgeId,
            u.companyId,
            `YOO-${recordingId.slice(0, 8).toUpperCase()}`,
            knowledgeTitle,
            "yoooclaw_recording",
            recordingName,
            `yoooclaw://${recordingId}`,
            "md",
            transcript.length,
            content.slice(0, 100000),
            "internal",
            "medium",
            "yoooclaw",
            "active",
            ["yoooclaw", "recording", "transcript"]
          ]
        );
        routes.knowledge.push({ id: knowledgeId, title: knowledgeTitle });
      }

      // 2) 待办（如果指定 todos）
      const todos = (body.todos as Array<{
        title: string;
        description?: string;
        dueAt?: string;
        priority?: string;
        category?: string;
        customerName?: string;
      }> || []);
      for (const t of todos) {
        if (!t.title) continue;
        // 找客户
        let customerId: string | null = null;
        if (t.customerName) {
          const custRes = await query<{ id: string }>(
            "SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1",
            [u.companyId, t.customerName.trim()]
          );
          if (custRes.rows.length > 0) customerId = custRes.rows[0].id;
        }
        const todoId = (await query<{ id: string }>(
          "SELECT uuid_generate_v4() AS id"
        )).rows[0].id;
        await query(
          `INSERT INTO todo
            (id, company_id, owner_user_id, title, description, category, source, source_ref, recording_id,
             due_at, status, priority, customer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            todoId,
            u.companyId,
            u.id,
            t.title.slice(0, 200),
            t.description || null,
            t.category || "general",
            "yoooclaw_recording",
            recordingId,
            recordingId,
            t.dueAt || null,
            "pending",
            t.priority || "normal",
            customerId
          ]
        );
        routes.todo.push({ id: todoId, title: t.title });
      }

      // 3) 跟进（如果指定 followUps）
      const followUps = (body.followUps as Array<{
        customerName: string;
        customerPhone?: string;
        stage?: string;
        year?: number;
        expectedDate?: string;
        contractAmount?: number;
        certificationType?: string;
        issuingBody?: string;
        summary?: string;
      }> || []);
      if (followUps.length > 0) {
        // 复用 import-from-notifications 逻辑
        const innerRes = await (async () => {
          const results = { created: [] as any[], updated: [] as any[], skipped: [] as any[], newCustomers: 0 };
          for (const notif of followUps) {
            const customerName = (notif.customerName || "").trim();
            if (!customerName) continue;

            let customerId: string | null = null;
            const custRes = await query<{ id: string }>(
              "SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1",
              [u.companyId, customerName]
            );
            if (custRes.rows.length > 0) {
              customerId = custRes.rows[0].id;
            } else {
              const newId = (await query<{ id: string }>(
                "SELECT uuid_generate_v4() AS id"
              )).rows[0].id;
              const codeRes = await query<{ max_code: number }>(
                "SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 2) AS INTEGER)), 0) AS max_code FROM customer WHERE company_id = $1 AND customer_code ~ '^C[0-9]+$'",
                [u.companyId]
              );
              const newCode = `C${String((codeRes.rows[0].max_code || 0) + 1).padStart(5, "0")}`;
              await query(
                `INSERT INTO customer (id, company_id, customer_code, name, region, status, service_stage, contact_phone, notes, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, '宁夏', 'active', 'potential', $5, $6, NOW(), NOW())`,
                [newId, u.companyId, newCode, customerName, notif.customerPhone || null,
                 `从录音转写导入${recordingId}: ${(notif.summary || transcript).slice(0, 200)}`]
              );
              customerId = newId;
              results.newCustomers++;
            }

            const year = notif.year || new Date().getFullYear();
            const certType = notif.certificationType || null;
            const issuingBody = notif.issuingBody || "zhongren";
            const existingRes = await query<{ id: string }>(
              `SELECT id FROM customer_follow_up
               WHERE company_id = $1 AND customer_id = $2
                 AND year = $3 AND certification_type IS NOT DISTINCT FROM $4
                 AND issuing_body = $5
                 AND deleted_at IS NULL LIMIT 1`,
              [u.companyId, customerId, year, certType, issuingBody]
            );
            const stage = notif.stage || "expired";
            let followUpId: string;
            if (existingRes.rows.length > 0) {
              followUpId = existingRes.rows[0].id;
              await query(
                `UPDATE customer_follow_up
                 SET notes = COALESCE(notes || ' / ', '') || $1,
                     expected_date = COALESCE($2, expected_date),
                     contract_amount = COALESCE($3, contract_amount),
                     updated_at = NOW()
                 WHERE id = $4`,
                [`录音(${recordingId}): ${(notif.summary || transcript).slice(0, 200)}`,
                 notif.expectedDate || null,
                 notif.contractAmount ?? null,
                 followUpId]
              );
              results.updated.push({ customerId, followUpId, customerName });
            } else {
              const fuRes = await query<{ id: string }>(
                `INSERT INTO customer_follow_up
                  (id, company_id, customer_id, certification_type, issuing_body,
                   stage, year, expected_date, contract_amount, notes, created_at, updated_at)
                 VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                 RETURNING id`,
                [u.companyId, customerId, certType, issuingBody, stage, year,
                 notif.expectedDate || null, notif.contractAmount ?? null,
                 `从录音转写导入${recordingId}: ${(notif.summary || transcript).slice(0, 300)}`]
              );
              followUpId = fuRes.rows[0].id;
              results.created.push({ customerId, followUpId, customerName });
            }
            routes.follow_up.push({ id: followUpId, customer: customerName });
          }
          return results;
        })();
        // 加上 innerRes 信息
        routes.follow_up.push(...innerRes.created.map((x: any) => ({ id: x.followUpId, customer: x.customerName, action: 'created' })));
        routes.follow_up.push(...innerRes.updated.map((x: any) => ({ id: x.followUpId, customer: x.customerName, action: 'updated' })));
      }

      // 4) 记录导入历史
      await query(
        `INSERT INTO yoooclaw_recording_import
          (company_id, recording_id, recording_name, transcript, summary, duration_sec, routes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'processed')`,
        [u.companyId, recordingId, recordingName, transcript, summary || null, durationSec,
         JSON.stringify(routes)]
      );

      response.status(201).json({
        data: {
          recordingId,
          routes,
          summary: {
            knowledge: routes.knowledge.length,
            todo: routes.todo.length,
            follow_up: routes.follow_up.length
          }
        }
      });
    } catch (error) { next(error); }
  });

  // 列出已导入的录音
  app.get("/api/yoooclaw/imported-recordings", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const limit = Math.min(parseInt((request.query.limit as string) || "50"), 200);
      const r = await query<any>(
        `SELECT id, recording_id, recording_name, duration_sec, status, imported_at, routes
         FROM yoooclaw_recording_import
         WHERE company_id = $1
         ORDER BY imported_at DESC LIMIT $2`,
        [u.companyId, limit]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 从财务历史自动生成跟进（用 last_service_at 推断）
  app.post("/api/follow-up/auto-from-history", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const year = request.query.year ? parseInt(request.query.year as string, 10) : new Date().getFullYear();
      const limit = Math.min(parseInt((request.query.limit as string) || "50"), 500);

      // 找所有去年（year-1）有交易的客户
      const customers = await query<{
        customer_id: string;
        customer_name: string;
        last_service_at: string;
        service_count: string;
      }>(
        `SELECT id AS customer_id, name AS customer_name,
                last_service_at, service_count
         FROM customer
         WHERE company_id = $1
           AND deleted_at IS NULL
           AND last_service_at IS NOT NULL
           AND EXTRACT(YEAR FROM last_service_at) = $2
         ORDER BY last_service_at DESC
         LIMIT $3`,
        [u.companyId, year - 1, limit]
      );

      let created = 0;
      const items: any[] = [];
      for (const c of customers.rows) {
        try {
          const fu = await followUpRepository.ensureCustomerForForYear(
            u.companyId,
            c.customer_id,
            year,
            { certificationType: null, expectedDate: c.last_service_at, issuingBody: "zhongren" }
          );
          items.push(fu);
          created++;
        } catch (e: any) {
          if (!/duplicate/i.test(String(e.message))) {
            // 跳过重复，其他继续
          }
        }
      }
      response.json({ data: { scanned: customers.rows.length, created, items } });
    } catch (error) { next(error); }
  });

  // ============== 应收账款 (AR) ==============

  app.get("/api/finance/ar", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const result = await arRepository.listAR(u.companyId, {
        customerId: (request.query.customer_id as string) || "",
        status: (request.query.status as string) || "",
        overdueOnly: request.query.overdue_only === "1" || request.query.overdue_only === "true",
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total, totalAmount: result.totalAmount, remainingAmount: result.remainingAmount });
    } catch (error) { next(error); }
  });

  app.get("/api/finance/ar/top-by-customer", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "10"), 1), 100);
      const top = await arRepository.getARTopByCustomer(u.companyId, limit);
      response.json({ data: top });
    } catch (error) { next(error); }
  });

  app.get("/api/finance/ar/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ar = await arRepository.getAR(u.companyId, request.params.id);
      if (!ar) throw new NotFoundError("应收账单");
      const payments = await arRepository.getARPayments(request.params.id);
      response.json({ data: { ...ar, payments } });
    } catch (error) { next(error); }
  });

  app.post("/api/finance/ar", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.customerId) throw new ValidationError("客户必填");
      if (!body.title) throw new ValidationError("标题必填");
      if (!body.totalAmount) throw new ValidationError("金额必填");
      const created = await arRepository.createAR(u.companyId, {
        customerId: body.customerId as string,
        projectId: (body.projectId as string) || null,
        arNo: (body.arNo as string) || `AR-${Date.now()}`,
        title: body.title as string,
        description: (body.description as string) || null,
        totalAmount: Number(body.totalAmount),
        issueDate: (body.issueDate as string) || new Date().toISOString(),
        dueDate: (body.dueDate as string) || new Date().toISOString(),
        status: (body.status as string) || "pending",
        ownerUserId: (body.ownerUserId as string) || u.id
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  app.patch("/api/finance/ar/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      const allowedKeys = ["customerId", "projectId", "arNo", "title", "description", "totalAmount", "issueDate", "dueDate", "status", "ownerUserId"];
      const update: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in body) update[k] = body[k];
      }
      const updated = await arRepository.updateAR(u.companyId, request.params.id, update);
      if (!updated) throw new NotFoundError("应收账单");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  app.delete("/api/finance/ar/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ok = await arRepository.deleteAR(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("应收账单");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  app.post("/api/finance/ar/:id/payments", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as Record<string, unknown>;
      if (!body.amount) throw new ValidationError("金额必填");
      const payment = await arRepository.addPayment(u.companyId, request.params.id, {
        amount: Number(body.amount),
        paymentDate: (body.paymentDate as string) || new Date().toISOString(),
        paymentMethod: (body.paymentMethod as string) || null,
        reference: (body.reference as string) || null,
        notes: (body.notes as string) || null
      });
      response.status(201).json({ data: payment });
    } catch (error) { next(error); }
  });

  // 成果物列表（来自 consultation_project 的 deliverable）
  app.get("/api/deliverables", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query<{
        id: string;
        project_id: string;
        type: string;
        title: string;
        status: string;
        created_at: Date;
        content: unknown;
      }>(
        `SELECT id, project_id, type, title, status, created_at, content
         FROM deliverable
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 200`,
        [u.companyId]
      );
      response.json({ data: r.rows });
    } catch (error) {
      next(error);
    }
  });

  // ===== 知识运营：反馈 + 质量监控 =====

  // 咨询反馈（点赞/点踩）
  app.post("/api/consultations/:id/feedback", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const consultationId = request.params.id;
      const parsed = z.object({
        rating: z.enum(["up", "down", "neutral"]),
        comment: z.string().max(1000).optional(),
        issueType: z.enum(["wrong", "incomplete", "irrelevant", "outdated", "good"]).optional()
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");

      const rating = parsed.data.rating === "up" ? 1 : parsed.data.rating === "down" ? -1 : 0;

      await query(
        `INSERT INTO consultation_feedback
         (company_id, consultation_id, user_id, rating, comment, issue_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [u.companyId, consultationId, u.id, rating,
         parsed.data.comment ?? null, parsed.data.issueType ?? null]
      );
      response.status(201).json({ data: { ok: true, rating } });
    } catch (error) { next(error); }
  });

  // 知识条目反馈（用 doc_code 不用 UUID）
  app.post("/api/knowledge/:docCode/feedback", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const docCode = request.params.docCode;
      const parsed = z.object({
        isHelpful: z.boolean(),
        comment: z.string().max(1000).optional(),
        correctContent: z.string().max(10000).optional()
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");

      // 查 doc id（先 cache 找）
      const doc = await query<{ id: string }>(
        `SELECT id FROM knowledge_document WHERE company_id = $1 AND doc_code = $2`,
        [u.companyId, docCode]
      );
      if (doc.rows.length === 0) throw new ValidationError("知识条目不存在");
      const docId = doc.rows[0].id;

      await query(
        `INSERT INTO knowledge_feedback
         (company_id, document_id, user_id, is_helpful, comment, correct_content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [u.companyId, docId, u.id, parsed.data.isHelpful,
         parsed.data.comment ?? null, parsed.data.correctContent ?? null]
      );

      // 更新聚合
      await query(
        `INSERT INTO knowledge_quality_aggregate
         (document_id, helpful_count, not_helpful_count, feedback_count, helpful_ratio, updated_at)
         VALUES ($1, $2, $3, 1, $4, NOW())
         ON CONFLICT (document_id) DO UPDATE SET
           helpful_count = knowledge_quality_aggregate.helpful_count + $2,
           not_helpful_count = knowledge_quality_aggregate.not_helpful_count + $3,
           feedback_count = knowledge_quality_aggregate.feedback_count + 1,
           helpful_ratio = (knowledge_quality_aggregate.helpful_count + $2)::numeric
                          / NULLIF(knowledge_quality_aggregate.feedback_count + 1, 0),
           updated_at = NOW()`,
        [docId, parsed.data.isHelpful ? 1 : 0, parsed.data.isHelpful ? 0 : 1,
         parsed.data.isHelpful ? 1.0 : 0.0]
      );

      // 纠正内容 → 走审核流（用户不能直接改 knowledge_document）
      if (parsed.data.correctContent) {
        await query(
          `INSERT INTO knowledge_review
             (company_id, document_id, feedback_id, submitted_by, review_type,
              proposed_content, reason, status)
           VALUES ($1, $2, $3, $4, 'correction', $5, $6, 'pending')`,
          [
            u.companyId, docId, null, u.id,
            parsed.data.correctContent,
            parsed.data.comment ?? "用户提交纠正建议"
          ]
        );
        console.log(`[feedback] User ${u.username} submitted correction for doc ${docCode}, awaiting admin review`);
      }

      response.status(201).json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  // 记录零结果查询
  app.post("/api/quality/zero-result", async (request, response, next) => {
    try {
      const parsed = z.object({
        query: z.string().min(2).max(500)
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError("请输入查询文本");

      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(parsed.data.query).digest("hex");
      const u = getUserFromReq(request);
      const cid = u.companyId;

      await query(
        `INSERT INTO zero_result_query
         (company_id, query_text, query_hash, user_id, frequency, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
         ON CONFLICT (company_id, query_hash) DO UPDATE
           SET frequency = zero_result_query.frequency + 1,
               last_seen_at = NOW()`,
        [cid, parsed.data.query, hash, u.id]
      );
      response.json({ data: { ok: true } });
    } catch (error) { next(error); }
  });

  // 质量统计（admin 限定）
  app.get("/api/quality/stats", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      const cid = u.companyId;

      const overall = await query<{
        total_docs: string; total_chunks: string; total_users: string;
        total_customers: string; total_quotes: string; total_consultations: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM knowledge_document WHERE company_id = $1 AND deleted_at IS NULL) AS total_docs,
           (SELECT COUNT(*) FROM knowledge_chunk kc JOIN knowledge_document kd ON kc.document_id = kd.id WHERE kd.company_id = $1) AS total_chunks,
           (SELECT COUNT(*) FROM app_user WHERE company_id = $1 AND deleted_at IS NULL) AS total_users,
           (SELECT COUNT(*) FROM customer WHERE company_id = $1 AND deleted_at IS NULL) AS total_customers,
           (SELECT COUNT(*) FROM quote WHERE company_id = $1 AND deleted_at IS NULL) AS total_quotes,
           (SELECT COUNT(*) FROM consultation_project WHERE company_id = $1 AND deleted_at IS NULL) AS total_consultations`,
        [cid]
      );

      const feedback = await query<{
        total: string; positive: string; negative: string; neutral: string;
      }>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE rating = 1) AS positive,
           COUNT(*) FILTER (WHERE rating = -1) AS negative,
           COUNT(*) FILTER (WHERE rating = 0) AS neutral
         FROM consultation_feedback WHERE company_id = $1`,
        [cid]
      );

      const zeroResults = await query<{ query_text: string; frequency: string }>(
        `SELECT query_text, frequency FROM zero_result_query
         WHERE company_id = $1 ORDER BY frequency DESC LIMIT 10`,
        [cid]
      );

      const topKnowledge = await query<{
        title: string; category: string; helpful_ratio: number; feedback_count: number;
      }>(
        `SELECT kd.title, kd.category, kqa.helpful_ratio, kqa.feedback_count
         FROM knowledge_quality_aggregate kqa
         JOIN knowledge_document kd ON kqa.document_id = kd.id
         WHERE kd.company_id = $1 AND kqa.feedback_count >= 1
         ORDER BY kqa.helpful_ratio DESC, kqa.feedback_count DESC
         LIMIT 10`,
        [cid]
      );

      const badKnowledge = await query<{
        title: string; category: string; helpful_ratio: number; feedback_count: number;
      }>(
        `SELECT kd.title, kd.category, kqa.helpful_ratio, kqa.feedback_count
         FROM knowledge_quality_aggregate kqa
         JOIN knowledge_document kd ON kqa.document_id = kd.id
         WHERE kd.company_id = $1 AND kqa.feedback_count >= 1
         ORDER BY kqa.helpful_ratio ASC, kqa.feedback_count DESC
         LIMIT 5`,
        [cid]
      );

      response.json({
        data: {
          period: "all-time",
          overall: overall.rows[0],
          feedback: feedback.rows[0],
          zeroResults: zeroResults.rows,
          topKnowledge: topKnowledge.rows,
          badKnowledge: badKnowledge.rows
        }
      });
    } catch (error) { next(error); }
  });

  // 质量报告（cron 每周一生成 + 推送飞书）
  app.get("/api/quality/report", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");
      const cid = u.companyId;
      // 过去 7 天
      const weekly = await query<{
        consultations: string; feedback_total: string;
        positive: string; negative: string;
      }>(
        `SELECT
           COUNT(DISTINCT cp.id) AS consultations,
           (SELECT COUNT(*) FROM consultation_feedback WHERE created_at > NOW() - INTERVAL '7 days') AS feedback_total,
           (SELECT COUNT(*) FROM consultation_feedback WHERE rating = 1 AND created_at > NOW() - INTERVAL '7 days') AS positive,
           (SELECT COUNT(*) FROM consultation_feedback WHERE rating = -1 AND created_at > NOW() - INTERVAL '7 days') AS negative
         FROM consultation_project cp
         WHERE cp.company_id = $1 AND cp.created_at > NOW() - INTERVAL '7 days'`,
        [cid]
      );
      const zr = await query<{ count: string }>(
        `SELECT COUNT(DISTINCT query_hash) AS count
         FROM zero_result_query
         WHERE company_id = $1 AND last_seen_at > NOW() - INTERVAL '7 days'`,
        [cid]
      );
      response.json({ data: { period: "weekly", stats: weekly.rows[0], uniqueZeroQueries: zr.rows[0] } });
    } catch (error) { next(error); }
  });

  // ===== 知识审核流 =====
  // 列出待审 + 历史
  app.get("/api/quality/reviews", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const status = request.query.status as string || "all";
      const limit = Number(request.query.limit ?? 50);

      const where = status === "all" ? "" : `AND kr.status = $2`;
      const params: unknown[] = [u.companyId];
      if (status !== "all") params.push(status);

      const r = await query<{
        id: string;
        document_id: string;
        document_title: string;
        doc_code: string;
        review_type: string;
        proposed_content: string;
        reason: string;
        status: string;
        submitter: string;
        submitter_display: string | null;
        reviewed_by: string | null;
        reviewer_display: string | null;
        reviewed_at: Date;
        review_note: string | null;
        new_version: number | null;
        created_at: Date;
      }>(
        `SELECT kr.id, kr.document_id, kd.title AS document_title, kd.doc_code,
                kr.review_type, kr.proposed_content, kr.reason, kr.status,
                kr.submitted_by, su.display_name AS submitter_display,
                kr.reviewed_by, ru.display_name AS reviewer_display,
                kr.reviewed_at, kr.review_note, kr.new_version, kr.created_at
         FROM knowledge_review kr
         JOIN knowledge_document kd ON kr.document_id = kd.id
         LEFT JOIN app_user su ON kr.submitted_by = su.id
         LEFT JOIN app_user ru ON kr.reviewed_by = ru.id
         WHERE kr.company_id = $1 ${where}
         ORDER BY
           CASE kr.status WHEN 'pending' THEN 0 ELSE 1 END,
           kr.created_at DESC
         LIMIT ${limit}`,
        params
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 审核操作（approve / reject）—— admin 限定
  app.post("/api/quality/reviews/:id/decision", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("需要管理员权限");

      const reviewId = request.params.id;
      const parsed = z.object({
        action: z.enum(["approve", "reject"]),
        note: z.string().max(1000).optional()
      }).safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");

      // 先取审核记录
      const review = await query<{
        id: string; document_id: string; review_type: string; proposed_content: string;
        status: string;
      }>(
        `SELECT id, document_id, review_type, proposed_content, status
         FROM knowledge_review
         WHERE id = $1 AND company_id = $2`,
        [reviewId, u.companyId]
      );
      if (review.rows.length === 0) throw new ValidationError("审核记录不存在");
      if (review.rows[0].status !== "pending") throw new ValidationError("该审核已处理");

      if (parsed.data.action === "approve" && review.rows[0].review_type === "correction") {
        // 1. 创建新版本
        const ver = await query<{ v: number }>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS v
           FROM knowledge_version_v2 WHERE document_id = $1`,
          [review.rows[0].document_id]
        );
        const newVersion = ver.rows[0].v;

        await query(
          `INSERT INTO knowledge_version_v2
             (company_id, document_id, version, content_text, change_summary, created_by, review_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            u.companyId, review.rows[0].document_id, newVersion,
            review.rows[0].proposed_content,
            parsed.data.note ?? "管理员批准的用户纠正",
            u.id, reviewId
          ]
        );

        // 2. 替换主表内容
        await query(
          `UPDATE knowledge_document SET content_text = $1, updated_at = NOW() WHERE id = $2`,
          [review.rows[0].proposed_content, review.rows[0].document_id]
        );

        // 3. 标记审核完成
        await query(
          `UPDATE knowledge_review
             SET status = 'applied', reviewed_by = $1, reviewed_at = NOW(),
                 review_note = $2, new_version = $3, updated_at = NOW()
           WHERE id = $4`,
          [u.id, parsed.data.note ?? "已批准并应用", newVersion, reviewId]
        );

        response.json({
          data: { ok: true, action: "approve", newVersion, applied: true }
        });
      } else {
        // 拒绝
        await query(
          `UPDATE knowledge_review
             SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
                 review_note = $2, updated_at = NOW()
           WHERE id = $3`,
          [u.id, parsed.data.note ?? "已拒绝", reviewId]
        );
        response.json({ data: { ok: true, action: "reject" } });
      }
    } catch (error) { next(error); }
  });

  // 知识版本历史
  app.get("/api/knowledge/:docCode/versions", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const docCode = request.params.docCode;

      const doc = await query<{ id: string }>(
        `SELECT id FROM knowledge_document WHERE company_id = $1 AND doc_code = $2`,
        [u.companyId, docCode]
      );
      if (doc.rows.length === 0) throw new ValidationError("文档不存在");

      const r = await query<{
        id: string; version: number; change_summary: string;
        creator: string | null; created_at: Date;
      }>(
        `SELECT kv.id, kv.version, kv.change_summary, su.display_name AS creator, kv.created_at
         FROM knowledge_version_v2 kv
         LEFT JOIN app_user su ON kv.created_by = su.id
         WHERE kv.document_id = $1
         ORDER BY kv.version DESC`,
        [doc.rows[0].id]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 列出过期 / 即将过期的知识
  app.get("/api/quality/expiring", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const days = Number(request.query.days ?? 30);
      const r = await query<{
        doc_code: string; title: string; category: string;
        effective_to: Date; days_remaining: number;
      }>(
        `SELECT doc_code, title, category, effective_to,
                (effective_to - CURRENT_DATE)::int AS days_remaining
         FROM knowledge_document
         WHERE company_id = $1
           AND effective_to IS NOT NULL
           AND effective_to <= CURRENT_DATE + ($2 || ' days')::interval
         ORDER BY effective_to ASC`,
        [u.companyId, String(days)]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 状态机：状态转移（draft → pending_review → approved → archived）
  app.post("/api/deliverables/:id/transition", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以变更成果状态");
      const id = request.params.id;
      const parsed = z
        .object({
          to: z.enum(["draft", "pending_review", "approved", "archived", "rejected"]),
          notes: z.string().max(500).optional()
        })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
      }
      // 状态机规则
      const allowed: Record<string, string[]> = {
        draft: ["pending_review"],
        pending_review: ["approved", "rejected", "draft"],
        approved: ["archived"],
        rejected: ["draft"],
        archived: []
      };
      // 先取当前状态
      const cur = await query<{ status: string }>(
        `SELECT status FROM deliverable
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [id, u.companyId]
      );
      if (cur.rows.length === 0) throw new NotFoundError("成果物");
      const fromStatus = cur.rows[0].status;
      const validNext = allowed[fromStatus] ?? [];
      if (!validNext.includes(parsed.data.to)) {
        throw new ValidationError(
          `状态 ${fromStatus} 不能直接转到 ${parsed.data.to}（允许: ${validNext.join(", ") || "无"}）`
        );
      }
      // 更新
      await query(
        `UPDATE deliverable SET status = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [parsed.data.to, id, u.companyId]
      );
      response.json({ data: { id, from: fromStatus, to: parsed.data.to, notes: parsed.data.notes } });
    } catch (error) {
      next(error);
    }
  });

  // ====== 认证报价导出 DOCX ======
  app.post("/api/certification/quote/export/docx", async (request, response, next) => {
    try {
      const parsed = quoteExportPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const buffer = await generateQuoteDocx(parsed.data.quote, {
        companyName: parsed.data.companyName,
        clientName: parsed.data.companyName,
        projectName: "认证证书报价",
        documentTitle: "认证证书报价单",
        version: "v1.0",
        preparedBy: "认证专家",
        confidentiality: "内部",
        includeToc: false,
        includeReferences: false
      });
      const safeName = `${parsed.data.companyName}-认证报价单.docx`.replace(/[\\/:*?"<>|]/g, "-");
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`
      );
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/consultations/:id/export/docx", async (request, response, next) => {
    try {
      const parsed = docxExportSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const record = await consultationService.getById(
        getUserFromReq(request).companyId,
        request.params.id
      );
      const buffer = await generateConsultationDocx(record, parsed.data);
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=${encodedFileName(parsed.data.documentTitle, "docx")}`
      );
      response.setHeader("Content-Length", String(buffer.length));
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/templates/enterprise-solution.docx", async (_request, response, next) => {
    try {
      const branding = enterpriseTemplateBranding();
      const buffer = await generateConsultationDocx(enterpriseTemplateRecord(), branding);
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=${encodedFileName("企业数字化建设方案模板", "docx")}`
      );
      response.setHeader("Content-Length", String(buffer.length));
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/consultations/:id/export/pptx", async (request, response, next) => {
    try {
      const parsed = pptxExportSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const record = await consultationService.getById(
        getUserFromReq(request).companyId,
        request.params.id
      );
      const buffer = await generateConsultationPptx(record, parsed.data);
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=${encodedFileName(parsed.data.presentationTitle, "pptx")}`
      );
      response.setHeader("Content-Length", String(buffer.length));
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/templates/digital-transformation-solution.pptx", async (_request, response, next) => {
    try {
      const branding = presentationTemplateBranding();
      const buffer = await generateConsultationPptx(
        presentationTemplateRecord(),
        branding
      );
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=${encodedFileName("数字化建设方案演示模板", "pptx")}`
      );
      response.setHeader("Content-Length", String(buffer.length));
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/documents/analyze", upload.single("file"), async (request, response, next) => {
    try {
      if (!request.file) throw new ValidationError("请选择需要分析的文件");
      const content = (await extractDocumentText(request.file)).trim();
      if (!content) throw new ValidationError("文件中没有提取到可用文本");
      const u = getUserFromReq(request);
      const knowledge = searchKnowledge(
        content.slice(0, 10_000),
        await knowledgeRepository.list(u.companyId)
      );
      const input = {
        role: "knowledge-assistant" as EmployeeRole,
        industry: String(request.body.industry || "通用"),
        companyContext: `待分析文件：${request.file.originalname}`,
        request: `请分析以下文档并输出摘要、关键结论、风险、行动建议：\n${content.slice(0, 30_000)}`,
        deliverable: "文档分析报告",
        model: (request.body.model || "demo") as ModelProvider
      };
      const result = await generateWithModel(input.model, { input, knowledge });
      response.json({
        data: {
          fileName: request.file.originalname,
          characters: content.length,
          result,
          references: knowledge.map(({ id, title, category }) => ({ id, title, category }))
        }
      });
    } catch (error) { next(error); }
  });

  // ===== PDF 转 Word =====
    app.post("/api/pdf/to-docx", upload.single("file"), async (request, response, next) => {
      try {
        if (!request.file) throw new ValidationError("请选择需要转换的 PDF 文件");
        if (request.file.mimetype !== "application/pdf" && !request.file.originalname.toLowerCase().endsWith(".pdf")) {
          throw new ValidationError("仅支持 PDF 文件");
        }

        const workDir = await fs.mkdtemp(path.join("/tmp", "pdf2docx-"));
        const baseName = path.parse(request.file.originalname).name || "document";
        const pdfPath = path.join(workDir, `${baseName}.pdf`);
        const docxPath = path.join(workDir, `${baseName}.docx`);

        await fs.writeFile(pdfPath, request.file.buffer);

        // 使用 pdftotext + LLM 重排版（识别标题/段落/表格/列表）
        const model = String(request.body?.model || "ollama");
        const pythonScript = path.resolve("./src/pdf_to_docx_llm.py");
        const venvPython = "/home/ygycliu/ComfyUI/.venv/bin/python";
        try {
          await execFile(venvPython, [pythonScript, pdfPath, docxPath, model], { timeout: 120_000 });
        } catch (err) {
          throw new AppError(`转换失败: ${(err as Error).message}`, "PDF_CONVERT_ERROR", 500);
        }

        try {
          await fs.access(docxPath);
        } catch {
          throw new AppError("转换失败：未生成 docx 文件", "PDF_CONVERT_ERROR", 500);
        }

        const docxBuffer = await fs.readFile(docxPath);
        const downloadName = `${baseName}.docx`;

        // 异步清理工作目录
        fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

        response.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        response.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
        response.send(docxBuffer);
      } catch (error) { next(error); }
    });

  // ====== 飞书集成 ======
  app.post("/feishu/events", handleEvent);
  app.post("/api/feishu/push", pushMessage);

  if (fsSync.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
  }

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(413).json({
        code: "UPLOAD_ERROR",
        message: error.code === "LIMIT_FILE_SIZE" ? "文件不能超过 15MB" : error.message,
        requestId: request.id
      });
      return;
    }
    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        requestId: request.id
      });
      return;
    }
    request.log.error({ error }, "Unhandled request error");
    response.status(500).json({
      code: "INTERNAL_ERROR",
      message: "服务处理失败，请稍后重试",
      requestId: request.id
    });
  });

  return app;
}
