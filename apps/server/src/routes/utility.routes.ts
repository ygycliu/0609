/**
 * #9 utility 路由 (todo + yoooclaw + deliverables) — 共 8 端点
 * - todo: 4 端点 (list/create/update/delete)
 * - yoooclaw: 2 端点 (imported-recordings list, auto-extract)
 * - deliverables: 2 端点 (list, :id/transition)
 */
import { Router, Request, Response as ExResponse, NextFunction } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { ValidationError, ForbiddenError, NotFoundError } from "../shared/errors.js";
import { processRecordingEndToEnd } from "../services/yoooclaw-extract.service.js";

export interface UtilityRouterDeps {
  getUserFromReq: (req: Request) => any;
}


// ============================================================
// #9.1 Todo 路由（4 端点：list/create/update/delete）
// ============================================================
export function createTodoRouter(deps: UtilityRouterDeps) {
  const router = Router();
  const { getUserFromReq } = deps;

    router.get("", async (request, response, next) => {
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
    router.post("", async (request, response, next) => {
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
    router.patch("/:id", async (request, response, next) => {
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
    router.delete("/:id", async (request, response, next) => {
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
  return router;
}


// ============================================================
// #9.2 Yoooclaw 路由（2 端点：imported-recordings list, auto-extract）
// ============================================================
export function createYoooclawRouter(deps: UtilityRouterDeps) {
  const router = Router();
  const { getUserFromReq } = deps;

    router.get("/imported-recordings", async (request, response, next) => {
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
    router.post("/auto-extract", async (request, response, next) => {
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
  return router;
}


// ============================================================
// #9.3 Deliverables 路由（2 端点：list, :id/transition）
// ============================================================
export function createDeliverablesRouter(deps: UtilityRouterDeps) {
  const router = Router();
  const { getUserFromReq } = deps;

    router.get("", async (request, response, next) => {
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
    router.post("/:id/transition", async (request, response, next) => {
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
  return router;
}
