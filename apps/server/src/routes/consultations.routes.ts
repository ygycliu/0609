// ============================================================
// V2.x 认证专家：consultations 端点 (5 端点)
// 拆自 app.ts inline handlers
//   GET    /api/consultations                      — 列表
//   POST   /api/consultations                      — 创建
//   POST   /api/consultations/:id/feedback         — 反馈
//   POST   /api/consultations/:id/export/docx      — 导出 Word
//   POST   /api/consultations/:id/export/pptx      — 导出 PPT
// ============================================================
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";

// ========== schemas (原 app.ts L72-102) ==========
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

// ========== helper (原 app.ts L106-109) ==========
function encodedFileName(value: string, extension: "docx" | "pptx"): string {
  const safeName = value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "咨询报告";
  return `UTF-8''${encodeURIComponent(`${safeName}.${extension}`)}`;
}

// ========== deps ==========
export interface ConsultationsRouterDeps {
  consultationService: {
    list: (companyId: string) => Promise<unknown>;
    create: (companyId: string, userId: string, data: z.infer<typeof consultationSchema>) => Promise<unknown>;
    getById: (companyId: string, id: string) => Promise<unknown>;
  };
  generateConsultationDocx: (record: any, data: any) => Promise<Buffer>;
  generateConsultationPptx: (record: any, data: any) => Promise<Buffer>;
  query: (text: string, params?: any[]) => Promise<any>;
  getUserFromReq: (request: Request) => any;
}

export function createConsultationsRouter(deps: ConsultationsRouterDeps): Router {
  const router = Router();
  const {
    consultationService,
    generateConsultationDocx,
    generateConsultationPptx,
    query,
    getUserFromReq
  } = deps;

  // ---- 段 A: GET 列表 ----
  router.get("/", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await consultationService.list(u.companyId) });
    } catch (error) {
      next(error);
    }
  });

  // ---- 段 A: POST 创建 ----
  router.post("/", async (request: Request, response: Response, next: NextFunction) => {
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

  // ---- 段 B: POST /:id/feedback ----
  router.post("/:id/feedback", async (request: Request, response: Response, next: NextFunction) => {
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

  // ---- 段 C1: POST /:id/export/docx ----
  router.post("/:id/export/docx", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = docxExportSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const record = await consultationService.getById(
        getUserFromReq(request).companyId,
        String(request.params.id)
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

  // ---- 段 C2: POST /:id/export/pptx ----
  router.post("/:id/export/pptx", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = pptxExportSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const record = await consultationService.getById(
        getUserFromReq(request).companyId,
        String(request.params.id)
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

  return router;
}
