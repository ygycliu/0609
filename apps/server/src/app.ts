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
import { createFilesRouter } from "./routes/files.routes.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createProjectsRouter } from "./routes/projects.routes.js";
import { createCustomersRouter } from "./routes/customers.routes.js";
import { createCertificationRouter } from "./routes/certification.routes.js";
import { createCertificatesRouter } from "./routes/certificates.routes.js";
import { createAuditorRouter } from "./routes/auditor.routes.js";
import { createAuditorsRouter } from "./routes/auditors.routes.js";
import { createConsultationsRouter } from "./routes/consultations.routes.js";
import { createFollowUpRouter, createAuditTemplatesRouter } from "./routes/follow_up.routes.js";
import { ConsultationService } from "./consultations/consultation.service.js";
import { extractDocumentText } from "./documents/document.service.js";
import { ofdBufferToDocxBuffer } from "./docx/ofd-to-docx.js";
import { ConsultationRepository } from "./consultations/consultation.repository.js";
// ⚠️ 注意：单数 auditor/ = V1.5 数字审核员业务（plan/checklist/report）；复数 auditors/ = V2.0 审核员档案管理（CRUD）。两个目录职责不同，不要合并。
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
import { generateWithModel, getAvailableModels, generateWithDefaultModel } from "./models/model.gateway.js";
import { handleEvent, pushMessage } from "./integrations/feishu/index.js";
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "./shared/errors.js";
import { createLogger } from "./shared/logger.js";
import { query } from "./db/pool.js";
import type { EmployeeRole, ModelProvider } from "./shared/types.js";
import { generateQuote, getAvailableCertifications, INDUSTRY_OPTIONS, RISK_LEVEL_OPTIONS } from "./certification/quote.service.js";
// V2.0：quote export schema extracted to standalone module (routes/certification.routes.ts uses it)
import { getVersionInfo } from "./version/version.service.js";

const logger = createLogger();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }  // 200MB（V2.1 提升）
});

// consultations 端点用的 export 文件名 UTF-8 编码函数（保留供 templates 端点复用）
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

app.use("/api/files", createFilesRouter({ getUserFromReq, upload }));

  app.use("/api/auth", createAuthRouter({ getUserFromReq }));

  app.get("/api/employees", (_request, response) => response.json({ data: employees }));
  app.get("/api/models", async (_request, response) =>
    response.json({ data: await getAvailableModels() })
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

  // ====== 认证专家：报价 API ======

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

  app.use("/api/customers", createCustomersRouter({ customerRepository, getUserFromReq }));

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
  app.use("/api/projects", createProjectsRouter({ getUserFromReq, projectRepository: projectRepo }));

  // V2.3：认证报价引擎（4 个端点：options/quote/quotes/export-docx）
  // 必须在全局错误处理（L3458）之前注册，否则 NotFoundError 走不到错误中间件
  app.use("/api/certification", createCertificationRouter({ getUserFromReq, quoteRepository }));

  // V2.3：证书预警管理（5 个端点：expiring/detail/ack/ack-batch/unack）
  app.use("/api/certificates", createCertificatesRouter({ getUserFromReq }));

  // V1.5 + V2.2：数字审核员（15+10 = 25 端点）
  // 必须在全局错误处理之前注册，否则 NotFoundError 走不到错误中间件
  app.use("/api/auditor", createAuditorRouter({ upload, getUserFromReq }));
  app.use("/api/auditors", createAuditorsRouter({ upload, getUserFromReq, auditorRepo, ocrModule }));

  // V2.x：认证专家 consultations（5 端点：list/create/feedback/export-docx/export-pptx）
  app.use("/api/consultations", createConsultationsRouter({
    consultationService,
    generateConsultationDocx,
    generateConsultationPptx,
    query,
    getUserFromReq
  }));

  // V2.x：客户跟进 follow-up（17 端点：stages/issuing-bodies/stats/list/get/audit-plan/customer-types/create/update/advance/close/delete/archive-year/ensure-for-customer/batch-ensure/import-from-notifications/auto-from-history）
  app.use("/api/follow-up", createFollowUpRouter({
    followUpRepository,
    query: query as any,
    syncFollowUpToProject,
    autoGenerateAuditPlan,
    listAuditTemplates,
    getUserFromReq
  }));

  // V2.x：审核模板 audit-templates（独立 basepath，1 端点）
  app.use("/api/audit-templates", createAuditTemplatesRouter({ listAuditTemplates, getUserFromReq }));

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
        certificationProjectId: (request.query.certification_project_id as string) || "",  // V2.1
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
        certificationProjectId: (request.query.certification_project_id as string) || "",  // V2.1
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

  // V2.1：主动推送到指定群聊（您提供的 chat_id）
  app.post("/api/feishu/notify", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可推送飞书消息" });
        return;
      }
      const body = request.body as {
        chatId?: string;
        chatIds?: string[];
        content?: any;
      };
      const { chatId, chatIds, content } = body;
      const { notifyGroup, notifyGroups } = await import("./integrations/feishu/client.js");
      if (chatIds && Array.isArray(chatIds)) {
        const results = await notifyGroups(chatIds, content || {});
        response.json({ data: { total: chatIds.length, results } });
      } else if (chatId) {
        const result = await notifyGroup(chatId, content || {});
        response.json({ data: result });
      } else {
        response.status(400).json({ code: "BAD_REQUEST", message: "请提供 chatId 或 chatIds" });
      }
    } catch (err) { next(err); }
  });

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

  // ============================================================
  // V2.2：合同管理路由（15 个端点）
  // ============================================================
  const { contractRouter } = await import("./contracts/contract.routes.js");
  app.use("/api/contracts", contractRouter);

  // V2.2：客户反向补全路由（4 个端点）
  const { customerEnrichRouter } = await import("./contracts/customer-enrich.routes.js");
  app.use("/api/customers", customerEnrichRouter);

  // V2.3：合同模板引擎（16 个端点）
  const { templateRouter } = await import("./templates/template.routes.js");
  app.use("/api/template-engine", templateRouter);

  // ============================================================
  // V2.3.3：AI 中心大模型全局配置（AI 应用中心 → 工具 → 大模型配置）
  // ============================================================
  // 仅管理员可写；GET 任意登录用户可读（用于前端导航显示）
  const {
    getPublicConfig: getPublicLlmConfig,
    upsertConfig: upsertLlmConfig,
    deleteConfig: deleteLlmConfig,
    listConfigLog: listLlmConfigLog
  } = await import("./models/llm-config.service.js");

  app.get("/api/admin/llm-config", async (request, response, next) => {
    try {
      const cfg = await getPublicLlmConfig();
      response.json({ data: cfg, has_config: !!cfg });
    } catch (e) { next(e); }
  });

  app.put("/api/admin/llm-config", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "需要管理员权限" });
        return;
      }
      const body = request.body as any;
      const result = await upsertLlmConfig({
        provider: body.provider,
        model_name: body.model_name,
        base_url: body.base_url,
        api_key: body.api_key,           // 可选：不传则保持原值
        num_ctx: Number(body.num_ctx) || 4096,
        temperature: Number(body.temperature) || 0.3,
        timeout_ms: Number(body.timeout_ms) || 60000,
        max_tokens: Number(body.max_tokens) || 4096,
        is_enabled: body.is_enabled !== false,
        note: body.note || null,
        operator: u.id,
        reason: body.reason || null
      });
      response.json({ data: result, message: "大模型配置已保存并热生效" });
    } catch (e: any) {
      response.status(400).json({ code: "BAD_REQUEST", message: e?.message || "保存失败" });
    }
  });

  app.delete("/api/admin/llm-config", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "需要管理员权限" });
        return;
      }
      const reason = (request.query.reason as string) || undefined;
      await deleteLlmConfig(u.id, reason);
      response.json({ data: null, message: "已删除大模型配置，业务调用将回退到 .env 默认" });
    } catch (e) { next(e); }
  });

  app.get("/api/admin/llm-config/log", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "需要管理员权限" });
        return;
      }
      const limit = Math.min(Number(request.query.limit) || 20, 100);
      const rows = await listLlmConfigLog(limit);
      response.json({ data: rows });
    } catch (e) { next(e); }
  });

  // V2.3.3：连通性测试（用保存的配置真实调用一次模型）
  app.post("/api/admin/llm-config/test", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "需要管理员权限" });
        return;
      }
      const { generateWithDefaultModel } = await import("./models/model.gateway.js");
      const start = Date.now();
      const text = await generateWithDefaultModel({
        input: {
          role: "knowledge-assistant",
          industry: "认证检测",
          companyContext: "连通性测试",
          request: "回复一句话确认你在线即可",
          deliverable: "连通性测试",
          model: "openai"
        },
        knowledge: []
      });
      const latencyMs = Date.now() - start;
      response.json({
        data: {
          ok: true,
          latency_ms: latencyMs,
          preview: text.slice(0, 200),
          length: text.length
        }
      });
    } catch (e: any) {
      response.status(500).json({
        data: { ok: false, error: e?.message || "调用失败" }
      });
    }
  });

  return app;
}
