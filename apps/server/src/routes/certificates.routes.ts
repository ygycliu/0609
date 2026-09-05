import { Router, Request, Response, NextFunction } from "express";
import { NotFoundError } from "../shared/errors.js";
import { query } from "../db/pool.js";

type AuthedRequest = Request;
type ExResponse = Response;

export interface CertificatesRouterDeps {
  getUserFromReq: (req: Request) => { companyId: string; id: string; username?: string; userId?: string };
}

export function createCertificatesRouter(deps: CertificatesRouterDeps): Router {
  const { getUserFromReq } = deps;
  const router = Router();

  // 1) GET /expiring - 证书预警列表
    router.get("/expiring", async (request, response, next) => {
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

  // 2) GET /:id - 单证书详情
    router.get("/:id", async (request, response, next) => {
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

  // 3) PATCH /:id/acknowledge - 标记证书已确认
    router.patch("/:id/acknowledge", async (request, response, next) => {
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

  // 4) POST /acknowledge-batch - 批量确认
    router.post("/acknowledge-batch", async (request, response, next) => {
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

  // 5) POST /:id/unacknowledge - 撤销确认
    router.post("/:id/unacknowledge", async (request, response, next) => {
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

  return router;
}
