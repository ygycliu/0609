/**
 * 项目路由（/api/projects/*）
 *
 * 业务：项目 CRUD、状态机、子模块（payments/invoices/corrections/documents/reviews）、事件一致性
 *
 * 拆分前：app.ts L1463-2206（744 行，25 个端点）
 * 拆分后：本文件 + app.ts 一行 app.use
 *
 * UUID bug 已知（不修）：route param :id 在 db 里其实是 UUID。
 */
import express from "express";
import * as crypto from "node:crypto";
import * as projectRepo from "../project/project.repository.js";
import { query } from "../db/pool.js";
import { NotFoundError, ValidationError } from "../shared/errors.js";

export interface ProjectsRouterDeps {
  getUserFromReq: (request: express.Request) => any;
  projectRepository: typeof projectRepo;
}

export function createProjectsRouter(deps: ProjectsRouterDeps) {
  const router = express.Router();
  const projectRepo = deps.projectRepository;
  const getUserFromReq = deps.getUserFromReq;

  router.get("/", async (request, response, next) => {
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

  router.get("/stats", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const stats = await projectRepo.getProjectStats(u.companyId);
      response.json({ data: stats });
    } catch (e) { next(e); }
  });

  router.get("/overdue", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listOverdueProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  router.get("/pending-payment", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listPendingPaymentProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  router.get("/pending-cert", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.listPendingCertProjects(u.companyId) });
    } catch (e) { next(e); }
  });

  router.get("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const p = await projectRepo.getProject(u.companyId, request.params.id);
      if (!p) throw new NotFoundError("项目");
      response.json({ data: p });
    } catch (e) { next(e); }
  });

  router.post("/", async (request, response, next) => {
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

  router.post("/:id/status", async (request, response, next) => {
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

  router.get("/:id/timeline", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await projectRepo.getProjectTimeline(u.companyId, request.params.id) });
    } catch (e) { next(e); }
  });

  // P0-C §7：事件一致性检查
  router.get("/:id/consistency", async (request, response, next) => {
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
  router.post("/:id/events/:eventId/replay", async (request, response, next) => {
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
      const replayEventId = crypto.randomUUID();
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
         crypto.randomUUID(),
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
  router.post("/:id/rebuild-derivatives", async (request, response, next) => {
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
  router.get("/:id/payments", async (request, response, next) => {
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

  router.post("/:id/payments", async (request, response, next) => {
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

  router.patch("/:id/payments/:paymentId", async (request, response, next) => {
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

  router.delete("/:id/payments/:paymentId", async (request, response, next) => {
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
  router.get("/:id/invoices", async (request, response, next) => {
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

  router.post("/:id/invoices", async (request, response, next) => {
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
  router.get("/:id/corrections", async (request, response, next) => {
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

  router.post("/:id/corrections", async (request, response, next) => {
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

  router.patch("/:id/corrections/:correctionId", async (request, response, next) => {
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
  router.get("/:id/documents", async (request, response, next) => {
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

  router.post("/:id/documents", async (request, response, next) => {
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
  router.get("/:id/reviews", async (request, response, next) => {
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

  router.post("/:id/reviews", async (request, response, next) => {
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

  return router;
}
