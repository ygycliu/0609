/**
 * 跟进 → 审核计划自动生成服务
 *
 * 触发条件：
 *   customer_follow_up.stage 从 implementing 之前的阶段推进到 implementing 时
 *
 * 流程：
 *   1. 读取跟进信息（客户、标准、年份）
 *   2. 选择模板（基于 auditType + standards）
 *   3. 创建 audit_session + audit_checklist_item
 *   4. 关联 follow_up_id
 *   5. 返回审核计划 ID
 */

import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";
import { ValidationError } from "../shared/errors.js";

export interface AutoAuditPlanInput {
  followUpId: string;
  companyId: string;
  customerName: string;
  industry?: string;
  employeeCount?: number;
  auditType: "initial" | "surveillance" | "recertification";
  standards: string[];           // ["iso9001","iso14001","iso45001"]
  certificationType?: string;     // QES / Q / E / S / 27001
  scheduledDate?: string;
  contactPerson?: string;
  contactPhone?: string;
  address?: string;
  createdBy?: string;            // user id
}

export interface AutoAuditPlanResult {
  sessionId: string;
  itemCount: number;
  templateCode: string;
  templateName: string;
  alreadyExisted: boolean;
}

/**
 * 选择模板
 */
async function selectTemplate(companyId: string, standards: string[], auditType: string): Promise<{code: string; name: string; items: any[]} | null> {
  const isQES = standards.length >= 3 ||
    standards.some(s => /^iso(9001|14001|45001)$/i.test(s));

  let templateCode: string;
  if (isQES) {
    if (auditType === "surveillance") templateCode = "QES_SURVEILLANCE";
    else if (auditType === "recertification") templateCode = "QES_RECERT";
    else templateCode = "QES_INITIAL";
  } else {
    if (auditType === "initial" && standards.some(s => /iso9001/i.test(s))) {
      templateCode = "Q_INITIAL";
    } else {
      // 其他组合暂用 QES_INITIAL（通用模板）
      templateCode = "QES_INITIAL";
    }
  }

  // 优先公司级，回退到通用模板（company_id IS NULL）
  const r = await query<{ template_code: string; template_name: string; items: any }>(
    `SELECT template_code, template_name, items
     FROM audit_item_template
     WHERE template_code = $1 AND audit_type = $2
       AND (company_id = $3 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST
     LIMIT 1`,
    [templateCode, auditType, companyId]
  );

  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    code: row.template_code,
    name: row.template_name,
    items: row.items
  };
}

/**
 * 自动生成审核计划（主入口）
 */
export async function autoGenerateAuditPlan(input: AutoAuditPlanInput): Promise<AutoAuditPlanResult> {
  // 1. 检查是否已存在（避免重复生成）
  const existing = await query<{ id: string; item_count: number }>(
    `SELECT s.id, count(i.id) AS item_count
     FROM audit_session s
     LEFT JOIN audit_checklist_item i ON i.session_id = s.id
     WHERE s.follow_up_id = $1 AND s.company_id = $2 AND s.auto_generated = TRUE
     GROUP BY s.id`,
    [input.followUpId, input.companyId]
  );

  if (existing.rows.length > 0) {
    return {
      sessionId: existing.rows[0].id,
      itemCount: parseInt(existing.rows[0].item_count as any, 10),
      templateCode: "(existing)",
      templateName: "已存在的自动计划",
      alreadyExisted: true
    };
  }

  // 2. 选择模板
  const tpl = await selectTemplate(input.companyId, input.standards, input.auditType);
  if (!tpl) {
    throw new ValidationError(
      `未找到匹配标准的模板（standards: ${input.standards.join(",")}, type: ${input.auditType}）`
    );
  }

  // 3. 创建 audit_session
  const sessionId = randomUUID();
  await query(
    `INSERT INTO audit_session
      (id, company_id, customer_name, industry, employee_count, audit_type, standards,
       address, contact_person, contact_phone, scheduled_date,
       created_by, follow_up_id, auto_generated, attachments_ready)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, FALSE)`,
    [
      sessionId, input.companyId, input.customerName,
      input.industry ?? null, input.employeeCount ?? null,
      input.auditType, input.standards,
      input.address ?? null, input.contactPerson ?? null,
      input.contactPhone ?? null, input.scheduledDate ?? null,
      input.createdBy ?? null, input.followUpId
    ]
  );

  // 4. 插入审核项
  const items = Array.isArray(tpl.items) ? tpl.items : [];
  for (let i = 0; i < items.length; i++) {
    const it: any = items[i];
    await query(
      `INSERT INTO audit_checklist_item
        (session_id, clause, standard, department, question, evidence, result, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', '', $7)`,
      [
        sessionId,
        it.clause ?? "",
        it.standard ?? "All",
        it.department ?? "综合部",
        it.question ?? "",
        it.evidence ?? "",
        i
      ]
    );
  }

  return {
    sessionId,
    itemCount: items.length,
    templateCode: tpl.code,
    templateName: tpl.name,
    alreadyExisted: false
  };
}

/**
 * 列出公司级可用模板
 */
export async function listTemplates(companyId?: string) {
  const r = await query<{ template_code: string; template_name: string; standards: string[]; audit_type: string; jsonb_array_length: number }>(
    `SELECT template_code, template_name, standards, audit_type,
            jsonb_array_length(items) AS item_count
     FROM audit_item_template
     WHERE is_active = TRUE AND (company_id = $1 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST, template_code`,
    [companyId ?? null]
  );
  return r.rows;
}