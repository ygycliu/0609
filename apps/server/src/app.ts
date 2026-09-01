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
import { ofdBufferToDocxBuffer } from "./docx/ofd-to-docx.js";
import { ConsultationRepository } from "./consultations/consultation.repository.js";
import { generateAuditPlan, generateChecklist, detectNonConformances, generateAuditReport } from "./auditor/auditor.service.js";
import { autoGenerateAuditPlan, listTemplates as listAuditTemplates } from "./follow_up/autoAuditPlan.js";
import { syncFollowUpToProject } from "./follow_up/syncFollowUpToProject.js";
import { QuoteRepository } from "./certification/quote.repository.js";
import { CustomerRepository } from "./customers/customer.repository.js";
import { FinanceRepository } from "./finance/finance.repository.js";
import * as projectRepo from "./project/project.repository.js";
import { ARRepository } from "./finance/ar.repository.js";
import { FollowUpRepository, FOLLOW_UP_STAGES, ISSUING_BODIES } from "./follow_up/follow_up.repository.js";
import { processRecordingEndToEnd } from "./services/yoooclaw-extract.service.js";
import { handleChat, handleToolConfirmation, ASSISTANT_TOOLS } from "./services/assistant.service.js";
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
  limits: { fileSize: 200 * 1024 * 1024 }  // 200MB（V2.1 提升）
});

const consultationSchema = z.object({
  role: z.enum(["trainer", "knowledge-assistant", "certification-expert"]),
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
    expertCount: z.number(),
    managementAnnualFee: z.number(),
    basePrice: z.number(),
    taxFee: z.number(),
    businessManagementFee: z.number(),
    finalPrice: z.number(),
    totalAuditDays: z.number(),
    standardCount: z.number(),
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

export async function createApp() {
  const app = express();
  // V2.0：审核员档案仓储（顶层 dynamic import，ESM 友好）
  const auditorModule = await import("./auditors/auditor.repository.js");
  const auditorRepo = new auditorModule.AuditorProfileRepository();
  const ocrModule = await import("./auditors/ocr.service.js");
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

  // P0-C §9：全局一致性校验（每日）
  // 扫描所有项目，检查事件一致性
  // 可被 cron 调用（也可人工 GET 触发）
  app.get("/api/admin/consistency/global", async (_request, response, next) => {
    try {
      const startTime = Date.now();
      const issues: {
        versionGaps: Array<{projectId: string; projectCode: string; expected: number; actual: number}>;
        statusMismatches: Array<{projectId: string; projectCode: string; projectStatus: string; lastEventStatus: string}>;
        auditLogMissing: any[];
        totalProjects: number;
        healthyProjects: number;
      } = {
        versionGaps: [],
        statusMismatches: [],
        auditLogMissing: [],
        totalProjects: 0,
        healthyProjects: 0
      };

      // 找出所有项目 + 最后事件
      const projectsRes = await query(
        `SELECT p.id, p.project_code, p.status, p.company_id
         FROM certification_project p
         WHERE p.deleted_at IS NULL`
      );

      for (const proj of projectsRes.rows) {
        issues.totalProjects++;

        // 检查事件连续性
        const eventsRes = await query(
          `SELECT aggregate_version, from_status, to_status
           FROM project_event
           WHERE project_id = $1 AND company_id = $2
           ORDER BY aggregate_version ASC`,
          [proj.id, proj.company_id]
        );

        let expectedVersion = 1;
        let projectHealthy = true;
        for (const evt of eventsRes.rows) {
          if (evt.aggregate_version !== expectedVersion) {
            issues.versionGaps.push({
              projectId: proj.id,
              projectCode: proj.project_code,
              expected: expectedVersion,
              actual: evt.aggregate_version
            });
            projectHealthy = false;
          }
          expectedVersion = evt.aggregate_version + 1;
        }

        // 检查状态一致性
        if (eventsRes.rows.length > 0) {
          const lastEvt = eventsRes.rows[eventsRes.rows.length - 1];
          if (lastEvt.to_status !== proj.status) {
            issues.statusMismatches.push({
              projectId: proj.id,
              projectCode: proj.project_code,
              projectStatus: proj.status,
              lastEventStatus: lastEvt.to_status
            });
            projectHealthy = false;
          }
        }

        if (projectHealthy) issues.healthyProjects++;
      }

      const duration = Date.now() - startTime;

      response.json({
        data: {
          ...issues,
          durationMs: duration,
          timestamp: new Date().toISOString(),
          healthy: issues.versionGaps.length === 0 && issues.statusMismatches.length === 0
        }
      });
    } catch (e) { next(e); }
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

  

  
  // V2.0：OFD 转 Word（直接上传 OFD → 返回 docx 文件 + 提取的文本 + 标题）
  app.post("/api/document/ofd-to-docx", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以使用 OFD 转换功能");
      if (!request.file) throw new ValidationError("请上传 OFD 文件");
      const ext = path.extname(request.file.originalname).toLowerCase();
      if (ext !== ".ofd") throw new ValidationError("只支持 .ofd 文件");

      const result = await ofdBufferToDocxBuffer(request.file.buffer, {
        titleHint: path.basename(request.file.originalname, ".ofd")
      });

      response.json({
        data: {
          docxBase64: result.docx.toString("base64"),
          docxSize: result.docx.length,
          title: result.title,
          text: result.text.slice(0, 5000),  // 前 5000 字用于预览
          textLength: result.text.length
        }
      });
    } catch (error) { next(error); }
  });

  // V2.0：OFD 一键入库（OFD → 转换 → 自动入知识库 + 自动审批）
  app.post("/api/document/ofd-to-knowledge", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以使用 OFD 入库功能");
      if (!request.file) throw new ValidationError("请上传 OFD 文件");
      const ext = path.extname(request.file.originalname).toLowerCase();
      if (ext !== ".ofd") throw new ValidationError("只支持 .ofd 文件");

      const category = String(request.body.category ?? "").trim();
      if (!category) throw new ValidationError("请选择知识分类");
      const tags = String(request.body.tags ?? "").trim();
      const userTitle = String(request.body.title ?? "").trim();

      // 1. OFD → Word
      const result = await ofdBufferToDocxBuffer(request.file.buffer, {
        titleHint: userTitle || path.basename(request.file.originalname, ".ofd")
      });
      const finalTitle = userTitle || result.title;

      // 2. 存 Word 文件到 uploads 目录
      await fs.mkdir(config.uploadsDir, { recursive: true });
      const docId = randomUUID();
      const storedName = `${docId}.docx`;
      await fs.writeFile(path.join(config.uploadsDir, storedName), result.docx);

      // 3. 入 knowledge_document（pending_review）
      await knowledgeRepository.add(u.companyId, {
        id: docId,
        companyId: u.companyId,
        category,
        title: finalTitle,
        fileType: "docx",
        tags: tags ? tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
        content: result.text.slice(0, 100_000),
        sourceName: request.file.originalname  // 保留原 OFD 文件名作为来源
      } as any);
      await query(
        `UPDATE knowledge_document SET status = 'pending_review' WHERE doc_code = $1 AND company_id = $2`,
        [docId, u.companyId]
      );
      const docRow = await query<{ id: string }>(
        `SELECT id FROM knowledge_document WHERE doc_code = $1 AND company_id = $2`,
        [docId, u.companyId]
      );
      const realDocId = docRow.rows[0]?.id;

      // 4. 创建审核记录
      const reviewId = randomUUID();
      const uploadMeta = JSON.stringify({
        title: finalTitle,
        category,
        fileType: "docx",
        tags: tags ? tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
        content: result.text.slice(0, 100_000),
        sourceName: request.file.originalname
      });
      await query(
        `INSERT INTO knowledge_review
           (id, company_id, document_id, submitted_by, review_type,
            proposed_content, reason, status, created_at)
         VALUES ($1, $2, $3, $4, 'upload', $5, $6, 'pending', NOW())`,
        [reviewId, u.companyId, realDocId, u.id, uploadMeta, `OFD 自动转换入库 - ${request.file.originalname}`]
      );

      // 5. 自动批准（admin 一键入库）- 直接 SQL
      const reviewNote = `OFD 自动转换 + 自动入库 - 原文件：${request.file.originalname}`;
      await query(
        `UPDATE knowledge_review
           SET status = 'applied', reviewed_by = $1, reviewed_at = NOW(),
               review_note = $2
         WHERE id = $3`,
        [u.id, reviewNote, reviewId]
      );
      // 更新 document 为 active
      await query(
        `UPDATE knowledge_document SET status = 'active', updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [realDocId, u.companyId]
      );

      response.json({
        data: {
          ok: true,
          title: finalTitle,
          textLength: result.text.length,
          docxSize: result.docx.length,
          reviewId,
          documentId: realDocId,
          message: `OFD 文件已转换为 Word 并自动入库（${finalTitle}）`
        }
      });
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
      const extractedText = (await extractDocumentText(request.file)).trim();
      if (!extractedText) throw new ValidationError("文件中没有提取到可用文本");
      const category = String(request.body.category ?? "").trim();
      if (!category) throw new ValidationError("请选择知识分类");
      const title = String(request.body.title || request.file.originalname).trim();
      const fileType = path.extname(request.file.originalname).slice(1).toLowerCase();
      const tags = String(request.body.tags ?? "")
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const docId = randomUUID();

      // 保存文件到 uploads 目录
      await fs.mkdir(config.uploadsDir, { recursive: true });
      const storedName = `${docId}${path.extname(request.file.originalname)}`;
      await fs.writeFile(path.join(config.uploadsDir, storedName), request.file.buffer);

      // V2.0 修复：先存 knowledge_document（status='pending_review'），再存审核记录
      await knowledgeRepository.add(u.companyId, {
        id: docId,  // 用作 doc_code
        companyId: u.companyId,
        category,
        title,
        fileType,
        tags,
        content: extractedText.slice(0, 100_000),
        sourceName: request.file.originalname
      } as any);
      // 更新状态为 pending_review（用 doc_code 定位，因为 id 列是 default uuid）
      await query(
        `UPDATE knowledge_document SET status = 'pending_review' WHERE doc_code = $1 AND company_id = $2`,
        [docId, u.companyId]
      );
      // 获取真实的 document id（用于 review 表的外键）
      const docRow = await query<{ id: string }>(
        `SELECT id FROM knowledge_document WHERE doc_code = $1 AND company_id = $2`,
        [docId, u.companyId]
      );
      const realDocId = docRow.rows[0]?.id;

      // 存入审核队列表，关联到刚创建的 document_id
      const reviewId = randomUUID();
      const uploadMeta = JSON.stringify({
        title, category, fileType, tags,
        content: extractedText.slice(0, 100_000),
        sourceName: request.file.originalname
      });
      await query(
        `INSERT INTO knowledge_review
           (id, company_id, document_id, submitted_by, review_type,
            proposed_content, reason, status, created_at)
         VALUES ($1, $2, $3, $4, 'upload', $5, $6, 'pending', NOW())`,
        [reviewId, u.companyId, realDocId, u.id, uploadMeta, "上传文件待审核"]
      );

      response.status(201).json({
        data: { id: reviewId, documentId: docId, title, status: "pending_review", message: "文件已提交，请等待管理员审核" }
      });
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
          riskLevel: z.enum(["medium", "high"]).default("medium"),
          certificationScope: z.string().trim().max(2000).optional().default(""),
          expertCount: z.number().int().min(1).max(20).optional().default(1)
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

      // V2.1：加载所有客户的证书（一行一证书，包含证书详情）
      const customerIds = result.items.map((c: any) => c.id);
      const certMap = new Map<string, any[]>(); // customerId → certs
      if (customerIds.length > 0) {
        const certRes = await query<any>(
          `SELECT 
             sc.customer_id,
             pc.id AS cert_id,
             pc.cert_type,
             pc.standard,
             pc.certificate_no,
             pc.issue_date::text AS issue_date,
             pc.valid_until::text AS valid_until,
             pc.issuing_body,
             pc.status AS cert_status,
             pc.acknowledged_at IS NOT NULL AS is_acknowledged,
             (pc.valid_until - CURRENT_DATE) AS days_until_expiry
           FROM project_certificate pc
           JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
           WHERE pc.deleted_at IS NULL
             AND sc.customer_id = ANY($1::uuid[])
           ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`,
          [customerIds]
        );
        for (const row of certRes.rows) {
          const arr = certMap.get(row.customer_id) || [];
          arr.push(row);
          certMap.set(row.customer_id, arr);
        }
      }

      // 生成 CSV (BOM + UTF-8) — 一行一证书
      const headers = [
        "客户编号", "客户名称", "行业", "规模", "地区", "联系人",
        "电话", "邮箱", "信用代码", "业务范围", "服务阶段", "客户状态",
        "来源", "来源渠道", "标签", "累计营收", "服务次数",
        "首次服务", "最近服务", "满意度", "备注",
        // 证书字段
        "证书类型", "证书标准", "证书编号", "颁发机构",
        "签发日期", "到期日期", "证书状态", "距到期天数", "已确认"
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
      // 基础信息行（按客户）- 用 any[] 因为 searchAdvanced 返回 snake_case
      const customerBase = new Map<string, string[]>();
      for (const c of result.items as any[]) {
        customerBase.set(c.id, [
          c.customer_code, c.name, c.industry, c.scale, c.region,
          c.contact_person, c.contact_phone, c.contact_email,
          c.credit_code, c.business_scope, c.service_stage, c.status,
          c.source, c.source_channel,
          Array.isArray(c.tags) ? c.tags.join("; ") : "",
          c.total_revenue ?? "", c.service_count ?? "",
          c.first_service_at, c.last_service_at,
          c.satisfaction_score, c.notes
        ]);
      }
      // 展开：一客户多证书 → 多行；无证书 → 一行（证书字段为空）
      const rows: string[][] = [];
      for (const c of result.items) {
        const base = customerBase.get(c.id) || [];
        const certs = certMap.get(c.id) || [];
        if (certs.length === 0) {
          // 无证书：客户基础 + 21 个空证书字段
          rows.push([...base, "", "", "", "", "", "", "", "", ""]);
        } else {
          for (const cert of certs) {
            rows.push([
              ...base,
              cert.cert_type || "",
              cert.standard || "",
              cert.certificate_no || "",
              cert.issuing_body || "",
              cert.issue_date || "",
              cert.valid_until || "",
              cert.cert_status || "",
              cert.days_until_expiry ?? "",
              cert.is_acknowledged ? "是" : "否"
            ]);
          }
        }
      }
      const csv = [
        "\uFEFF" + headers.map(esc).join(","),
        ...rows.map(row => row.map(esc).join(","))
      ].join("\r\n");

      const filename = `单位信息（含证书）_${new Date().toISOString().slice(0, 10)}.csv`;
      const safeAscii = `customers_with_certs_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });

  // V2.1：从 CSV 导入客户（系统基础数据 → 单位信息）支持客户+证书
  app.post("/api/customers/import.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可导入单位信息" });
        return;
      }

      const csvText = (request.body as any)?.csv as string;
      if (!csvText || typeof csvText !== "string") {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ 请提供 csv 字段" });
        return;
      }

      const cleanText = csvText.replace(/^\uFEFF/, "");

      function parseCSV(text: string): string[][] {
        const rows: string[][] = [];
        let row: string[] = [];
        let cell = "";
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQuotes) {
            if (ch === '"') {
              if (text[i + 1] === '"') { cell += '"'; i++; }
              else inQuotes = false;
            } else cell += ch;
          } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ",") { row.push(cell); cell = ""; }
            else if (ch === "\n" || ch === "\r") {
              if (ch === "\r" && text[i + 1] === "\n") i++;
              row.push(cell); cell = "";
              rows.push(row); row = [];
            } else cell += ch;
          }
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.length > 1 || (r[0] && r[0].trim()));
      }

      const rows = parseCSV(cleanText);
      if (rows.length < 2) {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ CSV 内容为空或只有表头" });
        return;
      }

      const headers = rows[0].map(h => h.trim());
      // 客户字段
      const nameIdx = headers.indexOf("客户名称");
      const codeIdx = headers.indexOf("客户编号");
      const industryIdx = headers.indexOf("行业");
      const regionIdx = headers.indexOf("地区");
      const contactIdx = headers.indexOf("联系人");
      const phoneIdx = headers.indexOf("电话");
      const emailIdx = headers.indexOf("邮箱");
      const creditCodeIdx = headers.indexOf("信用代码");
      const addressIdx = headers.indexOf("地址");
      const businessIdx = headers.indexOf("业务范围");
      const tagsIdx = headers.indexOf("标签");
      const notesIdx = headers.indexOf("备注");
      // 证书字段
      const certTypeIdx = headers.indexOf("证书类型");
      const certStandardIdx = headers.indexOf("证书标准");
      const certNoIdx = headers.indexOf("证书编号");
      const issuingBodyIdx = headers.indexOf("颁发机构");
      const issueDateIdx = headers.indexOf("签发日期");
      const validUntilIdx = headers.indexOf("到期日期");

      if (nameIdx === -1) {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ 缺少必填列：客户名称" });
        return;
      }

      let customersAdded = 0, customersUpdated = 0, certsAdded = 0, certsUpdated = 0, failed = 0;
      const errors: { row: number; reason: string; data: string }[] = [];

      // 缓存：客户名 → customer_id（用于一行多证书）
      const customerIdCache = new Map<string, string>();
      // 缓存：客户名+证书编号 → certificate_id
      const certCache = new Map<string, string>();

      // 默认签约主体（华中国际认证检验集团有限公司）
      const defaultSigningEntity = await query<{ id: string }>(
        `SELECT id FROM signing_entity WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [u.companyId]
      );
      const defaultSigningEntityId = defaultSigningEntity.rows[0]?.id || null;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[nameIdx] || "").trim();
        if (!name) {
          failed++;
          errors.push({ row: i + 1, reason: "客户名称为空", data: row.join(",") });
          continue;
        }
        try {
          // === 阶段1：upsert 客户 ===
          let customerId = customerIdCache.get(name);

          if (!customerId) {
            const existing = await query<{ id: string }>(
              `SELECT id FROM customer 
               WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL 
               LIMIT 1`,
              [u.companyId, name]
            );

            const tagsRaw = tagsIdx >= 0 ? (row[tagsIdx] || "").trim() : "";
            const tags = tagsRaw ? tagsRaw.split(/[;,、]/).map((t: string) => t.trim()).filter(Boolean) : [];

            if (existing.rows.length > 0) {
              customerId = existing.rows[0].id;
              await query(
                `UPDATE customer SET
                  industry = COALESCE(NULLIF($2, ''), industry),
                  region = COALESCE(NULLIF($3, ''), region),
                  contact_person = COALESCE(NULLIF($4, ''), contact_person),
                  contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
                  contact_email = COALESCE(NULLIF($6, ''), contact_email),
                  credit_code = COALESCE(NULLIF($7, ''), credit_code),
                  address = COALESCE(NULLIF($8, ''), address),
                  business_scope = COALESCE(NULLIF($9, ''), business_scope),
                  tags = COALESCE($10, tags),
                  notes = COALESCE(NULLIF($11, ''), notes),
                  updated_at = NOW()
                WHERE id = $1`,
                [
                  customerId,
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  regionIdx >= 0 ? (row[regionIdx] || "").trim() : "",
                  contactIdx >= 0 ? (row[contactIdx] || "").trim() : "",
                  phoneIdx >= 0 ? (row[phoneIdx] || "").trim() : "",
                  emailIdx >= 0 ? (row[emailIdx] || "").trim() : "",
                  creditCodeIdx >= 0 ? (row[creditCodeIdx] || "").trim() : "",
                  addressIdx >= 0 ? (row[addressIdx] || "").trim() : "",
                  businessIdx >= 0 ? (row[businessIdx] || "").trim() : "",
                  tags.length > 0 ? tags : null,
                  notesIdx >= 0 ? (row[notesIdx] || "").trim() : ""
                ]
              );
              customersUpdated++;
            } else {
              const customerCode = codeIdx >= 0 && (row[codeIdx] || "").trim()
                ? (row[codeIdx] || "").trim()
                : `IMP-${Date.now().toString(36)}-${i}`;
              const ins = await query<{ id: string }>(
                `INSERT INTO customer (
                  company_id, customer_code, name, industry, region,
                  contact_person, contact_phone, contact_email, credit_code,
                  address, business_scope, tags, notes, status, source,
                  source_channel, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active','import','csv_import',NOW(),NOW())
                RETURNING id`,
                [
                  u.companyId, customerCode, name,
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  regionIdx >= 0 ? (row[regionIdx] || "").trim() : "",
                  contactIdx >= 0 ? (row[contactIdx] || "").trim() : "",
                  phoneIdx >= 0 ? (row[phoneIdx] || "").trim() : "",
                  emailIdx >= 0 ? (row[emailIdx] || "").trim() : "",
                  creditCodeIdx >= 0 ? (row[creditCodeIdx] || "").trim() : "",
                  addressIdx >= 0 ? (row[addressIdx] || "").trim() : "",
                  businessIdx >= 0 ? (row[businessIdx] || "").trim() : "",
                  tags.length > 0 ? tags : [],
                  notesIdx >= 0 ? (row[notesIdx] || "").trim() : ""
                ]
              );
              customerId = ins.rows[0].id;
              customersAdded++;
            }
            customerIdCache.set(name, customerId);
          }

          // === 阶段2：upsert 证书（如果有证书类型字段）===
          const certType = certTypeIdx >= 0 ? (row[certTypeIdx] || "").trim() : "";
          if (certType && customerId) {
            const certNo = certNoIdx >= 0 ? (row[certNoIdx] || "").trim() : "";
            const certKey = `${customerId}|${certNo || certType}`;

            // 默认 service_type
            const defaultServiceType = await query<{ id: string }>(
              `SELECT id FROM service_type WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
              [u.companyId]
            );
            const defaultServiceTypeId = defaultServiceType.rows[0]?.id || null;

            // 查找/创建 certification_project
            let projectId = await query<{ id: string }>(
              `SELECT id FROM certification_project
               WHERE customer_id = $1 AND company_id = $2 AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1`,
              [customerId, u.companyId]
            ).then(r => r.rows[0]?.id || null);

            if (!projectId && defaultServiceTypeId && defaultSigningEntityId) {
              const newProj = await query<{ id: string }>(
                `INSERT INTO certification_project (
                  company_id, project_code, customer_id, customer_name,
                  service_type_id, service_type_code, service_type_name,
                  signing_entity_id, signing_entity_name, status, industry,
                  created_by, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING id`,
                [
                  u.companyId,
                  `IMP-${customerId.slice(0, 8)}-${Date.now().toString(36)}`,
                  customerId, name,
                  defaultServiceTypeId, 'import', '证书导入自动创建',
                  defaultSigningEntityId, '华中国际认证检验集团有限公司',
                  'project_archived',
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  u.id || null
                ]
              );
              projectId = newProj.rows[0]?.id || null;
            }

            if (!projectId) {
              errors.push({ row: i + 1, reason: "缺少签约主体/服务类型，无法创建证书项目", data: row.join(",") });
              continue;
            }

            // upsert certificate
            const standard = certStandardIdx >= 0 ? (row[certStandardIdx] || "").trim() : "";
            const issuingBody = issuingBodyIdx >= 0 ? (row[issuingBodyIdx] || "").trim() : "华中国际认证检验集团有限公司";
            const issueDate = issueDateIdx >= 0 ? (row[issueDateIdx] || "").trim() : "";
            const validUntil = validUntilIdx >= 0 ? (row[validUntilIdx] || "").trim() : "";

            // 已有？
            const existingCert = await query<{ id: string }>(
              `SELECT id FROM project_certificate 
               WHERE project_id = $1 AND cert_type = $2 
                 AND ($3 = '' OR certificate_no = $3)
                 AND deleted_at IS NULL LIMIT 1`,
              [projectId, certType, certNo]
            );

            if (existingCert.rows.length > 0) {
              await query(
                `UPDATE project_certificate SET
                  standard = COALESCE(NULLIF($2, ''), standard),
                  certificate_no = COALESCE(NULLIF($3, ''), certificate_no),
                  issuing_body = COALESCE(NULLIF($4, ''), issuing_body),
                  issue_date = COALESCE(NULLIF($5, '')::date, issue_date),
                  valid_until = COALESCE(NULLIF($6, '')::date, valid_until),
                  updated_at = NOW()
                WHERE id = $1`,
                [existingCert.rows[0].id, standard, certNo, issuingBody, issueDate, validUntil]
              );
              certsUpdated++;
            } else {
              await query(
                `INSERT INTO project_certificate (
                  company_id, project_id, cert_type, standard, certificate_no,
                  issuing_body, issue_date, valid_until, status,
                  created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, 'active', NOW(), NOW())`,
                [u.companyId, projectId, certType, standard, certNo,
                 issuingBody || "华中国际认证检验集团有限公司",
                 issueDate || null, validUntil || null]
              );
              certsAdded++;
            }
          }
        } catch (err: any) {
          failed++;
          errors.push({ row: i + 1, reason: err.message || "未知错误", data: row.join(",") });
        }
      }

      response.json({
        data: {
          total: rows.length - 1,
          customers: {
            inserted: customersAdded,
            updated: customersUpdated
          },
          certificates: {
            inserted: certsAdded,
            updated: certsUpdated
          },
          failed,
          errors: errors.slice(0, 50)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // V2.1：按证书类型筛选导出（复用 export.csv 逻辑，加 cert_type 过滤）
  app.get("/api/customers/export-with-certs.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const certTypeFilter = (request.query.cert_type as string) || "";
      const q = (request.query.q as string) || "";
      const offset = 0;
      const limit = 10000;

      const result = await customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        offset, limit
      });

      // 加载证书（可选过滤 cert_type）
      const customerIds = result.items.map((c: any) => c.id);
      const certMap = new Map<string, any[]>();
      if (customerIds.length > 0) {
        const sql = certTypeFilter
          ? `SELECT sc.customer_id, pc.id AS cert_id, pc.cert_type, pc.standard,
                   pc.certificate_no, pc.issue_date::text AS issue_date, pc.valid_until::text AS valid_until,
                   pc.issuing_body, pc.status AS cert_status,
                   pc.acknowledged_at IS NOT NULL AS is_acknowledged,
                   (pc.valid_until - CURRENT_DATE) AS days_until_expiry
             FROM project_certificate pc
             JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
             WHERE pc.deleted_at IS NULL AND sc.customer_id = ANY($1::uuid[])
               AND ($2 = '' OR pc.cert_type LIKE '%' || $2 || '%')
             ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`
          : `SELECT sc.customer_id, pc.id AS cert_id, pc.cert_type, pc.standard,
                   pc.certificate_no, pc.issue_date::text AS issue_date, pc.valid_until::text AS valid_until,
                   pc.issuing_body, pc.status AS cert_status,
                   pc.acknowledged_at IS NOT NULL AS is_acknowledged,
                   (pc.valid_until - CURRENT_DATE) AS days_until_expiry
             FROM project_certificate pc
             JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
             WHERE pc.deleted_at IS NULL AND sc.customer_id = ANY($1::uuid[])
             ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`;
        const params = certTypeFilter ? [customerIds, certTypeFilter] : [customerIds];
        const certRes = await query<any>(sql, params);
        for (const row of certRes.rows) {
          const arr = certMap.get(row.customer_id) || [];
          arr.push(row);
          certMap.set(row.customer_id, arr);
        }
      }

      const headers = [
        "客户编号", "客户名称", "行业", "地区", "联系人", "电话",
        "邮箱", "客户状态", "标签",
        "证书类型", "证书标准", "证书编号", "颁发机构",
        "签发日期", "到期日期", "证书状态", "距到期天数", "已确认"
      ];
      const esc = (v: any) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };
      const customerBase = new Map<string, string[]>();
      for (const c of result.items as any[]) {
        customerBase.set(c.id, [
          c.customer_code, c.name, c.industry, c.region,
          c.contact_person, c.contact_phone, c.contact_email,
          c.status, Array.isArray(c.tags) ? c.tags.join("; ") : ""
        ]);
      }
      const rows: string[][] = [];
      for (const c of result.items) {
        const base = customerBase.get(c.id) || [];
        const certs = certMap.get(c.id) || [];
        if (certs.length === 0) continue;  // 筛选时，无证书的客户跳过
        for (const cert of certs) {
          rows.push([
            ...base,
            cert.cert_type || "", cert.standard || "", cert.certificate_no || "",
            cert.issuing_body || "", cert.issue_date || "", cert.valid_until || "",
            cert.cert_status || "", cert.days_until_expiry ?? "",
            cert.is_acknowledged ? "是" : "否"
          ]);
        }
      }
      const csv = ["\uFEFF" + headers.map(esc).join(","), ...rows.map(row => row.map(esc).join(","))].join("\r\n");

      const typeLabel = certTypeFilter ? `_${certTypeFilter}` : "";
      const filename = `单位信息（证书）${typeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
      const safeAscii = `customers_certs${typeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.send(csv);
    } catch (error) { next(error); }
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

  // 获取客户历史认证范围（按 audit_session 历史）
  app.get("/api/customers/:id/history-scope", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const customer = await customerRepository.getById(u.companyId, id);
      if (!customer) throw new NotFoundError("客户不存在");

      // 从 audit_session 拉历史（按客户名匹配）
      const r = await query<{
        id: string;
        audit_type: string;
        standards: string[];
        industry: string | null;
        employee_count: number | null;
        scheduled_date: Date | null;
        created_at: Date;
      }>(
        `SELECT id, audit_type, standards, industry, employee_count, scheduled_date, created_at
         FROM audit_session
         WHERE company_id = $1 AND customer_name = $2
         ORDER BY created_at DESC
         LIMIT 10`,
        [u.companyId, customer.name]
      );

      // 构造认证范围描述
      const scopes = r.rows.map(row => ({
        sessionId: row.id,
        auditType: row.audit_type,
        standards: row.standards || [],
        industry: row.industry,
        employeeCount: row.employee_count,
        scheduledDate: row.scheduled_date,
        createdAt: row.created_at,
        description: row.standards && row.standards.length > 0
          ? `${row.standards.join(" + ")} (${row.audit_type})`
          : `${row.audit_type} 审核`
      }));

      response.json({ data: scopes });
    } catch (error) { next(error); }
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

  // ============================================================
  // 2.0-MVP 认证项目中心
  // ============================================================
  // 【签约主体/服务类型/外协单位】
  app.get("/api/signatories", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listSignatories(u.companyId) });
    } catch (e) { next(e); }
  });

  app.get("/api/service-types", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listServiceTypes(u.companyId) });
    } catch (e) { next(e); }
  });

  app.get("/api/partner-orgs", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listPartnerOrgs(u.companyId) });
    } catch (e) { next(e); }
  });

  app.post("/api/partner-orgs", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.name?.trim()) throw new ValidationError("外协单位名称必填");
      const r = await projectRepo.createPartnerOrg(u.companyId, {
        name: body.name.trim(),
        contactPerson: body.contactPerson?.trim(),
        contactPhone: body.contactPhone?.trim(),
        address: body.address?.trim(),
        notes: body.notes?.trim(),
        createdBy: u.id,
      });
      response.json({ data: r });
    } catch (e) { next(e); }
  });

  // 【认证项目】
  app.get("/api/projects", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const result = await projectRepo.listProjects(u.companyId, {
        status: (request.query.status as any) || "all",
        customerId: request.query.customer_id as string | undefined,
        ownerId: request.query.owner_id as string | undefined,
        overdue: request.query.overdue === "true",
        limit: request.query.limit ? parseInt(request.query.limit as string) : 50,
        offset: request.query.offset ? parseInt(request.query.offset as string) : 0,
      });
      response.json(result);
    } catch (e) { next(e); }
  });

  app.get("/api/projects/stats", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const stats = await projectRepo.getProjectStats(u.companyId);
      response.json({ data: stats });
    } catch (e) { next(e); }
  });

  app.get("/api/projects/overdue", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listOverdueProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  app.get("/api/projects/pending-payment", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listPendingPaymentProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  app.get("/api/projects/pending-cert", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listPendingCertProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  app.get("/api/projects/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const p = await projectRepo.getProject(u.companyId, request.params.id);
      if (!p) throw new NotFoundError("项目");
      response.json({ data: p });
    } catch (e) { next(e); }
  });

  app.post("/api/projects", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.customerId) throw new ValidationError("客户必选");
      if (!body?.serviceTypeId) throw new ValidationError("服务类型必选");
      if (!body?.signatoryId) throw new ValidationError("签约主体必选");

      const project = await projectRepo.createProject({
        companyId: u.companyId,
        customerId: body.customerId,
        serviceTypeId: body.serviceTypeId,
        signatoryId: body.signatoryId,
        partnerOrgId: body.partnerOrgId,
        contactPerson: body.contactPerson,
        contactPhone: body.contactPhone,
        industry: body.industry,
        certificationScope: body.certificationScope,
        certificationStandards: body.certificationStandards,
        riskLevel: body.riskLevel,
        salesSource: body.salesSource,
        contractAmount: body.contractAmount,
        expectedCertDate: body.expectedCertDate,
        notes: body.notes,
        createdBy: u.id,
      });
      response.json({ data: project });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/status", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.status) throw new ValidationError("状态必填");
      if (!body?.reason?.trim()) throw new ValidationError("变更原因必填");

      // P0-B §9：取消时强制要求 cancel_reason（区别于普通 reason）
      if (body.status === "cancelled" && !body?.cancelReason?.trim()) {
        throw new ValidationError("取消项目必须填写取消原因（cancelReason）");
      }

      // P0-B §9：归档要求 archive_reason（区别于普通 reason）
      if (body.status === "project_archived" && !body?.archiveReason?.trim()) {
        throw new ValidationError("归档项目必须填写归档原因（archiveReason）");
      }

      // P0-B §9：拒绝 cancelled → 其他状态（防止"重新启动"）
      const curProj = await projectRepo.getProject(u.companyId, request.params.id);
      if (curProj && curProj.status === "cancelled" && body.status !== "cancelled") {
        throw new ValidationError("已取消的项目不能重新启动");
      }

      const p = await projectRepo.changeProjectStatus(
        u.companyId,
        request.params.id,
        body.status,
        body.reason ?? null,
        u.id,
        u.username ?? null,
        body.clientRequestId  // P0-B §10：幂等键
      );
      response.json({ data: p });
    } catch (e) { next(e); }
  });

  app.get("/api/projects/:id/timeline", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.getProjectTimeline(u.companyId, request.params.id) });
    } catch (e) { next(e); }
  });

  // P0-C §7：事件一致性检查
  app.get("/api/projects/:id/consistency", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const issues = [];
      const projectId = request.params.id;

      // 检查项目是否存在
      const proj = await projectRepo.getProject(u.companyId, projectId);
      if (!proj) {
        return response.status(404).json({ code: "NOT_FOUND", message: "项目不存在" });
      }

      // 检查事件连续性（aggregate_version 应该 1, 2, 3, 4...）
      const events = await query(
        `SELECT aggregate_version, from_status, to_status, created_at
         FROM project_event
         WHERE company_id = $1 AND project_id = $2
         ORDER BY aggregate_version ASC`,
        [u.companyId, projectId]
      );

      let expectedVersion = 1;
      const gaps = [];
      for (const evt of events.rows) {
        if (evt.aggregate_version !== expectedVersion) {
          gaps.push({
            expected: expectedVersion,
            actual: evt.aggregate_version,
            from: evt.from_status,
            to: evt.to_status,
            created_at: evt.created_at
          });
        }
        expectedVersion = evt.aggregate_version + 1;
      }

      // 检查当前 status 是否与最后一个事件的 to_status 一致
      let statusMismatch = null;
      if (events.rows.length > 0) {
        const lastEvent = events.rows[events.rows.length - 1];
        if (lastEvent.to_status !== proj.status) {
          statusMismatch = {
            project_status: proj.status,
            last_event_to_status: lastEvent.to_status,
            last_event_version: lastEvent.aggregate_version
          };
        }
      }

      // 检查 audit_log 同步性
      const auditCount = await query(
        `SELECT count(*) FROM audit_log
         WHERE company_id = $1 AND resource_id = $2 AND action LIKE 'status_change%'`,
        [u.companyId, projectId]
      );

      response.json({
        data: {
          projectId,
          projectCode: proj.projectCode,
          eventCount: events.rows.length,
          auditLogCount: parseInt(auditCount.rows[0].count),
          versionGaps: gaps,
          statusMismatch,
          healthy: gaps.length === 0 && statusMismatch === null
        }
      });
    } catch (e) { next(e); }
  });

  // P0-C §7：事件重放（手动 replay 某事件）
  app.post("/api/projects/:id/events/:eventId/replay", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const projectId = request.params.id;
      const eventId = request.params.eventId;

      // 读取事件
      const evtRes = await query(
        `SELECT * FROM project_event WHERE event_id = $1 AND project_id = $2 AND company_id = $3`,
        [eventId, projectId, u.companyId]
      );
      if (evtRes.rows.length === 0) {
        return response.status(404).json({ code: "NOT_FOUND", message: "事件不存在" });
      }
      const evt = evtRes.rows[0];

      // 检查 projection_sync_status 是否失败
      const projRes = await query(
        `SELECT * FROM projection_sync_status
         WHERE company_id = $1 AND projection_name = $2 AND aggregate_id = $3
         FOR UPDATE`,
        [u.companyId, 'project_workspace', projectId]
      );

      // 写回"重放"事件（不改变 status，仅标记重放）
      const replayEventId = randomUUID();
      await query(
        `INSERT INTO project_event
         (id, event_id, company_id, project_id, from_status, to_status,
          reason, operator_id, operator_name, content,
          aggregate_version, trace_id, parent_event_id, event_type)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9,
                 (SELECT COALESCE(MAX(aggregate_version), 0) + 1 FROM project_event WHERE project_id = $4),
                 $10, $11, 'replay')`,
        [replayEventId, replayEventId, u.companyId, projectId,
         evt.to_status,  // 不改变 from/to
         `Replay of event ${eventId}`,
         u.id, u.username, JSON.stringify({ replayedFrom: eventId }),
         randomUUID(),
         evt.event_id]
      );

      // 更新 projection_sync_status
      if (projRes.rows.length > 0) {
        await query(
          `UPDATE projection_sync_status
           SET status = 'synced', failure_count = 0, failure_reason = NULL,
               last_event_id = $1, last_event_version = $2,
               last_synced_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [replayEventId, evt.aggregate_version, projRes.rows[0].id]
        );
      }

      response.json({
        data: {
          replayedEventId: replayEventId,
          originalEventId: eventId,
          status: 'synced'
        }
      });
    } catch (e) { next(e); }
  });

  // P0-C §8：按服务案件重建派生数据
  app.post("/api/projects/:id/rebuild-derivatives", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const projectId = request.params.id;

      const proj = await projectRepo.getProject(u.companyId, projectId);
      if (!proj) {
        return response.status(404).json({ code: "NOT_FOUND", message: "项目不存在" });
      }

      const rebuildSteps = [];

      // 步骤 1：重新统计收付款总额
      const paymentSum = await query(
        `SELECT
           COALESCE(SUM(CASE WHEN payment_type = 'deposit' THEN received_amount ELSE 0 END), 0) AS deposit,
           COALESCE(SUM(CASE WHEN payment_type = 'balance' THEN received_amount ELSE 0 END), 0) AS balance
         FROM project_payment
         WHERE project_id = $1 AND deleted_at IS NULL`,
        [projectId]
      );
      rebuildSteps.push({
        step: 'payment_summary',
        deposit: parseFloat(paymentSum.rows[0].deposit),
        balance: parseFloat(paymentSum.rows[0].balance)
      });

      // 步骤 2：重新统计整改项
      const correctionCount = await query(
        `SELECT count(*) FROM project_correction
         WHERE project_id = $1 AND deleted_at IS NULL`,
        [projectId]
      );
      rebuildSteps.push({
        step: 'correction_count',
        count: parseInt(correctionCount.rows[0].count)
      });

      // 步骤 3：重新统计资料数
      const docCount = await query(
        `SELECT count(*) FROM project_document
         WHERE project_id = $1 AND deleted_at IS NULL`,
        [projectId]
      );
      rebuildSteps.push({
        step: 'document_count',
        count: parseInt(docCount.rows[0].count)
      });

      // 步骤 4：标记 projection_sync_status 为 synced
      await query(
        `INSERT INTO projection_sync_status
          (company_id, projection_name, aggregate_type, aggregate_id,
           last_synced_at, status, metadata)
         VALUES ($1, 'rebuild', 'certification_project', $2, NOW(), 'synced', $3)
         ON CONFLICT (company_id, projection_name, aggregate_type, aggregate_id)
         DO UPDATE SET last_synced_at = NOW(), status = 'synced', failure_count = 0`,
        [u.companyId, projectId, JSON.stringify({ rebuildSteps, triggeredBy: u.username })]
      );

      response.json({
        data: {
          projectId,
          projectCode: proj.projectCode,
          rebuildSteps,
          status: 'synced',
          rebuiltAt: new Date().toISOString()
        }
      });
    } catch (e) { next(e); }
  });

  // ============== 2.0-MVP 项目子模块路由 ==============

  // ----- 收款记录（首付款/尾款） -----
  app.get("/api/projects/:id/payments", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query(
        `SELECT * FROM project_payment
         WHERE project_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/payments", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.paymentType) throw new ValidationError("paymentType 必填");
      const r = await query(
        `INSERT INTO project_payment
         (company_id, project_id, payment_type, receivable_amount, received_amount,
          amount, due_date, received_date, payment_method, voucher_no, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          u.companyId, request.params.id, body.paymentType,
          body.receivableAmount || body.amount, body.receivedAmount || 0,
          body.amount, body.dueDate || null, body.receivedAt || body.receivedDate || null,
          body.paymentMethod || null, body.voucherNo || null,
          body.status || "pending", body.notes || null, u.id
        ]
      );
      // 更新项目的 paid_amount
      await query(
        `UPDATE certification_project AS p
         SET paid_amount = (
           SELECT COALESCE(SUM(pp.received_amount), 0) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id AND pp.deleted_at IS NULL
         ),
         first_pay_date = (
           SELECT MIN(pp.received_date) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id
             AND pp.payment_type = 'deposit' AND pp.received_date IS NOT NULL AND pp.deleted_at IS NULL
         ),
         final_pay_date = (
           SELECT MIN(pp.received_date) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id
             AND pp.payment_type = 'balance' AND pp.received_date IS NOT NULL AND pp.deleted_at IS NULL
         )
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );

      // P0-B §7：收款 → 建议 + 财务确认（不直接改状态）
      // 创建 action_proposal 供财务确认
      const projRes = await query(
        `SELECT status, project_code, customer_id FROM certification_project WHERE id = $1`,
        [request.params.id]
      );
      const proj = projRes.rows[0];
      if (proj && body.receivedAmount) {
        const targetStatus = body.paymentType === 'deposit' ? 'first_paid' :
                              body.paymentType === 'balance' ? 'cert_pending' :
                              null;
        if (targetStatus) {
          await query(
            `INSERT INTO action_proposal
              (company_id, source_type, source_id, proposal_type, target_entity, target_id,
               from_status, to_status, payload, confidence, status, created_by, created_at, expires_at, metadata)
             VALUES ($1, 'project_payment', $2, 'status_change', 'certification_project', $3,
                     $4, $5, $6, 'high', 'pending', $7, NOW(), NOW() + INTERVAL '7 days', $8)`,
            [
              u.companyId,
              r.rows[0]?.id || null,
              request.params.id,
              proj.status,
              targetStatus,
              JSON.stringify({ amount: body.receivedAmount, paymentType: body.paymentType }),
              u.id,
              JSON.stringify({ projectCode: proj.project_code, requiresFinanceApproval: true })
            ]
          );

          // 自动生成待办（仅提醒，不改状态）
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3);
          const todoTitle = body.paymentType === 'deposit'
            ? `首付款到账待确认：启动项目准备（${proj.project_code}）`
            : `尾款到账待确认：进入待出证（${proj.project_code}）`;
          await query(
            `INSERT INTO todo
              (company_id, owner_user_id, assigned_to, title, description, category,
               source, source_ref, status, priority, due_at, customer_id, tags, metadata)
             VALUES ($1, $2, $2, $3, $4, 'project_followup', 'project_payment',
                     $5, 'pending', 'high', $6, $7, $8, $9)`,
            [
              u.companyId, u.id,
              todoTitle,
              `收到 ${body.paymentType === 'deposit' ? '首' : '尾'}款 ¥${body.receivedAmount}，需财务确认后才推进项目状态`,
              r.rows[0]?.id || null,
              dueDate.toISOString(),
              proj.customer_id,
              JSON.stringify(["project", "pending_finance_confirmation"]),
              JSON.stringify({ projectId: request.params.id, amount: body.receivedAmount, targetStatus, projectCode: proj.project_code })
            ]
          );
        }
      }

      response.status(201).json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  app.patch("/api/projects/:id/payments/:paymentId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      const r = await query(
        `UPDATE project_payment
         SET received_amount = COALESCE($1, received_amount),
             received_date = COALESCE($2, received_date),
             status = COALESCE($3, status),
             notes = COALESCE($4, notes),
             updated_at = NOW()
         WHERE id = $5 AND project_id = $6 AND company_id = $7
         RETURNING *`,
        [body.receivedAmount, body.receivedAt || body.receivedDate, body.status, body.notes,
         request.params.paymentId, request.params.id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("收款记录");
      // 重新汇总 paid_amount
      await query(
        `UPDATE certification_project AS p
         SET paid_amount = (
           SELECT COALESCE(SUM(pp.received_amount), 0) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id AND pp.deleted_at IS NULL
         ),
         first_pay_date = (
           SELECT MIN(pp.received_date) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id
             AND pp.payment_type = 'deposit' AND pp.received_date IS NOT NULL AND pp.deleted_at IS NULL
         ),
         final_pay_date = (
           SELECT MIN(pp.received_date) FROM project_payment AS pp
           WHERE pp.project_id = p.id AND pp.company_id = p.company_id
             AND pp.payment_type = 'balance' AND pp.received_date IS NOT NULL AND pp.deleted_at IS NULL
         )
         WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );

      // 自动推进状态：收到首付款 → first_paid；当前是 contract_signed/contract_archived/first_pay_pending
      const projRes = await query(
        `SELECT status, project_code, customer_id FROM certification_project WHERE id = $1`,
        [request.params.id]
      );
      const proj = projRes.rows[0];
      console.error(`[auto-advance] project=${proj?.project_code} status=${proj?.status} paymentType=${body.paymentType} receivedAmount=${body.receivedAmount}`);
      if (proj && (proj.status === "contract_signed" || proj.status === "contract_archived" || proj.status === "first_pay_pending") && body.receivedAmount) {
        console.error(`[auto-advance] advancing ${proj.project_code} to first_paid`);
        await query(
          `UPDATE certification_project SET status = 'first_paid', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
          [request.params.id, u.companyId]
        );
        await query(
          `INSERT INTO project_event
           (company_id, project_id, from_status, to_status, reason, operator_id, operator_name)
           VALUES ($1, $2, $3::varchar, 'first_paid'::varchar, $4::text, $5, $6::varchar)`,
          [u.companyId, request.params.id, proj.status, `收到首付款 ¥${body.receivedAmount}，系统自动推进`, u.id, u.username ?? "system"]
        );
        // 自动生成待办
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 14);
        await query(
          `INSERT INTO todo
            (company_id, owner_user_id, assigned_to, title, description, category,
             source, source_ref, status, priority, due_at, customer_id, tags, metadata)
           VALUES ($1, $2, $2, $3, $4, 'project_followup', 'project_payment',
                   $5, 'pending', 'medium', $6, $7, $8, $9)`,
          [
            u.companyId, u.id,
            `首付款到账：启动项目准备（${proj.project_code}）`,
            `首付款 ¥${body.receivedAmount} 已到账，请在 14 天内完成资料收集和评审准备`,
            request.params.id,
            dueDate.toISOString(),
            proj.customer_id,
            JSON.stringify(["project", "auto_advance"]),
            JSON.stringify({ projectId: request.params.id, paymentAmount: body.receivedAmount, projectCode: proj.project_code })
          ]
        );
      }

      // 自动推进：收到尾款 → cert_pending → certified 自动链
      if (proj && body.paymentType === "balance" && body.receivedAmount) {
        await query(
          `UPDATE certification_project SET status = 'cert_pending', updated_at = NOW() WHERE id = $1 AND company_id = $2 AND status NOT IN ('certified','completed','cancelled')`,
          [request.params.id, u.companyId]
        );
        await query(
          `INSERT INTO project_event
           (company_id, project_id, from_status, to_status, reason, operator_id, operator_name)
           VALUES ($1, $2, $3::varchar, 'cert_pending'::varchar, $4::text, $5, $6::varchar)`,
          [u.companyId, request.params.id, proj.status, `收到尾款 ¥${body.receivedAmount}，系统自动推进到待出证`, u.id, u.username ?? "system"]
        );
      }

      response.json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  app.delete("/api/projects/:id/payments/:paymentId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      await query(
        `UPDATE project_payment SET deleted_at = NOW()
         WHERE id = $1 AND project_id = $2 AND company_id = $3`,
        [request.params.paymentId, request.params.id, u.companyId]
      );
      response.json({ data: { id: request.params.paymentId, deleted: true } });
    } catch (e) { next(e); }
  });

  // ----- 发票 -----
  app.get("/api/projects/:id/invoices", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query(
        `SELECT * FROM project_invoice
         WHERE project_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/invoices", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.amount) throw new ValidationError("amount 必填");
      const r = await query(
        `INSERT INTO project_invoice
         (company_id, project_id, invoice_type, invoice_no, amount, tax_rate, tax_amount,
          issue_date, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          u.companyId, request.params.id, body.invoiceType || "vat_general",
          body.invoiceNo || null, body.amount, body.taxRate || 6, body.taxAmount || 0,
          body.issueDate || null, body.status || "pending", body.notes || null, u.id
        ]
      );
      // 更新 invoice_amount
      await query(
        `UPDATE certification_project AS p
         SET invoice_amount = (
           SELECT COALESCE(SUM(inv.amount), 0) FROM project_invoice AS inv
           WHERE inv.project_id = p.id AND inv.company_id = p.company_id AND inv.deleted_at IS NULL
         ) WHERE id = $1 AND company_id = $2`,
        [request.params.id, u.companyId]
      );
      response.status(201).json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  // ----- 整改项 -----
  app.get("/api/projects/:id/corrections", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query(
        `SELECT * FROM project_correction
         WHERE project_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/corrections", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.title) throw new ValidationError("title 必填");
      const r = await query(
        `INSERT INTO project_correction
         (company_id, project_id, item_no, title, description, requirement,
          owner_name, responsible_name, due_date, status, review_id, source_document_id,
          created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          u.companyId, request.params.id, body.itemNo || `CA-${Date.now().toString().slice(-6)}`,
          body.title, body.description || null, body.requirement || null,
          body.ownerName || body.responsibleName || null,
          body.responsibleName || body.ownerName || null,
          body.dueDate || null, body.status || "open", body.reviewId || null,
          body.sourceDocumentId || null, u.id
        ]
      );
      response.status(201).json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  app.patch("/api/projects/:id/corrections/:correctionId", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      const r = await query(
        `UPDATE project_correction
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             requirement = COALESCE($3, requirement),
             status = COALESCE($4, status),
             due_date = COALESCE($5, due_date),
             responsible_name = COALESCE($6, responsible_name),
             verified_at = COALESCE($7::timestamptz, verified_at),
             verified_by = COALESCE($8::uuid, verified_by),
             updated_at = NOW()
         WHERE id = $9 AND project_id = $10 AND company_id = $11
         RETURNING *`,
        [
          body.title, body.description, body.requirement, body.status,
          body.dueDate, body.responsibleName,
          body.verifiedAt, body.verifiedBy,
          request.params.correctionId, request.params.id, u.companyId
        ]
      );
      if (r.rows.length === 0) throw new NotFoundError("整改项");
      response.json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  // ----- 资料 -----
  app.get("/api/projects/:id/documents", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query(
        `SELECT * FROM project_document
         WHERE project_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/documents", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.title && !body?.name) throw new ValidationError("title/name 必填");
      const docTitle = body.title || body.name;
      const docFileName = body.file_name || body.fileName || body.name || docTitle;
      const r = await query(
        `INSERT INTO project_document
         (company_id, project_id, title, file_name, document_type, category, version,
          storage_key, mime_type, size_bytes, uploaded_by, uploaded_by_name, uploaded_at, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14) RETURNING *`,
        [
          u.companyId, request.params.id, docTitle, docFileName,
          body.documentType || "other",
          body.category || body.documentType || "other",
          body.version || body.versionNo || 1,
          body.storageKey || null, body.mimeType || null,
          body.sizeBytes || null, u.id, u.username,
          body.status || "active", body.notes || null
        ]
      );
      response.status(201).json({ data: r.rows[0] });
    } catch (e) { next(e); }
  });

  // ----- 评审 -----
  app.get("/api/projects/:id/reviews", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query(
        `SELECT * FROM project_review
         WHERE project_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY scheduled_date DESC NULLS LAST`,
        [request.params.id, u.companyId]
      );
      response.json({ data: r.rows });
    } catch (e) { next(e); }
  });

  app.post("/api/projects/:id/reviews", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.reviewType) throw new ValidationError("reviewType 必填");
      const r = await query(
        `INSERT INTO project_review
         (company_id, project_id, review_type, review_method, scheduled_date,
          scheduled_time, location, reviewer_id, reviewer_name, external_reviewer,
          status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          u.companyId, request.params.id, body.reviewType, body.reviewMethod || "remote",
          body.scheduledDate || null, body.scheduledTime || null, body.location || null,
          body.reviewerId || null, body.reviewerName || null, body.externalReviewer || null,
          body.status || "scheduled", u.id
        ]
      );
      response.status(201).json({ data: r.rows[0] });
    } catch (e) { next(e); }
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
      // V2.0：删除财务项目需 admin
      if (u.role !== "admin") {
        return response.status(403).json({
          code: "FORBIDDEN",
          message: "❌ 权限不足：删除财务项目需要管理员权限。请联系管理员。",
          requestId: request.id
        });
      }
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
      // V2.0：删除交易需 admin
      if (u.role !== "admin") {
        return response.status(403).json({
          code: "FORBIDDEN",
          message: "❌ 权限不足：删除交易需要管理员权限。请联系管理员。",
          requestId: request.id
        });
      }
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
        endDate: (request.query.end_date as string) || "",
        // V2.0：dateField 默认 trans_month（业务归属月份），传 trans_date 则用制单日期
        dateField: (request.query.date_field as "trans_date" | "trans_month") || "trans_month"
      });
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // V2.0：按月汇总（用 trans_month 分组，用于趋势图）
  app.get("/api/finance/summary/by-month", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const startDate = (request.query.start_date as string) || "2024-01-01";
      const endDate = (request.query.end_date as string) || "2025-12-31";
      const result = await query<{ month: string; type: string; total: string; count: string }>(
        `SELECT TO_CHAR(trans_month, 'YYYY-MM') AS month, type,
                COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM finance_transaction
         WHERE company_id = $1 AND deleted_at IS NULL
           AND trans_month >= $2 AND trans_month <= $3
         GROUP BY trans_month, type
         ORDER BY trans_month, type`,
        [u.companyId, startDate, endDate]
      );
      response.json({
        data: result.rows.map((r) => ({
          month: r.month,  // YYYY-MM 字符串
          type: r.type,
          total: Number(r.total),
          count: Number(r.count)
        }))
      });
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

      // 🎯 联动：跟进到关键阶段时自动创建/同步 certification_project
      // 映射：quoted→lead, contract_review→contract_pending, implementing→contract_signed,
      //      correcting→correcting, cert_pending→cert_pending, certified→certified, completed→completed
      let syncedProject = null;
      const STAGE_TO_PROJECT_STATUS: Record<string, string> = {
        quoted: "lead",
        contract_review: "contract_pending",
        implementing: "contract_signed",
        correcting: "correcting",
        cert_pending: "cert_pending",
        certified: "certified",
        completed: "completed"
      };
      if (STAGE_TO_PROJECT_STATUS[body.stage as string] && updated.customerId) {
        try {
          syncedProject = await syncFollowUpToProject({
            companyId: u.companyId,
            customerId: updated.customerId,
            customerName: updated.customerName || "(未知客户)",
            serviceTypeCode: updated.certificationType === "QES" || updated.certificationType === "QEs" ? "bundle"
                            : updated.certificationType === "Q" ? "certification"
                            : "certification",
            targetStatus: STAGE_TO_PROJECT_STATUS[body.stage as string],
            expectedAmount: updated.expectedAmount ? Number(updated.expectedAmount) : undefined,
            contractAmount: updated.contractAmount ? Number(updated.contractAmount) : undefined,
            notes: `从客户跟进自动创建（跟进 ID: ${request.params.id}, 阶段: ${body.stage}）`,
            operatorId: u.id,
            year: updated.year
          });
        } catch (e) {
          console.warn("[sync-followup-project] failed (non-fatal):", e instanceof Error ? e.message : e);
        }
      }

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

      response.json({ data: updated, auditPlan, syncedProject });
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

  // ⭐ 智能提取：从转写文本自动提取 todo / follow_up / knowledge（一次调用LLM）
  app.post("/api/yoooclaw/auto-extract", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      const recordingId = (body.recordingId || "").trim();
      const recordingName = (body.recordingName || "").trim();
      const transcript = (body.transcript || "").trim();
      const durationSec = body.durationSec ? Number(body.durationSec) : null;

      if (!recordingId) throw new ValidationError("recordingId 必填");
      if (!transcript) throw new ValidationError("transcript 必填");

      console.log(`[yoooclaw] auto-extract recording=${recordingId} name=${recordingName} len=${transcript.length}`);

      const result = await processRecordingEndToEnd({
        companyId: u.companyId,
        userId: u.id,
        recordingId,
        recordingName,
        transcript,
        durationSec
      });

      response.json({
        data: {
          recordingId,
          routes: {
            todos: result.todos,
            follow_ups: result.followUps,
            knowledge: result.knowledge ? "saved" : "empty"
          },
          summary: {
            todosCount: result.todos.length,
            followUpsCount: result.followUps.length,
            knowledgeExtracted: !!result.knowledge
          },
          knowledge: result.knowledge,
          extractionFailed: result.extractionFailed
        }
      });
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
        document_id: string | null;
        document_title: string | null;
        doc_code: string | null;
        review_type: string;
        proposed_content: string;
        reason: string;
        status: string;
        submitter: string;
        submitter_display: string | null;
        reviewed_by: string | null;
        reviewer_display: string | null;
        reviewed_at: Date | null;
        review_note: string | null;
        new_version: number | null;
        created_at: Date;
      }>(
        `SELECT kr.id, kr.document_id,
                kd.title AS document_title, kd.doc_code,
                kr.review_type,
                CASE WHEN kr.review_type = 'upload'
                     THEN COALESCE((kr.proposed_content::json->>'title'), kr.review_note, '待审核上传文件')
                     ELSE kr.reason END AS reason,
                CASE WHEN kr.review_type = 'upload'
                     THEN COALESCE((kr.proposed_content::json->>'title'), '待审核上传文件')
                     ELSE kd.title END AS document_title,
                kr.proposed_content, kr.status,
                kr.submitted_by, su.display_name AS submitter_display,
                kr.reviewed_by, ru.display_name AS reviewer_display,
                kr.reviewed_at, kr.review_note, kr.new_version, kr.created_at
         FROM knowledge_review kr
         LEFT JOIN knowledge_document kd ON kr.document_id = kd.id
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
        note: z.string().max(1000).optional(),
        editedContent: z.string().max(500_000).optional()  // V2.0：审核员编辑后的内容
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

      const reviewType = review.rows[0].review_type;

      if (parsed.data.action === "approve") {
        if (reviewType === "correction") {
          // 纠正类：创建新版本并替换主表内容
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
            [u.companyId, review.rows[0].document_id, newVersion,
             review.rows[0].proposed_content,
             parsed.data.note ?? "管理员批准的用户纠正", u.id, reviewId]
          );
          await query(
            `UPDATE knowledge_document SET content_text = $1, updated_at = NOW() WHERE id = $2`,
            [review.rows[0].proposed_content, review.rows[0].document_id]
          );
          await query(
            `UPDATE knowledge_review
               SET status = 'applied', reviewed_by = $1, reviewed_at = NOW(),
                   review_note = $2, new_version = $3, updated_at = NOW()
             WHERE id = $4`,
            [u.id, parsed.data.note ?? "已批准并应用", newVersion, reviewId]
          );
          response.json({ data: { ok: true, action: "approve", newVersion, applied: true } });

        } else if (reviewType === "upload") {
          // 上传类：从 proposed_content JSON 中解析元数据，创建知识文档
          let meta: { title: string; category: string; fileType: string; tags: string[]; content: string; sourceName: string };
          try {
            meta = JSON.parse(review.rows[0].proposed_content);
          } catch {
            throw new ValidationError("上传审核数据格式错误，无法解析");
          }
          // V2.0：如果审核员编辑了内容，覆盖
          if (parsed.data.editedContent) {
            try {
              const edited = JSON.parse(parsed.data.editedContent);
              meta = {
                ...meta,
                title: edited.title ?? meta.title,
                category: edited.category ?? meta.category,
                tags: edited.tags ?? meta.tags,
                content: edited.content ?? meta.content,
                sourceName: edited.sourceName ?? meta.sourceName
              };
            } catch (parseErr) {
              // 如果 editedContent 不是 JSON（correction 类型的纯文本编辑），当作纯文本
              meta.content = parsed.data.editedContent;
            }
          }
          const newDocId = randomUUID();
          await knowledgeRepository.add(u.companyId, {
            id: newDocId,
            title: meta.title,
            category: meta.category,
            sourceName: meta.sourceName,
            fileType: meta.fileType,
            content: meta.content,
            createdAt: new Date().toISOString(),
            tags: meta.tags
          });
          // V2.0 修复：verify 新文档确实存在（避免 FK 错误）
          const verifyRow = await query<{ id: string }>(
            `SELECT id FROM knowledge_document WHERE company_id = $1 AND doc_code = $2`,
            [u.companyId, newDocId]
          );
          if (verifyRow.rows.length === 0) {
            throw new ValidationError("入库失败：文档未持久化，请重试");
          }
          const realNewDocId = verifyRow.rows[0].id;
          // 更新审核记录，关联新建的文档
          const finalNote = parsed.data.editedContent
            ? `${parsed.data.note ?? "已批准并入库"}（审核员编辑）`
            : parsed.data.note ?? "已批准并入库";
          await query(
            `UPDATE knowledge_review
               SET status = 'applied', reviewed_by = $1, reviewed_at = NOW(),
                   review_note = $2, new_version = 1, updated_at = NOW(),
                   document_id = $3
             WHERE id = $4`,
            [u.id, finalNote, realNewDocId, reviewId]
          );
          response.json({ data: { ok: true, action: "approve", newVersion: 1, applied: true, documentId: newDocId } });
        } else {
          throw new ValidationError("不支持的审核类型: " + reviewType);
        }
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
        // 首页显示认证机构信息（固定）
        companyName: "华中国际认证检验集团有限公司",
        clientName: parsed.data.companyName,
        projectName: "认证证书报价",
        documentTitle: "认证证书报价单",
        version: "v1.0",
        preparedBy: "刘军",
        agencyAddress: "银川国智知识产权服务园201室",
        agencyContact: "13195086656",
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
        message: error.code === "LIMIT_FILE_SIZE" ? "文件不能超过 200MB" : error.message,
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
    const err = error as any;
    request.log.error({
      msg: err?.message,
      stack: err?.stack?.slice(0, 800),
      name: err?.name
    }, "Unhandled request error");
    console.error("[INTERNAL_ERROR]", err?.message, err?.stack?.slice(0, 800));
    response.status(500).json({
      code: "INTERNAL_ERROR",
      message: err?.message || "服务处理失败，请稍后重试",
      requestId: request.id
    });
  });

  // ===== 页面助手（Agent + Tools）=====
  app.post("/api/assistant/chat", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.message?.trim()) throw new ValidationError("message 必填");
      const result = await handleChat(
        {
          message: body.message.trim(),
          history: body.history || [],
          context: body.context || {}
        },
        { companyId: u.companyId, userId: u.id, userName: u.username ?? undefined }
      );
      response.json({ data: result });
    } catch (e) { next(e); }
  });

  // 确认执行工具（用户说"确认"后调用）
  app.post("/api/assistant/confirm", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const body = request.body as any;
      if (!body?.toolName) throw new ValidationError("toolName 必填");
      const result = await handleToolConfirmation(
        body.toolName,
        body.args || {},
        { companyId: u.companyId, userId: u.id, userName: u.username ?? undefined }
      );
      response.json({ data: result });
    } catch (e) { next(e); }
  });

  // 获取可用工具列表
  app.get("/api/assistant/tools", async (_request, response) => {
    response.json({ data: ASSISTANT_TOOLS });
  });

  // ============================================================
  // V2.0 系统基础数据 API（系统枚举值 → 系统基础数据）
  // （签约主体 / 外协单位 / 风险等级）
  // ============================================================

  // 通用枚举值 CRUD
  const enumCrud = (
    path: string,
    table: "signing_entity" | "partner_cert_unit" | "risk_level",
    fields: string[],
    codeField: string | null
  ) => {
    // V2.0：admin 权限拦截 middleware（直接返回 403 JSON，不 throw）
    const requireAdmin = (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try {
        const u = getUserFromReq(request);
        if (u.role !== "admin") {
          response.status(403).json({
            code: "FORBIDDEN",
            message: "系统基础数据修改需要管理员权限。请联系管理员获取授权。",
            requestId: request.id
          });
          return;
        }
        next();
      } catch (e: any) {
        response.status(500).json({
          code: "INTERNAL_ERROR",
          message: e?.message || "权限检查失败",
          requestId: request.id
        });
      }
    };
    // 列表
    app.get(`/api${path}`, async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const orderField = codeField ?? "created_at";
        const result = await query<any>(
          `SELECT * FROM ${table}
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY ${orderField}`,
          [u.companyId]
        );
        response.json({ data: result.rows });
      } catch (e) { next(e); }
    });

    // 创建（V2.0：需要管理员权限）
    app.post(`/api${path}`, requireAdmin, async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const body = request.body as any;
        if (!body?.name && !body?.label) {
          throw new ValidationError("name/label 必填");
        }
        // 字段顺序：[company_id, created_by, ...其他]
        const insertFields = ["company_id", "created_by", ...fields.filter(f => f !== "company_id" && f !== "created_by")];
        // 补充默认值：status 默认为 active
        const values: any[] = insertFields.map((f) => {
          if (f === "company_id") return u.companyId;
          if (f === "created_by") return u.id;
          if (f === "status" && body[f] === undefined) return "active";
          if (f === "multiplier" && body[f] === undefined) return 1.0;
          if (f === "sort_order" && body[f] === undefined) return 0;
          return body[f];
        });
        const cols = insertFields.join(", ");
        const placeholders = insertFields.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
        const result = await query<any>(sql, values);
        response.json({ data: result.rows[0] });
      } catch (e) { next(e); }
    });

    // 更新（V2.0：需要管理员权限）
    app.put(`/api${path}/:id`, requireAdmin, async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const body = request.body as any;
        const updates: string[] = [];
        const values: any[] = [];
        let idx = 3;
        for (const f of fields) {
          if (f === "company_id" || f === "created_by") continue;
          if (body[f] !== undefined) {
            updates.push(`${f} = $${idx}`);
            values.push(body[f]);
            idx++;
          }
        }
        if (updates.length === 0) throw new ValidationError("无字段更新");
        const sql = `UPDATE ${table} SET ${updates.join(", ")}, updated_at = NOW()
                     WHERE company_id = $1 AND id = $2 RETURNING *`;
        const result = await query<any>(sql, [u.companyId, request.params.id, ...values]);
        response.json({ data: result.rows[0] });
      } catch (e) { next(e); }
    });

    // 删除（软删，V2.0：需要管理员权限）
    app.delete(`/api${path}/:id`, requireAdmin, async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        await query(
          `UPDATE ${table} SET deleted_at = NOW() WHERE company_id = $1 AND id = $2`,
          [u.companyId, request.params.id]
        );
        response.json({ data: { id: request.params.id, deleted: true } });
      } catch (e) { next(e); }
    });
  };

  // 签约主体（signing_entity）：code/short_name/contact_person/...
  enumCrud("/system-enum/signing-entities", "signing_entity", [
    "company_id", "entity_code", "name", "short_name",
    "contact_person", "contact_phone", "address", "status", "notes", "created_by"
  ], "entity_code");

  // 外协单位（partner_cert_unit）
  enumCrud("/system-enum/partners", "partner_cert_unit", [
    "company_id", "name", "contact_name", "contact_phone",
    "address", "status", "remark", "created_by"
  ], null);

  // 风险等级（risk_level）
  enumCrud("/system-enum/risk-levels", "risk_level", [
    "company_id", "code", "label", "description",
    "auditor_level", "multiplier", "sort_order", "status", "created_by"
  ], "sort_order");

  // ============== V2.0：审核员档案管理 ==============
  // 与 enumCrud 不同：独立表，独立字段，独立业务逻辑
  // auditorRepo 已在 createApp 顶部创建

  // 列出审核员
  app.get("/api/auditors", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const status = (request.query.status as string) || "";
      const level = (request.query.level as string) || "";
      const organization = (request.query.organization as string) || "";
      const specialty = (request.query.specialty as string) || "";
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "100"), 1), 500);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const result = await auditorRepo.list(u.companyId, {
        q: q.trim(),
        status: status || undefined,
        level: level || undefined,
        organization: organization || undefined,
        specialty: specialty || undefined,
        limit,
        offset
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) { next(error); }
  });

  // 统计
  app.get("/api/auditors/stats", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const stats = await auditorRepo.getStats(u.companyId);
      response.json({ data: stats });
    } catch (error) { next(error); }
  });

  // V2.0：认证证书预警 API
  app.get("/api/certificates/expiring", async (request, response, next) => {
    try {
      const warningDays = Number((request.query.warning_days as string) || "180");
      const criticalDays = Number((request.query.critical_days as string) || "60");
      const includeNormal = (request.query.include_normal as string) !== "0";  // 默认含"正常"
      
      // V2.0：通过 vw_certificate_expiry_alerts 视图查询（含 4 阶段信息）
      // 默认返回全部证书，前端可筛选
      const whereClause = includeNormal 
        ? "" 
        : "WHERE urgency_level != '正常'";
      
      const r = await query(
        `SELECT * FROM vw_certificate_expiry_alerts ${whereClause}`
      );
      // 统计（基于全部证书视图，包含正常）
      const allStats = await query(`SELECT urgency_level, COUNT(*) AS cnt FROM vw_certificate_expiry_alerts GROUP BY urgency_level`);
      const statsMap: Record<string, number> = {};
      for (const row of allStats.rows) {
        statsMap[row.urgency_level] = Number(row.cnt);
      }
      
      const stats = {
        total: Object.values(statsMap).reduce((a: number, b: number) => a + b, 0),
        expired: statsMap['已过期'] || 0,
        recert_critical: statsMap['再认证紧急'] || 0,
        recert_warning: statsMap['再认证预警'] || 0,
        expiring_soon: statsMap['即将到期'] || 0,
        normal: statsMap['正常'] || 0,
        warning_days: warningDays,
        critical_days: criticalDays
      };
      response.json({ data: { stats, certificates: r.rows } });
    } catch (error) { next(error); }
  });

  // V2.0：单证书详情
  app.get("/api/certificates/:id", async (request, response, next) => {
    try {
      const r = await query(
        `SELECT pc.*, cp.customer_name, cp.project_code
         FROM project_certificate pc
         JOIN certification_project cp ON cp.id = pc.project_id
         WHERE pc.id = $1 AND pc.deleted_at IS NULL`,
        [request.params.id]
      );
      if (r.rows.length === 0) throw new NotFoundError("证书");
      response.json({ data: r.rows[0] });
    } catch (error) { next(error); }
  });

  // V2.0：标记证书为"已处理"（仅 status 备注，不删除）
  app.patch("/api/certificates/:id/acknowledge", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const note = ((request.body as any)?.note || "") as string;
      const userId = (u as any).userId || (u as any).id || null;

      // 1. 查询证书信息（含客户 + 阶段）
      const certInfo = await query(
        `SELECT pc.id, pc.cert_type, pc.certificate_no, pc.valid_until,
                cp.customer_id, cp.customer_name, cp.company_id
         FROM project_certificate pc
         JOIN certification_project cp ON cp.id = pc.project_id
         WHERE pc.id = $1 AND pc.deleted_at IS NULL`,
        [request.params.id]
      );
      if (certInfo.rows.length === 0) throw new NotFoundError("证书");
      const cert = certInfo.rows[0];

      // 2. 查询阶段信息（决定模式：推送代办 vs 隐藏）
      const stageInfo = await query(
        `SELECT current_stage, next_stage, next_stage_date, days_until_next, urgency_level
         FROM certificate_next_stage($1::date, $2::date, $3)`,
        [(await query(`SELECT issue_date FROM project_certificate WHERE id = $1`, [request.params.id])).rows[0]?.issue_date,
         cert.valid_until,
         cert.cert_type]
      );
      const stage = stageInfo.rows[0] || {
        current_stage: null, next_stage: '再认证', urgency_level: 'NORMAL'
      };

      // 3. 推送代办（如果是紧急/已过期/再认证紧急 → 创建 todo）
      //    紧急模式 = RENEW + CRITICAL → 推送代办
      const shouldPushTodo = ['RENEW', 'CRITICAL'].includes(stage.urgency_level);
      let todoId: string | null = null;

      if (shouldPushTodo) {
        // 安全格式化日期为 YYYY-MM-DD
        function toDateOnly(v: any): string {
          if (!v) return '';
          if (typeof v === 'string') return v.split('T')[0].split(' ')[0];
          if (v instanceof Date) {
            const y = v.getFullYear();
            const m = String(v.getMonth() + 1).padStart(2, '0');
            const d = String(v.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
          }
          return String(v).split('T')[0];
        }
        const rawDate = toDateOnly(stage.next_stage_date || cert.valid_until);
        const dueDate = (stage.days_until_next && stage.days_until_next < 0)
          ? new Date().toISOString()
          : (rawDate ? new Date(rawDate + 'T09:00:00').toISOString() : new Date().toISOString());
        const priority = stage.urgency_level === 'RENEW' ? 'urgent' : 'high';

        const todoInsert = await query(
          `INSERT INTO todo (
            company_id, owner_user_id, title, description,
            category, source, source_ref, due_at, remind_at,
            status, priority, customer_id, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
          RETURNING id`,
          [
            cert.company_id,
            userId,
            `🔔 证书${stage.next_stage || '再认证'}：${cert.customer_name} - ${cert.cert_type}`,
            `客户【${cert.customer_name}】\n` +
            `当前阶段：${stage.current_stage || '已过期'}\n` +
            `下一阶段：${stage.next_stage || '再认证'}\n` +
            `证书号：${cert.certificate_no}\n` +
            `证书类型：${cert.cert_type}\n` +
            `有效期至：${cert.valid_until}\n\n` +
            `已由 ${(u as any).username || 'admin'} 推送处理。${note ? '\n备注：' + note : ''}`,
            'general',
            'cert_acknowledge',
            request.params.id,
            dueDate,
            new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            'pending',
            priority,
            cert.customer_id,
            JSON.stringify({
              cert_id: cert.id,
              next_stage: stage.next_stage,
              valid_until: cert.valid_until,
              urgency_level: stage.urgency_level,
              acknowledged_by: userId
            })
          ]
        );
        todoId = todoInsert.rows[0]?.id || null;
      }

      // 4. 标记证书为已确认（会被视图过滤掉）
      await query(
        `UPDATE project_certificate
         SET acknowledged_at = NOW(),
             acknowledged_by = $1,
             acknowledged_note = $2
         WHERE id = $3 AND deleted_at IS NULL`,
        [userId, note || null, request.params.id]
      );

      response.json({
        data: {
          id: request.params.id,
          acknowledged: true,
          todo_created: !!todoId,
          mode: shouldPushTodo ? 'push_todo' : 'hidden',
          next_stage: stage.next_stage,
          urgency_level: stage.urgency_level
        }
      });
    } catch (error) { next(error); }
  });

  // V2.0：批量确认证书
  app.post("/api/certificates/acknowledge-batch", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const { certificate_ids, note } = (request.body as any) || {};
      const userId = (u as any).userId || (u as any).id || null;
      
      if (!Array.isArray(certificate_ids) || certificate_ids.length === 0) {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ certificate_ids 必须是非空数组" });
        return;
      }
      
      let pushCount = 0, hiddenCount = 0;
      
      for (const certId of certificate_ids) {
        try {
          // 查询证书
          const certInfo = await query(
            `SELECT pc.id, pc.cert_type, pc.certificate_no, pc.valid_until, pc.issue_date,
                    cp.customer_id, cp.customer_name, cp.company_id
             FROM project_certificate pc
             JOIN certification_project cp ON cp.id = pc.project_id
             WHERE pc.id = $1 AND pc.deleted_at IS NULL`,
            [certId]
          );
          if (certInfo.rows.length === 0) continue;
          const cert = certInfo.rows[0];
          
          // 阶段判断
          const stageInfo = await query(
            `SELECT current_stage, next_stage, next_stage_date, days_until_next, urgency_level
             FROM certificate_next_stage($1::date, $2::date, $3)`,
            [cert.issue_date, cert.valid_until, cert.cert_type]
          );
          const stage = stageInfo.rows[0] || { urgency_level: 'NORMAL' };
          
          const shouldPushTodo = ['RENEW', 'CRITICAL'].includes(stage.urgency_level);
          
          // 推送 todo
          if (shouldPushTodo) {
            function toDateOnly(v: any): string {
              if (!v) return '';
              if (typeof v === 'string') return v.split('T')[0].split(' ')[0];
              if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth() + 1).padStart(2, '0');
                const d = String(v.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
              }
              return String(v).split('T')[0];
            }
            const rawDate = toDateOnly(stage.next_stage_date || cert.valid_until);
            const dueDate = (stage.days_until_next && stage.days_until_next < 0)
              ? new Date().toISOString()
              : (rawDate ? new Date(rawDate + 'T09:00:00').toISOString() : new Date().toISOString());
            const priority = stage.urgency_level === 'RENEW' ? 'urgent' : 'high';
            
            await query(
              `INSERT INTO todo (
                company_id, owner_user_id, title, description,
                category, source, source_ref, due_at, remind_at,
                status, priority, customer_id, metadata, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
              [
                cert.company_id, userId,
                `🔔 证书${stage.next_stage || '再认证'}：${cert.customer_name} - ${cert.cert_type}`,
                `客户【${cert.customer_name}】\n` +
                `当前阶段：${stage.current_stage || '已过期'}\n` +
                `下一阶段：${stage.next_stage || '再认证'}\n` +
                `证书号：${cert.certificate_no}\n` +
                `证书类型：${cert.cert_type}\n` +
                `有效期至：${cert.valid_until}\n\n` +
                `批量推送于 ${(u as any).username || 'admin'}。${note ? '\n备注：' + note : ''}`,
                'general', 'cert_acknowledge', certId, dueDate,
                new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
                'pending', priority, cert.customer_id,
                JSON.stringify({
                  cert_id: cert.id, urgency_level: stage.urgency_level, batch: true
                })
              ]
            );
            pushCount++;
          } else {
            hiddenCount++;
          }
          
          // 标记已确认
          await query(
            `UPDATE project_certificate
             SET acknowledged_at = NOW(), acknowledged_by = $1, acknowledged_note = $2
             WHERE id = $3 AND deleted_at IS NULL`,
            [userId, note || null, certId]
          );
        } catch (innerErr) {
          // 单个失败不影响其他
          console.error(`acknowledge failed for cert ${certId}:`, innerErr);
        }
      }
      
      response.json({
        data: {
          total: certificate_ids.length,
          push_count: pushCount,
          hidden_count: hiddenCount,
          success: true
        }
      });
    } catch (error) { next(error); }
  });

  // V2.0：撤销确认（恢复显示）
  app.post("/api/certificates/:id/unacknowledge", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      
      const r = await query(
        `UPDATE project_certificate
         SET acknowledged_at = NULL, acknowledged_by = NULL, acknowledged_note = NULL
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`,
        [request.params.id]
      );
      
      if (r.rows.length === 0) throw new NotFoundError("证书");
      
      // 删除由 acknowledge 创建的关联 todo（清理冗余）
      await query(
        `DELETE FROM todo 
         WHERE source = 'cert_acknowledge' 
           AND source_ref = $1
           AND status = 'pending'`,
        [request.params.id]
      );
      
      response.json({ data: { id: request.params.id, unacknowledged: true } });
    } catch (error) { next(error); }
  });

  // 单个审核员
  // V2.0：获取证书图片（base64 形式，便于前端预览）
    // 安全：只允许 /mnt/renz/ 下的文件
    // 注意：必须放在 /api/auditors/:id 路由之前，否则会被 id 路由拦截
    app.get("/api/auditors/cert-image", async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const filePath = (request.query.path as string) || "";
        if (!filePath) throw new ValidationError("文件路径必填");
        // 安全检查：必须以 /mnt/renz/ 开头（避免任意文件读取）
        if (!filePath.startsWith("/mnt/renz/")) {
          response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅允许访问 /mnt/renz/ 下的证书图片" });
          return;
        }
        const fsPromises = await import("fs/promises");
        try {
          await fsPromises.access(filePath);
        } catch {
          throw new NotFoundError("证书图片");
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp"
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        const buffer = await fsPromises.readFile(filePath);
        const base64 = buffer.toString("base64");
        response.json({
          data: {
            path: filePath,
            mime,
            ext,
            size: buffer.length,
            base64: `data:${mime};base64,${base64}`
          }
        });
      } catch (error) { next(error); }
    });

    app.get("/api/auditors/:id", async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const item = await auditorRepo.get(u.companyId, request.params.id);
        if (!item) throw new NotFoundError("审核员");
        response.json({ data: item });
      } catch (error) { next(error); }
    });

  // 创建审核员
  app.post("/api/auditors", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以新增审核员档案" });
        return;
      }
      const body = request.body as Record<string, unknown>;
      if (!body.name) throw new ValidationError("姓名必填");
      const created = await auditorRepo.create(u.companyId, {
        name: String(body.name),
        code: body.code as string || null,
        gender: body.gender as string || null,
        idNumber: body.idNumber as string || null,
        phone: body.phone as string || null,
        email: body.email as string || null,
        organization: body.organization as string || null,
        department: body.department as string || null,
        position: body.position as string || null,
        level: (body.level as string) || "intermediate",
        specialties: Array.isArray(body.specialties) ? body.specialties as string[] : [],
        certNo: body.certNo as string || null,
        certIssueDate: body.certIssueDate as string || null,
        certExpiry: body.certExpiry as string || null,
        certStatus: (body.certStatus as string) || "active",
        dailyRate: Number(body.dailyRate ?? 0),
        expertType: (body.expertType as string) || "auditor",
        region: body.region as string || null,
        languages: Array.isArray(body.languages) ? body.languages as string[] : [],
        bio: body.bio as string || null,
        notes: body.notes as string || null,
        status: (body.status as string) || "active",
        tags: Array.isArray(body.tags) ? body.tags as string[] : [],
        source: (body.source as string) || "manual",
        sourcePath: body.sourcePath as string || null
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  // 更新审核员
  app.patch("/api/auditors/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以修改审核员档案" });
        return;
      }
      const updated = await auditorRepo.update(u.companyId, request.params.id, request.body);
      if (!updated) throw new NotFoundError("审核员");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  // 停用/启用
  app.patch("/api/auditors/:id/status", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以停用审核员" });
        return;
      }
      const body = request.body as { status?: string };
      if (!body.status || !["active", "inactive", "retired"].includes(body.status)) {
        throw new ValidationError("status 必须是 active / inactive / retired");
      }
      const updated = await auditorRepo.setStatus(u.companyId, request.params.id, body.status as any);
      if (!updated) throw new NotFoundError("审核员");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  // 软删除
  app.delete("/api/auditors/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以删除审核员" });
        return;
      }
      const ok = await auditorRepo.delete(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("审核员");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // V2.0：OCR 识别证书图片
  app.post("/api/auditors/ocr", upload.single("file"), async (request, response, next) => {
    try {
      const file = request.file;
      if (!file) throw new ValidationError("请上传证书图片");
      const ext = path.extname(file.originalname).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".pdf"].includes(ext)) {
        throw new ValidationError("只支持 PNG/JPG/PDF 格式");
      }
      // multer memoryStorage：把 buffer 写临时文件
      const tmpPath = `/tmp/ocr_${Date.now()}${ext}`;
      const fsPromises = await import("fs/promises");
      await fsPromises.writeFile(tmpPath, file.buffer);
      const result = await ocrModule.ocrCertificate({
        filePath: tmpPath,
        fileName: file.originalname
      });
      // 清理
      try { await fsPromises.unlink(tmpPath); } catch {}
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // V2.0：扫描并 OCR 单个审核员的所有证书图片（按 file 路径）
  app.post("/api/auditors/:id/ocr-all", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可触发 OCR" });
        return;
      }
      const auditor = await auditorRepo.get(u.companyId, request.params.id);
      if (!auditor) throw new NotFoundError("审核员");
      const certs = auditor.certificates || [];
      const results: any[] = [];
      for (const c of certs) {
        const file = c.file;
        if (!file) continue;
        const fsPromises = await import("fs/promises");
        try {
          await fsPromises.access(file);
          const r = await ocrModule.ocrCertificate({ filePath: file, fileName: c.source_name });
          results.push({ source_name: c.source_name, file, ...r });
        } catch (e: any) {
          results.push({ source_name: c.source_name, file, error: e?.message || "文件不存在" });
        }
      }
      response.json({ data: { total: certs.length, results } });
    } catch (error) { next(error); }
  });

  return app;
}
