// ============================================================
// V2.x follow-up 跟进模块（17 端点）+ audit-templates（1 端点）
// 拆自 app.ts inline handlers (阶段 1 拆分)
// ============================================================

import { Router, type Request } from "express";
import { FOLLOW_UP_STAGES, ISSUING_BODIES, type FollowUpRepository } from "../follow_up/follow_up.repository.js";
import { autoGenerateAuditPlan, listTemplates as listAuditTemplates } from "../follow_up/autoAuditPlan.js";
import { syncFollowUpToProject } from "../follow_up/syncFollowUpToProject.js";
import { ValidationError, NotFoundError } from "../shared/errors.js";

export interface FollowUpRouterDeps {
  followUpRepository: FollowUpRepository;
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
  syncFollowUpToProject: (input: any) => Promise<any>;
  autoGenerateAuditPlan: (input: any) => Promise<any>;
  listAuditTemplates: (companyId: string) => Promise<any>;
  getUserFromReq: (request: Request) => any;
}

// Compat alias — pg's Pool.query returns `QueryResult<T>` (extends {rows, rowCount, oid, fields}).
// We declare our deps interface as a structural subtype with the two fields the handlers actually use.
// Cast at mount site: app.use("/api/follow-up", createFollowUpRouter({ ...deps as any }))

export function createFollowUpRouter(deps: FollowUpRouterDeps) {
  const router = Router();
  const { followUpRepository, query, syncFollowUpToProject, autoGenerateAuditPlan, listAuditTemplates, getUserFromReq } = deps;


  // ---- stages (原 L848-L852) ----
  router.get("/stages", async (_request, response, next) => {
    try {
      response.json({ data: FOLLOW_UP_STAGES });
    } catch (error) { next(error); }
  });

  // ---- issuing-bodies (原 L855-L859) ----
  router.get("/issuing-bodies", async (_request, response, next) => {
    try {
      response.json({ data: ISSUING_BODIES });
    } catch (error) { next(error); }
  });

  // ---- stats-by-issuing-body (原 L862-L869) ----
  router.get("/stats/by-issuing-body", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const year = request.query.year ? parseInt(request.query.year as string, 10) : undefined;
      const result = await followUpRepository.getStatsByIssuingBody(u.companyId, year);
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // ---- list (原 L872-L889) ----
  router.get("/", async (request, response, next) => {
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

  // ---- get (原 L892-L900) ----
  router.get("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const fu = await followUpRepository.getFollowUp(u.companyId, request.params.id);
      if (!fu) throw new NotFoundError("跟进记录");
      const logs = await followUpRepository.getFollowUpLogs(u.companyId, request.params.id);
      response.json({ data: { ...fu, logs } });
    } catch (error) { next(error); }
  });

  // ---- customer-types (原 L907-L955) ----
  router.get("/customer-types/:customerId", async (request, response, next) => {
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

  // ---- audit-plan (原 L967-L980) ----
  router.get("/:id/audit-plan", async (request, response, next) => {
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

  // ---- create (原 L983-L1003) ----
  router.post("/", async (request, response, next) => {
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

  // ---- update (原 L1006-L1019) ----
  router.patch("/:id", async (request, response, next) => {
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

  // ---- advance (原 L1022-L1108) ----
  router.post("/:id/advance", async (request, response, next) => {
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

  // ---- close (原 L1111-L1154) ----
  router.post("/:id/close", async (request, response, next) => {
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

  // ---- delete (原 L1157-L1164) ----
  router.delete("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const ok = await followUpRepository.deleteFollowUp(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("跟进记录");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // ---- archive-year (原 L1167-L1174) ----
  router.post("/archive-year/:year", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const year = parseInt(request.params.year, 10);
      const count = await followUpRepository.archiveYear(u.companyId, year);
      response.json({ data: { year, archived_count: count } });
    } catch (error) { next(error); }
  });

  // ---- ensure-for-customer (原 L1177-L1195) ----
  router.post("/ensure-for-customer", async (request, response, next) => {
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

  // ---- batch-ensure (原 L1198-L1230) ----
  router.post("/batch-ensure", async (request, response, next) => {
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

  // ---- import-from-notifications (原 L1234-L1364) ----
  router.post("/import-from-notifications", async (request, response, next) => {
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

  // ---- auto-from-history (原 L1818-L1863) ----
  router.post("/auto-from-history", async (request, response, next) => {
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

  return router;
}

export interface AuditTemplatesRouterDeps {
  listAuditTemplates: (companyId: string) => Promise<any>;
  getUserFromReq: (request: Request) => any;
}

export function createAuditTemplatesRouter(deps: AuditTemplatesRouterDeps) {
  const router = Router();
  const { listAuditTemplates, getUserFromReq } = deps;

  // ---- audit-templates (原 L958-L964) ----
  router.get("/", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const templates = await listAuditTemplates(u.companyId);
      response.json({ data: templates });
    } catch (error) { next(error); }
  });

  return router;
}
