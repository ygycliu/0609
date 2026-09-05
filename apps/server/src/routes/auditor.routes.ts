/**
 * V1.5：数字审核员（单数 /api/auditor/*）
 * 15 个端点：从 app.ts 拆出（阶段 1 #6）
 *
 * 端点列表：
 *   POST   /plan                       生成审核计划
 *   POST   /checklist                  生成检查清单
 *   POST   /report                     生成审核报告
 *   POST   /session                    创建审核会话
 *   PATCH  /item/:itemId               更新检查项
 *   POST   /item/:itemId/upload        上传检查项证据
 *   GET    /session/:id                获取审核会话
 *   GET    /attachment/:id             获取附件
 *   DELETE /attachment/:id             删除附件
 *   GET    /session/:id/report-attachments
 *   POST   /session/:id/report-attachment/upload
 *   GET    /report-attachment/:id
 *   DELETE /report-attachment/:id
 *   POST   /session/:id/attachments-ready
 *   POST   /session/:id/import-yoooclaw
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { ValidationError, ForbiddenError, NotFoundError } from "../shared/errors.js";
import {
  generateAuditPlan,
  generateChecklist,
  detectNonConformances,
  generateAuditReport
} from "../auditor/auditor.service.js";

export interface AuditorRouterDeps {
  upload: multer.Multer;
  getUserFromReq: (request: Request) => any;
}

export function createAuditorRouter(_deps: AuditorRouterDeps): Router {
  const router = Router();
  const upload = _deps.upload;
  const getUserFromReq = _deps.getUserFromReq;

  // ============== 数字审核员（certification-auditor）API ==============
  // 1. 生成审核计划
  router.post("/plan", async (request, response, next) => {
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
      const retrieval = await import("../knowledge/retrieval.service.js");
      const { KnowledgeRepository } = await import("../knowledge/knowledge.repository.js");
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
  router.post("/checklist", async (request, response, next) => {
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
  router.post("/report", async (request, response, next) => {
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
  router.post("/session", async (request, response, next) => {
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
  router.patch("/item/:itemId", async (request, response, next) => {
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
  router.post("/item/:itemId/upload", upload.single("file"), async (request, response, next) => {
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
  router.get("/session/:id", async (request, response, next) => {
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
  router.get("/attachment/:id", async (request, response, next) => {
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
  router.delete("/attachment/:id", async (request, response, next) => {
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
  router.get("/session/:id/report-attachments", async (request, response, next) => {
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
  router.post("/session/:id/report-attachment/upload", upload.single("file"), async (request, response, next) => {
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
  router.get("/report-attachment/:id", async (request, response, next) => {
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
  router.delete("/report-attachment/:id", async (request, response, next) => {
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
  router.post("/session/:id/attachments-ready", async (request, response, next) => {
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
  router.post("/session/:id/import-yoooclaw", async (request, response, next) => {
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
  return router;
}
