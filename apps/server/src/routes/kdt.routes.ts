/**
 * #10 knowledge/document/templates 路由 (11 端点)
 * - knowledge: 6 端点 (list/create/delete/search/feedback/versions)
 * - document: 3 端点 (ofd-to-docx, ofd-to-knowledge, documents-analyze)
 * - templates: 2 端点 (enterprise-solution.docx, digital-transformation-solution.pptx)
 */
import { Router, Request } from "express";
import { query } from "../db/pool.js";
import { KnowledgeRepository } from "../knowledge/knowledge.repository.js";
import { searchKnowledge } from "../knowledge/retrieval.service.js";
import { extractDocumentText } from "../documents/document.service.js";
import { ofdBufferToDocxBuffer } from "../docx/ofd-to-docx.js";
import { generateWithModel } from "../models/model.gateway.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../shared/errors.js";

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { config } from "../config.js";
import { createLogger } from "../shared/logger.js";
import {
  enterpriseTemplateBranding,
  enterpriseTemplateRecord,
  generateConsultationDocx,
  generateQuoteDocx
} from "../docx/docx-report.service.js";
import {
  generateConsultationPptx,
  presentationTemplateBranding,
  presentationTemplateRecord
} from "../pptx/pptx-presentation.service.js";
import { z } from "zod";
import type { EmployeeRole, ModelProvider } from "../shared/types.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});
const logger = createLogger();

// templates 端点用的 export 文件名 UTF-8 编码函数（搬自 app.ts L77）
function encodedFileName(value: string, extension: "docx" | "pptx") {
  const safeName = value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "咨询报告";
  return `UTF-8''${encodeURIComponent(`${safeName}.${extension}`)}`;
}
export interface KDRouterDeps {
  getUserFromReq: (req: Request) => any;
  knowledgeRepository: KnowledgeRepository;
}


// ============================================================
// #10.1 Knowledge 路由（6 端点）
// ============================================================
export function createKnowledgeRouter(deps: KDRouterDeps) {
  const router = Router();
  const { getUserFromReq, knowledgeRepository } = deps;

    router.get("", async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        response.json({ data: await knowledgeRepository.list(u.companyId) });
      } catch (error) {
        next(error);
      }
    });
    router.post("", upload.single("file"), async (request, response, next) => {
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
    router.delete("/:id", async (request, response, next) => {
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
    router.post("/search", async (request, response, next) => {
      try {
        const { query: q, limit = 5, threshold = 0.5 } = request.body || {};
        if (!q || typeof q !== "string" || q.length < 2) {
          throw new ValidationError("请输入查询文本（至少 2 字）");
        }
        // 用真向量服务（BGE-base-zh-v1.5 768维）
        const emb = await import("../knowledge/embedding.js");
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
    router.post("/:docCode/feedback", async (request, response, next) => {
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
    router.get("/:docCode/versions", async (request, response, next) => {
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
  return router;
}


// ============================================================
// #10.2 Document 路由（3 端点：ofd-to-docx, ofd-to-knowledge, documents-analyze）
// ============================================================
export function createDocumentRouter(deps: KDRouterDeps) {
  const router = Router();
  const { getUserFromReq, knowledgeRepository } = deps;

    router.post("/ofd-to-docx", upload.single("file"), async (request, response, next) => {
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
    router.post("/ofd-to-knowledge", upload.single("file"), async (request, response, next) => {
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
    router.post("/analyze", upload.single("file"), async (request, response, next) => {
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
  return router;
}


// ============================================================
// #10.3 Templates 路由（2 端点：enterprise-solution.docx, digital-transformation-solution.pptx）
// ============================================================
export function createTemplatesRouter(deps: { getUserFromReq: (req: Request) => any }) {
  const router = Router();
  const { getUserFromReq } = deps;

    router.get("/enterprise-solution.docx", async (_request, response, next) => {
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
    router.get("/digital-transformation-solution.pptx", async (_request, response, next) => {
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
  return router;
}
