/**
 * 跟进 → 项目 联动服务
 *
 * 当 customer_follow_up.stage 推进到关键阶段时：
 * - 自动创建/更新 certification_project
 * - 写入 project_event 审计追踪
 *
 * 阶段映射：
 *   quoted         → lead (新建项目)
 *   contract_review → contract_pending
 *   implementing   → contract_signed
 *   certified      → certified
 *   completed      → completed
 */

import { query, withTransaction } from "../db/pool.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger();

export interface SyncFollowUpToProjectInput {
  companyId: string;
  customerId: string;
  customerName: string;
  serviceTypeCode: string;
  targetStatus: string;
  expectedAmount?: number;
  contractAmount?: number;
  notes?: string;
  operatorId: string;
  year?: number;
}

export interface SyncedProject {
  projectId: string;
  projectCode: string;
  action: "created" | "updated" | "skipped";
  status: string;
}

// 状态机允许流转（与 project.repository.ts 同步）
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  lead: ["communicating", "quoted", "suspended", "cancelled"],
  communicating: ["quoted", "lead", "suspended", "cancelled"],
  quoted: ["contract_pending", "communicating", "lead", "cancelled"],
  contract_pending: ["contract_signed", "quoted", "suspended", "cancelled"],
  contract_signed: ["contract_archived", "suspended", "cancelled"],
  contract_archived: ["first_pay_pending", "first_paid", "suspended", "cancelled"],
  first_pay_pending: ["first_paid", "suspended", "cancelled"],
  first_paid: ["delivery_prep", "first_pay_pending", "doc_collecting", "contract_review", "expert_review_pending", "expert_reviewing"],
  delivery_prep: ["doc_collecting", "suspended"],
  doc_collecting: ["contract_review", "expert_review_pending", "delivery_prep"],
  contract_review: ["expert_review_pending", "doc_collecting", "at_risk"],
  expert_review_pending: ["expert_reviewing", "doc_collecting", "at_risk"],
  expert_reviewing: ["correcting", "cert_pending", "at_risk"],
  correcting: ["cert_pending", "expert_reviewing", "at_risk"],
  final_pay_pending: ["cert_pending", "invoice_pending", "correcting"],
  invoice_pending: ["cert_pending", "final_pay_pending"],
  cert_pending: ["certified", "correcting"],
  certified: ["shipment_pending", "completed"],
  shipment_pending: ["completed", "certified"],
  completed: ["suspended", "at_risk"],
  suspended: ["lead", "communicating", "quoted", "contract_pending", "cancelled"],
  at_risk: ["correcting", "contract_review", "expert_reviewing", "cancelled"],
  cancelled: []
};

/**
 * 同步跟进到项目（幂等）
 */
export async function syncFollowUpToProject(
  input: SyncFollowUpToProjectInput
): Promise<SyncedProject> {
  const {
    companyId,
    customerId,
    customerName,
    serviceTypeCode,
    targetStatus,
    expectedAmount,
    contractAmount,
    notes,
    operatorId,
    year
  } = input;

  try {
    return await withTransaction(async (client) => {
      // 查 service_type_id
      const stRes = await client.query<{ id: string }>(
        `SELECT id FROM service_type WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
        [serviceTypeCode]
      );
      const serviceTypeId = stRes.rows[0]?.id;

      // 查默认签约主体（华中集团）
      const seRes = await client.query<{ id: string }>(
        `SELECT id FROM signing_entity WHERE deleted_at IS NULL AND status = 'active' ORDER BY entity_code LIMIT 1`
      );
      const signingEntityId = seRes.rows[0]?.id;

      // 查 service_type 名称
      const stNameRes = await client.query<{ name: string }>(
        `SELECT name FROM service_type WHERE id = $1`,
        [serviceTypeId]
      );
      const serviceTypeName = stNameRes.rows[0]?.name || serviceTypeCode;

      // 1. 查找该客户当年的项目
      const yearPrefix = year || new Date().getFullYear();
      const existingRes = await client.query<{ id: string; project_code: string; status: string }>(
        `SELECT id, project_code, status FROM certification_project
         WHERE company_id = $1 AND customer_id = $2
           AND EXTRACT(YEAR FROM created_at) = $3
           AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [companyId, customerId, yearPrefix]
      );

      let projectId: string;
      let projectCode: string;
      let action: "created" | "updated";

      if (existingRes.rows.length === 0) {
        // 2a. 没有项目 → 创建
        const newId = (await client.query<{ id: string }>(
          `SELECT uuid_generate_v4() AS id`
        )).rows[0].id;
        projectCode = `PRJ-${yearPrefix}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`;

        await client.query(
          `INSERT INTO certification_project
            (id, company_id, project_code, customer_id, customer_name,
             service_type_id, service_type_code, service_type_name,
             signing_entity_id, signing_entity_name,
             status, contract_amount, notes, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
          [
            newId, companyId, projectCode, customerId, customerName,
            serviceTypeId, serviceTypeCode, serviceTypeName,
            signingEntityId, "华中国际认证检验集团有限公司",
            targetStatus, contractAmount || expectedAmount || 0,
            notes || `从客户跟进自动创建（${yearPrefix}年）`,
            operatorId
          ]
        );

        // 写 project_event
        await client.query(
          `INSERT INTO project_event
            (company_id, project_id, from_status, to_status, event_type, operator_id, operator_name, reason, note)
           VALUES ($1, $2, NULL, $3, 'followup_sync', $4, NULL, $5, $6)`,
          [companyId, newId, targetStatus, operatorId, "从客户跟进自动创建", notes || ""]
        );

        projectId = newId;
        action = "created";
        logger.info(`[sync-followup-project] 创建项目 ${projectCode} (customer=${customerName})`);
      } else {
        // 2b. 已有项目
        projectId = existingRes.rows[0].id;
        projectCode = existingRes.rows[0].project_code;
        const currentStatus = existingRes.rows[0].status;

        if (currentStatus === targetStatus) {
          // 已经是目标状态
          return { projectId, projectCode, action: "skipped", status: currentStatus };
        }

        const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
        if (allowed.includes(targetStatus)) {
          // 推进状态
          await client.query(
            `UPDATE certification_project
             SET status = $2::varchar, prev_status = $3::varchar, updated_at = NOW()
             WHERE id = $1`,
            [projectId, targetStatus, currentStatus]
          );

          // 写 project_event
          await client.query(
            `INSERT INTO project_event
              (company_id, project_id, from_status, to_status, event_type, operator_id, operator_name, reason, note)
             VALUES ($1, $2, $3, $4, 'followup_sync', $5, NULL, $6, $7)`,
            [companyId, projectId, currentStatus, targetStatus, operatorId, "从客户跟进自动同步", notes || ""]
          );

          action = "updated";
          logger.info(`[sync-followup-project] 更新项目 ${projectCode}: ${currentStatus} → ${targetStatus}`);
        } else {
          logger.warn(
            `[sync-followup-project] 项目 ${projectCode} 状态 ${currentStatus} → ${targetStatus} 不允许`
          );
          return { projectId, projectCode, action: "skipped", status: currentStatus };
        }
      }

      return { projectId, projectCode, action, status: targetStatus };
    });
  } catch (e: any) {
    logger.error(`[sync-followup-project] 同步失败: ${e.message}`);
    throw e;
  }
}
