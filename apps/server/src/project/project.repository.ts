/**
 * 认证项目仓库（2.0 业务主线）
 *
 * 业务主档：certification_project
 * 关联表：signatory, service_type, partner_cert_unit,
 *         project_task, project_document, project_payment,
 *         project_invoice, project_review, project_correction,
 *         project_certificate, project_shipment, project_log,
 *         project_status_log
 */
import { query, withTransaction } from "../db/pool.js";

export async function queryOne<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const r = await query(sql, params);
  return r.rows.length > 0 ? (r.rows[0] as T) : null;
}


export type ProjectStatus =
  | "lead"              // 线索
  | "communicating"     // 沟通中
  | "quoted"            // 已报价
  | "contract_pending"  // 待签合同
  | "contract_signed"   // 合同已签
  | "contract_archived" // 合同已归档
  | "first_pay_pending" // 待首付款
  | "first_paid"        // 已收首付款
  | "delivery_prep"     // 交付准备
  | "doc_collecting"    // 资料收集中
  | "contract_review"   // 合同评审中
  | "expert_review_pending" // 待专家评审
  | "expert_reviewing"  // 现场/远程评审中
  | "correcting"        // 整改中
  | "final_pay_pending" // 待尾款
  | "invoice_pending"   // 待开票
  | "cert_pending"      // 待出证
  | "certified"         // 已出证
  | "shipment_pending"  // 待邮寄
  | "completed"         // 已完成
  | "suspended"         // 暂停
  | "at_risk"           // 风险/待处理
  | "cancelled";        // 取消

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  lead: "线索",
  communicating: "沟通中",
  quoted: "已报价",
  contract_pending: "待签合同",
  contract_signed: "合同已签",
  contract_archived: "合同已归档",
  first_pay_pending: "待首付款",
  first_paid: "已收首付款",
  delivery_prep: "交付准备",
  doc_collecting: "资料收集中",
  contract_review: "合同评审中",
  expert_review_pending: "待专家评审",
  expert_reviewing: "现场/远程评审中",
  correcting: "整改中",
  final_pay_pending: "待尾款",
  invoice_pending: "待开票",
  cert_pending: "待出证",
  certified: "已出证",
  shipment_pending: "待邮寄",
  completed: "已完成",
  suspended: "暂停",
  at_risk: "风险/待处理",
  cancelled: "取消",
};

/** 状态流转定义：每个状态允许切换到的下一个状态 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
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
  cancelled: [],
};

// 同步给前端使用
export const PROJECT_STATUS_TRANSITIONS_FRONTEND = PROJECT_STATUS_TRANSITIONS;

export interface CertificationProject {
  id: string;
  companyId: string;
  projectCode: string;
  customerId: string;
  customerName: string;
  contactPerson: string | null;
  contactPhone: string | null;
  serviceTypeId: string;
  serviceTypeCode: string;
  serviceTypeName: string;
  signatoryId: string;
  signatoryName: string;
  partnerOrgId: string | null;
  partnerOrgName: string | null;
  industry: string | null;
  certificationScope: string | null;
  certificationStandards: string | null;
  riskLevel: string | null;
  salesSource: string | null;
  contractAmount: number | null;
  paidAmount: number;
  invoiceAmount: number;
  status: ProjectStatus;
  prevStatus: string | null;
  isSuspended: boolean;
  isCancelled: boolean;
  cancelReason: string | null;
  expectedCertDate: string | null;
  actualCertDate: string | null;
  firstPayDate: string | null;
  finalPayDate: string | null;
  nextFollowupDate: string | null;
  lastFollowupDate: string | null;
  groupName: string | null;
  groupExternalId: string | null;
  salesId: string | null;
  salesName: string | null;
  projectOwnerId: string | null;
  projectOwnerName: string | null;
  consultantId: string | null;
  consultantName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewProjectInput {
  companyId: string;
  customerId: string;
  serviceTypeId: string;
  signatoryId: string;
  partnerOrgId?: string;
  contactPerson?: string;
  contactPhone?: string;
  industry?: string;
  certificationScope?: string;
  certificationStandards?: string;
  riskLevel?: string;
  salesSource?: string;
  contractAmount?: number;
  expectedCertDate?: string;
  notes?: string;
  createdBy: string;
}

function rowToProject(r: any): CertificationProject {
  return {
    id: r.id,
    companyId: r.company_id,
    projectCode: r.project_code,
    customerId: r.customer_id,
    customerName: r.customer_name,
    contactPerson: r.contact_name,
    contactPhone: r.contact_phone,
    serviceTypeId: r.service_type_id,
    serviceTypeCode: r.service_type_code,
    serviceTypeName: r.service_type_name,
    signatoryId: r.signing_entity_id,
    signatoryName: r.signing_entity_name,
    partnerOrgId: r.partner_cert_unit_id,
    partnerOrgName: r.partner_cert_unit_name_snapshot,
    industry: r.industry,
    certificationScope: r.certification_scope,
    certificationStandards: r.certification_standards,
    riskLevel: r.risk_level,
    salesSource: r.sales_source,
    contractAmount: r.contract_amount ? Number(r.contract_amount) : null,
    paidAmount: r.paid_amount ? Number(r.paid_amount) : 0,
    invoiceAmount: r.invoice_amount ? Number(r.invoice_amount) : 0,
    status: r.status,
    prevStatus: r.prev_status,
    isSuspended: r.is_suspended,
    isCancelled: r.is_cancelled,
    cancelReason: r.cancel_reason,
    expectedCertDate: r.expected_cert_date
      ? r.expected_cert_date.toISOString().substring(0, 10)
      : null,
    actualCertDate: r.actual_cert_date ? r.actual_cert_date.toISOString().substring(0, 10) : null,
    firstPayDate: r.first_pay_date ? r.first_pay_date.toISOString().substring(0, 10) : null,
    finalPayDate: r.final_pay_date ? r.final_pay_date.toISOString().substring(0, 10) : null,
    nextFollowupDate: r.next_followup_date
      ? r.next_followup_date.toISOString().substring(0, 10)
      : null,
    lastFollowupDate: r.last_followup_date
      ? r.last_followup_date.toISOString().substring(0, 10)
      : null,
    groupName: r.group_name,
    groupExternalId: r.group_external_id,
    salesId: r.sales_id,
    salesName: r.sales_name,
    projectOwnerId: r.project_owner_id,
    projectOwnerName: r.project_owner_name,
    consultantId: r.consultant_id,
    consultantName: r.consultant_name,
    reviewerId: r.reviewer_id,
    reviewerName: r.reviewer_name,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** 生成项目编号 PRJ-YYYY-NNN */
async function generateProjectCode(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const r = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM certification_project
     WHERE company_id = $1 AND project_code LIKE $2`,
    [companyId, `PRJ-${year}-%`]
  );
  const seq = (parseInt(r?.count || "0") + 1).toString().padStart(3, "0");
  return `PRJ-${year}-${seq}`;
}

/** 创建项目 */
export async function createProject(input: NewProjectInput): Promise<CertificationProject> {
  return withTransaction(async (client) => {
    // 校验：服务类型必须存在
    const stRes = await client.query(
      `SELECT name FROM service_type WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [input.serviceTypeId, input.companyId]
    );
    if (stRes.rows.length === 0) throw new Error("服务类型不存在");
    const serviceTypeName = stRes.rows[0].name;

    // 校验：签约主体
    const sigRes = await client.query(
      `SELECT name FROM signing_entity WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [input.signatoryId, input.companyId]
    );
    if (sigRes.rows.length === 0) throw new Error("签约主体不存在");
    const signingEntityName = sigRes.rows[0].name;

    // 校验：客户
    const custRes = await client.query(
      `SELECT name FROM customer WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [input.customerId, input.companyId]
    );
    if (custRes.rows.length === 0) throw new Error("客户不存在");
    const customerName = custRes.rows[0].name;

    // 校验：外协（可选）
    let partnerCertUnitId = input.partnerOrgId ?? null;
    let partnerCertUnitNameSnapshot: string | null = null;
    if (partnerCertUnitId) {
      const pRes = await client.query(
        `SELECT name FROM partner_cert_unit
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [partnerCertUnitId, input.companyId]
      );
      if (pRes.rows.length === 0) {
        partnerCertUnitId = null;
      } else {
        partnerCertUnitNameSnapshot = pRes.rows[0].name;
      }
    }

    const code = await generateProjectCode(input.companyId);

    // 拿服务类型 code
    const stCodeRes = await client.query(
      `SELECT code FROM service_type WHERE id = $1`,
      [input.serviceTypeId]
    );
    const serviceTypeCode = stCodeRes.rows[0].code;

    const r = await client.query(
      `INSERT INTO certification_project
       (company_id, project_code, customer_id, customer_name, contact_person, contact_phone,
        service_type_id, service_type_code, service_type_name,
        signing_entity_id, signing_entity_name, partner_cert_unit_id, partner_cert_unit_name_snapshot,
        industry, certification_scope, certification_standards,
        risk_level, sales_source, contract_amount, expected_cert_date,
        notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [
        input.companyId, code, input.customerId, customerName,
        input.contactPerson ?? null, input.contactPhone ?? null,
        input.serviceTypeId, serviceTypeCode, serviceTypeName,
        input.signatoryId, signingEntityName, partnerCertUnitId, partnerCertUnitNameSnapshot,
        input.industry ?? null, input.certificationScope ?? null,
        input.certificationStandards ?? null,
        input.riskLevel ?? null, input.salesSource ?? null,
        input.contractAmount ?? null, input.expectedCertDate ?? null,
        input.notes ?? null, input.createdBy
      ]
    );
    const project = rowToProject(r.rows[0]);

    // 写日志
    await client.query(
      `INSERT INTO project_event (company_id, project_id, from_status, to_status, operator_id, note)
       VALUES ($1, $2, NULL, $3, $4, '项目创建')`,
      [input.companyId, project.id, project.status, input.createdBy]
    );

    // 写操作日志
    await client.query(
      `INSERT INTO project_log (company_id, project_id, action, entity_type, entity_id, detail, operator_id, operator_name)
       VALUES ($1, $2, 'create', 'project', $3, $4, $5, $6)`,
      [
        input.companyId,
        project.id,
        project.id,
        JSON.stringify({ status: project.status, customer: customerName }),
        input.createdBy,
        input.createdBy, // todo: 取用户名
      ]
    );

    return project;
  });
}

/** 列出项目 */
export async function listProjects(
  companyId: string,
  filter: {
    status?: ProjectStatus | "all";
    customerId?: string;
    ownerId?: string;
    overdue?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: CertificationProject[]; total: number }> {
  const where: string[] = ["company_id = $1", "deleted_at IS NULL"];
  const params: any[] = [companyId];
  let idx = 2;

  if (filter.status && filter.status !== "all") {
    where.push(`status = $${idx}`);
    params.push(filter.status);
    idx++;
  }
  if (filter.customerId) {
    where.push(`customer_id = $${idx}`);
    params.push(filter.customerId);
    idx++;
  }
  if (filter.ownerId) {
    where.push(`project_owner_id = $${idx}`);
    params.push(filter.ownerId);
    idx++;
  }
  if (filter.overdue) {
    where.push(`next_followup_date IS NOT NULL AND next_followup_date < CURRENT_DATE`);
  }

  const whereStr = where.join(" AND ");
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const r = await query(
    `SELECT *, COUNT(*) OVER() AS total_count FROM certification_project
     WHERE ${whereStr}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const total = r.rows.length > 0 ? parseInt(r.rows[0].total_count) : 0;
  return {
    data: r.rows.map((row) => rowToProject({ ...row, total_count: undefined })),
    total,
  };
}

/** 项目详情 */
export async function getProject(companyId: string, id: string): Promise<CertificationProject | null> {
  const r = await queryOne<any>(
    `SELECT * FROM certification_project
     WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [companyId, id]
  );
  return r ? rowToProject(r) : null;
}

/** 变更项目状态 */
export async function changeProjectStatus(
  companyId: string,
  projectId: string,
  newStatus: ProjectStatus,
  reason: string | null,
  operatorId: string,
  operatorName: string | null
): Promise<CertificationProject> {
  return withTransaction(async (client) => {
    const cur = await client.query(
      `SELECT status FROM certification_project
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [companyId, projectId]
    );
    if (cur.rows.length === 0) throw new Error("项目不存在");
    const oldStatus = cur.rows[0].status as ProjectStatus;

    // 状态流转校验
    const allowed = PROJECT_STATUS_TRANSITIONS[oldStatus] || [];
    if (oldStatus !== newStatus && !allowed.includes(newStatus)) {
      throw new Error(`不允许从 ${oldStatus} 直接跳到 ${newStatus}`);
    }

    await client.query(
      `UPDATE certification_project
       SET status = $3::varchar, prev_status = $4::varchar,
           is_suspended = ($3 = 'suspended'),
           is_cancelled = ($3 = 'cancelled'),
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [projectId, companyId, newStatus, oldStatus]
    );

    await client.query(
      `INSERT INTO project_event
       (company_id, project_id, from_status, to_status, reason, operator_id, operator_name)
       VALUES ($1, $2, $3::varchar, $4::varchar, $5::text, $6, $7::varchar)`,
      [companyId, projectId, oldStatus, newStatus, reason, operatorId, operatorName]
    );

    const updated = await client.query(
      `SELECT * FROM certification_project WHERE id = $1`,
      [projectId]
    );
    const project = rowToProject(updated.rows[0]);

    // 自动生成待办：基于状态变更到关键节点
    const autoTodos: Record<string, { title: string; days: number; priority: string; description: string }> = {
      contract_signed: { title: "催收合同首付款", days: 3, priority: "high", description: "合同已签订，3 个工作日内催收首付款（70%）" },
      contract_archived: { title: "准备首次评审", days: 14, priority: "medium", description: "合同已归档，开始安排首次评审" },
      expert_review_pending: { title: "安排专家评审", days: 7, priority: "high", description: "待专家评审，安排评审时间和评审员" },
      expert_reviewing: { title: "跟进评审进度", days: 5, priority: "medium", description: "评审进行中，每日跟进" },
      correcting: { title: "跟进整改进度", days: 7, priority: "high", description: "整改中，请确保 7 天内完成整改" },
      cert_pending: { title: "准备证书文件", days: 3, priority: "high", description: "待出证，准备证书文件" },
      certified: { title: "安排证书邮寄", days: 3, priority: "high", description: "证书已出，安排邮寄给客户" },
      shipment_pending: { title: "跟进证书寄达", days: 7, priority: "medium", description: "证书已寄出，跟踪客户签收" },
    };
    if (autoTodos[newStatus]) {
      const todo = autoTodos[newStatus];
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + todo.days);
      await query(
        `INSERT INTO todo
          (company_id, owner_user_id, assigned_to, title, description, category,
           source, source_ref, status, priority, due_at, customer_id, tags, metadata)
         VALUES ($1, $2, $2, $3, $4, 'project_followup', 'project_status',
                 $5, 'pending', $6, $7, $8, $9, $10)`,
        [
          companyId,
          operatorId,
          `${todo.title}（${project.projectCode}）`,
          todo.description,
          projectId,
          todo.priority,
          dueDate.toISOString(),
          project.customerId,
          JSON.stringify(["project", `status:${newStatus}`]),
          JSON.stringify({ projectId, newStatus, from: oldStatus, projectCode: project.projectCode, customerName: project.customerName })
        ]
      );
    }

    return project;
  });
}

/** 项目看板：状态分布 */
export async function getProjectStats(
  companyId: string
): Promise<Record<string, number>> {
  const r = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM certification_project
     WHERE company_id = $1 AND deleted_at IS NULL GROUP BY status`,
    [companyId]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    out[row.status] = parseInt(row.count);
  }
  return out;
}

/** 逾期项目（next_followup_date < 当前日期）*/
export async function listOverdueProjects(
  companyId: string
): Promise<CertificationProject[]> {
  const r = await query<any>(
    `SELECT * FROM certification_project
     WHERE company_id = $1 AND deleted_at IS NULL
       AND next_followup_date IS NOT NULL
       AND next_followup_date < CURRENT_DATE
     ORDER BY next_followup_date ASC LIMIT 50`,
    [companyId]
  );
  return r.rows.map(rowToProject);
}

/** 待回款项目（状态=待尾款）*/
export async function listPendingPaymentProjects(
  companyId: string
): Promise<CertificationProject[]> {
  const r = await query<any>(
    `SELECT * FROM certification_project
     WHERE company_id = $1 AND deleted_at IS NULL
       AND status IN ('final_pay_pending', 'first_pay_pending')
     ORDER BY created_at ASC LIMIT 50`,
    [companyId]
  );
  return r.rows.map(rowToProject);
}

/** 待出证项目 */
export async function listPendingCertProjects(
  companyId: string
): Promise<CertificationProject[]> {
  const r = await query<any>(
    `SELECT * FROM certification_project
     WHERE company_id = $1 AND deleted_at IS NULL
       AND status = 'cert_pending'
     ORDER BY created_at ASC LIMIT 50`,
    [companyId]
  );
  return r.rows.map(rowToProject);
}

/** 项目时间线（合并状态日志 + 操作日志）*/
export async function getProjectTimeline(
  companyId: string,
  projectId: string
): Promise<Array<{
  at: string;
  type: "status" | "log";
  action?: string;
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
  note?: string;
  operatorName?: string;
}>> {
  const events: any[] = [];

  // 状态日志
  const statusR = await query<any>(
    `SELECT * FROM project_event
     WHERE company_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
    [companyId, projectId]
  );
  for (const r of statusR.rows) {
    events.push({
      at: r.created_at.toISOString(),
      type: "status",
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason,
      note: r.note,
      operatorName: r.operator_name,
    });
  }

  // 操作日志
  const logR = await query<any>(
    `SELECT * FROM project_log
     WHERE company_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
    [companyId, projectId]
  );
  for (const r of logR.rows) {
    events.push({
      at: r.created_at.toISOString(),
      type: "log",
      action: r.action,
      note: r.detail,
      operatorName: r.operator_name,
    });
  }

  // 合并按时间排序
  events.sort((a, b) => (a.at > b.at ? -1 : 1));
  return events;
}

// 列出签约主体
export async function listSignatories(companyId: string) {
  const r = await query<any>(
    `SELECT * FROM signing_entity WHERE company_id = $1 AND deleted_at IS NULL ORDER BY entity_code`,
    [companyId]
  );
  return r.rows;
}

// 列出服务类型
export async function listServiceTypes(companyId: string) {
  const r = await query<any>(
    `SELECT * FROM service_type WHERE company_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
    [companyId]
  );
  return r.rows;
}

// 列出合作认证单位
export async function listPartnerOrgs(companyId: string) {
  const r = await query<any>(
    `SELECT * FROM partner_cert_unit WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [companyId]
  );
  return r.rows;
}

// 新建合作认证单位
export async function createPartnerOrg(
  companyId: string,
  input: { name: string; contactPerson?: string; contactPhone?: string; address?: string; notes?: string; createdBy: string }
) {
  const r = await query<any>(
    `INSERT INTO partner_cert_unit (company_id, name, contact_name, contact_phone, address, remark, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [companyId, input.name, input.contactPerson ?? null, input.contactPhone ?? null,
     input.address ?? null, input.notes ?? null, input.createdBy]
  );
  return r.rows[0];
}
