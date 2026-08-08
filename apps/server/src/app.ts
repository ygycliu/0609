import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import { config } from "./config.js";
import { ConsultationService } from "./consultations/consultation.service.js";
import { extractDocumentText } from "./documents/document.service.js";
import { ConsultationRepository } from "./consultations/consultation.repository.js";
import { QuoteRepository } from "./certification/quote.repository.js";
import { CustomerRepository } from "./customers/customer.repository.js";
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
import { query } from "./db/pool.js";
import type { EmployeeRole, ModelProvider } from "./shared/types.js";
import { generateQuote, getAvailableCertifications, INDUSTRY_OPTIONS, RISK_LEVEL_OPTIONS } from "./certification/quote.service.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const consultationSchema = z.object({
  role: z.enum(["consultant", "solution-engineer", "trainer", "knowledge-assistant", "certification-expert"]),
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
      response.json({ data: await customerRepository.list(u.companyId) });
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
      const quoteSchema = z.object({
        companyName: z.string().trim().min(1).max(100),
        companyContext: z.string().trim().max(1000).optional().default("")
      });
      const parsed = quoteSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const quoteParsed = z.object({
        companyName: z.string(),
        industry: z.string(),
        employeeCount: z.number(),
        certifications: z.array(z.string()),
        sizeFactor: z.number(),
        sizeTier: z.string(),
        subtotal: z.number(),
        afterSizeFactor: z.number(),
        bundleDiscount: z.number(),
        bundleTier: z.string(),
        initialPrice: z.number(),
        supervisionPrice: z.number(),
        priceIncludes: z.array(z.string()),
        priceExcludes: z.array(z.string()),
        estimatedAuditDays: z.number(),
        generatedAt: z.string()
      }).safeParse(request.body.quote);
      if (!quoteParsed.success) {
        throw new ValidationError("报价数据格式无效");
      }
      const q = quoteParsed.data;
      // 简化版：使用 generateQuoteDocx + 客户端传来的详细人日数据
      const buffer = await generateQuoteDocx({
        ...q,
        certifications: q.certifications.map((id: string) => ({
          certId: id,
          certName: id,
          basePrice: 0,
          industryFactor: 1,
          adjustedBase: 0,
          initialAuditDays: 0,
          supervisionAuditDays: 0,
          recertificationAuditDays: 0,
          auditorLevel: "中级" as const
        }))
      }, {
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

  // ====== 飞书集成 ======
  app.post("/feishu/events", handleEvent);
  app.post("/api/feishu/push", pushMessage);
    } catch (error) {
      next(error);
    }
  });

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
