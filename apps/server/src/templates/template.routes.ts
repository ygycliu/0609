/**
 * V2.3 合同模板引擎 - 路由（16 个端点）
 */
import { Router, Request, Response as ExResponse, NextFunction } from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { config } from "../config.js";
import { authMiddleware } from "../auth/auth.service.js";
import { readCookie, ACCESS_COOKIE } from "../auth/session.js";
import { TemplateRepository } from "./template.repository.js";
import { extractSchemaFromDocx } from "./template.extractor.js";
import { generateContract } from "./template.generator.js";
import { query } from "../db/pool.js";

export const templateRouter = Router();
const repo = new TemplateRepository();

// V2.3：auth middleware 注入 req.user
templateRouter.use(async (req: Request, _res: ExResponse, next: NextFunction) => {
  try {
    const token = readCookie(req as any, ACCESS_COOKIE);
    const user = await authMiddleware(token);
    if (!user) {
      (_res as any).status(401).json({ code: "UNAUTHORIZED" });
      return;
    }
    (req as any).user = user;
    next();
  } catch (e) { next(e); }
});

function q(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v[0] || undefined;
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

// ============================================================
// 1. 模板 CRUD（5
// ============================================================

// 列表
templateRouter.get("/", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const opts: any = { limit: 50, offset: 0 };
    if (q(req.query.signing_entity_id)) opts.signingEntityId = q(req.query.signing_entity_id);
    if (q(req.query.contract_type)) opts.contractType = q(req.query.contract_type);
    if (q(req.query.template_category)) opts.templateCategory = q(req.query.template_category);
    if (q(req.query.status)) opts.status = q(req.query.status);
    if (q(req.query.q)) opts.q = q(req.query.q);
    const lim = q(req.query.limit);
    if (lim) opts.limit = Math.min(Number(lim), 200);
    const off = q(req.query.offset);
    if (off) opts.offset = Math.max(Number(off), 0);
    const result = await repo.list(u.companyId, opts);
    res.json({ data: result.items, total: result.total });
  } catch (e) { next(e); }
});

// 详情
templateRouter.get("/:id", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const t = await repo.get(u.companyId, id);
    if (!t) return res.status(404).json({ error: "未找到模板" });
    res.json({ data: t });
  } catch (e) { next(e); }
});

// 上传 + 抽取 schema
templateRouter.post("/upload", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const body = req.body;
    if (!body.code || !body.name || !body.signingEntityId || !body.templatePath || !body.templateCategory) {
      return res.status(400).json({ error: "缺少必填字段" });
    }
    console.log("[template-upload] extracting:", body.code);
    const { text, schema } = await extractSchemaFromDocx(body.templatePath);
    const created = await repo.create(u.companyId, {
      code: body.code,
      name: body.name,
      description: body.description,
      signingEntityId: body.signingEntityId,
      templateCategory: body.templateCategory,
      contractType: body.contractType,
      chapterCount: schema.chapter_count,
      fileFormat: "docx",
      templatePath: body.templatePath,
      fieldSchema: schema.field_mapping,
      chapterSchema: { chapters: schema.chapters },
      status: "active",
      version: 1,
      createdBy: u.id
    });
    if (!created) return res.status(400).json({ error: "创建失败" });
    await repo.createVersion(u.companyId, created.id, {
      filePath: body.templatePath,
      fieldSchema: schema.field_mapping,
      chapterSchema: { chapters: schema.chapters },
      changeNote: "上传 + AI 抽取",
      extractedFromContractId: body.extractedFromContractId || null,
      extractionConfidence: schema.confidence
    });
    res.json({ data: { ...created, schema, textLength: text.length } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 更新
templateRouter.patch("/:id", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const t = await repo.update(u.companyId, id, req.body);
    if (!t) return res.status(404).json({ error: "未找到" });
    res.json({ data: t });
  } catch (e) { next(e); }
});

// 删除
templateRouter.delete("/:id", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const ok = await repo.softDelete(u.companyId, id);
    if (!ok) return res.status(404).json({ error: "未找到" });
    res.json({ data: { id, deleted: true } });
  } catch (e) { next(e); }
});

// ============================================================
// 2. 章节 + 字段（3
// ============================================================

templateRouter.post("/:id/extract-chapters", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const t = await repo.get(u.companyId, id);
    if (!t) return res.status(404).json({ error: "未找到" });
    const { schema } = await extractSchemaFromDocx(t.templatePath);
    await repo.update(u.companyId, id, {
      chapterCount: schema.chapter_count,
      chapterSchema: { chapters: schema.chapters }
    });
    res.json({ data: { chapters: schema.chapters, count: schema.chapter_count } });
  } catch (e) { next(e); }
});

templateRouter.post("/:id/extract-fields", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const t = await repo.get(u.companyId, id);
    if (!t) return res.status(404).json({ error: "未找到" });
    const { schema } = await extractSchemaFromDocx(t.templatePath);
    await repo.update(u.companyId, id, {
      fieldSchema: schema.field_mapping
    });
    res.json({ data: schema.field_mapping });
  } catch (e) { next(e); }
});

// ============================================================
// 3. 字段字典（2
// ============================================================

templateRouter.get("/fields/all", async (req: Request, res: ExResponse, next) => {
  try {
    const fields = await repo.listFields();
    res.json({ data: fields });
  } catch (e) { next(e); }
});

templateRouter.get("/fields/:code", async (req: Request, res: ExResponse, next) => {
  try {
    const code = String(req.params.code);
    const field = await repo.getField(code);
    if (!field) return res.status(404).json({ error: "未找到字段" });
    res.json({ data: field });
  } catch (e) { next(e); }
});

// ============================================================
// 4. 生成（核心 3
// ============================================================

// 生成合同（核心端点）
templateRouter.post("/:id/generate", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const t = await repo.get(u.companyId, id);
    if (!t) return res.status(404).json({ error: "未找到模板" });
    const body = req.body;
    if (!body.customerId) return res.status(400).json({ error: "缺少 customerId" });
    if (!body.fieldValues) return res.status(400).json({ error: "缺少 fieldValues" });

    // V2.3.1：支持 customer_code（如 CUST-AR-21877）自动转换为 UUID
    let customerIdResolved = body.customerId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.customerId);
    if (!isUuid) {
      const c = await query(
        `SELECT id FROM customer WHERE company_id = $1 AND customer_code = $2 AND deleted_at IS NULL LIMIT 1`,
        [u.companyId, body.customerId]
      );
      if (c.rows.length === 0) {
        return res.status(404).json({ error: `未找到客户：${body.customerId}（既不是 UUID，也不是 customer_code）` });
      }
      customerIdResolved = c.rows[0].id;
      console.log(`[generate] customer_code "${body.customerId}" → UUID ${customerIdResolved}`);
    }

    // 自动从 customer 填充
    if (body.autoFillFromProject !== false) {
      const customer = await query(`SELECT * FROM customer WHERE id = $1`, [customerIdResolved]);
      if (customer.rows[0]) {
        const c = customer.rows[0];
        body.fieldValues.customer_name = body.fieldValues.customer_name || c.name;
        body.fieldValues.customer_address = body.fieldValues.customer_address || c.address || "";
        body.fieldValues.contact_person = body.fieldValues.contact_person || c.contact_person || "";
        body.fieldValues.contact_phone = body.fieldValues.contact_phone || c.contact_phone || "";
        body.fieldValues.bank_name = body.fieldValues.bank_name || c.bank_name || "";
        body.fieldValues.bank_holder = body.fieldValues.bank_holder || c.bank_holder || "";
        body.fieldValues.bank_account = body.fieldValues.bank_account || c.bank_account || "";
      }
      // 从 cert_project 填充
      if (body.certificationProjectId) {
        const proj = await query(`SELECT * FROM certification_project WHERE id = $1`, [body.certificationProjectId]);
        if (proj.rows[0]) {
          const p = proj.rows[0];
          body.fieldValues.cert_scope = body.fieldValues.cert_scope || p.certification_scope || p.scope || "";
          body.fieldValues.audit_region = body.fieldValues.audit_region || p.region || "";
        }
      }
    }

    // 生成 PDF
    const outputDir = path.join(config.uploadsDir, "contracts", "generated");
    const baseName = `${t.code}-${customerIdResolved.slice(0, 8)}-${Date.now()}`;

    console.log(`[generate] ${t.code} for customer ${customerIdResolved}`);
    const result = await generateContract(
      t.templatePath,
      body.fieldValues,
      {
        outputDir,
        outputBaseName: baseName
      }
    );

    // 记录生成审计
    const generationId = await repo.recordGeneration(u.companyId, {
      templateId: t.id,
      templateVersion: t.version,
      customerId: customerIdResolved,
      certificationProjectId: body.certificationProjectId || null,
      fieldValues: body.fieldValues,
      outputFormat: body.outputFormat || "pdf",
      generatedFilePath: result.pdfPath || result.docxPath,
      generationTimeMs: result.generationTimeMs,
      fileSize: result.fileSize,
      status: "success",
      createdBy: u.id
    });

    res.json({
      data: {
        generationId,
        templateId: t.id,
        templateVersion: t.version,
        docxPath: result.docxPath,
        pdfPath: result.pdfPath,
        fileSize: result.fileSize,
        generationTimeMs: result.generationTimeMs,
        downloadUrl: `/ai/api/template-engine/generations/${generationId}/download`
      }
    });
  } catch (e: any) {
    console.error("[generate]", e);
    res.status(500).json({ error: e.message });
  }
});

// 生成历史
templateRouter.get("/generations/list", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const opts: any = { limit: 50, offset: 0 };
    if (q(req.query.template_id)) opts.templateId = q(req.query.template_id);
    if (q(req.query.customer_id)) opts.customerId = q(req.query.customer_id);
    const lim = q(req.query.limit);
    if (lim) opts.limit = Math.min(Number(lim), 200);
    const off = q(req.query.offset);
    if (off) opts.offset = Math.max(Number(off), 0);
    const list = await repo.listGenerations(u.companyId, opts);
    res.json({ data: list });
  } catch (e) { next(e); }
});

// 生成详情
templateRouter.get("/generations/:id", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const gen = await repo.getGeneration(u.companyId, id);
    if (!gen) return res.status(404).json({ error: "未找到" });
    res.json({ data: gen });
  } catch (e) { next(e); }
});

// 下载
templateRouter.get("/generations/:id/download", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const gen = await repo.getGeneration(u.companyId, id);
    if (!gen || !gen.generated_file_path) return res.status(404).json({ error: "未找到" });
    res.download(gen.generated_file_path, path.basename(gen.generated_file_path));
  } catch (e) { next(e); }
});

// ============================================================
// 5. 版本历史（2
// ============================================================

templateRouter.get("/:id/versions", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const r = await query(
      `SELECT * FROM contract_template_version WHERE template_id = $1 ORDER BY version DESC`,
      [id]
    );
    res.json({ data: r.rows });
  } catch (e) { next(e); }
});

templateRouter.post("/:id/versions", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const id = String(req.params.id);
    const body = req.body;
    const result = await repo.createVersion(u.companyId, id, {
      filePath: body.filePath,
      fieldSchema: body.fieldSchema || {},
      chapterSchema: body.chapterSchema || {},
      changeNote: body.changeNote,
      extractedFromContractId: body.extractedFromContractId,
      extractionConfidence: body.extractionConfidence,
      createdBy: u.id
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ============================================================
// 6. 智能反向（V2.2 升级 2
// ============================================================

// 从 PDF 抽取 → 自动选模板 → 生成
templateRouter.post("/from-pdf/generate", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const body = req.body;
    if (!body.contractId) return res.status(400).json({ error: "缺少 contractId" });
    // TODO: V2.4
    res.status(501).json({ error: "V2.4 实现" });
  } catch (e) { next(e); }
});

// 找相似模板
templateRouter.get("/:id/similar", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const t = await repo.get(u.companyId, id);
    if (!t) return res.status(404).json({ error: "未找到" });
    const similar = await repo.list(u.companyId, {
      signingEntityId: t.signingEntityId,
      templateCategory: t.templateCategory
    });
    res.json({ data: similar.items.filter(x => x.id !== id) });
  } catch (e) { next(e); }
});