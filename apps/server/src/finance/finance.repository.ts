/**
 * 财务管理 - 项目 + 流水仓储
 */
import { query } from "../db/pool.js";
import { CustomerRepository } from "../customers/customer.repository.js";

const customerRepository = new CustomerRepository();

export interface ProjectRecord {
  id: string;
  customerId: string | null;
  certificationProjectId: string | null;  // V2.1：关联到具体认证项目
  projectCode: string;
  name: string;
  certificationType: string | null;
  serviceType: string | null;
  contractAmount: number;
  receivedAmount: number;
  paidAmount: number;
  status: string;
  signedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  deadlineAt: string | null;
  notes: string | null;
  ownerUserId: string | null;
  customerName?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string | null;
}

export interface TransactionRecord {
  id: string;
  projectId: string | null;
  customerId: string | null;
  certificationProjectId: string | null;  // V2.1：冗余字段
  type: "income" | "expense";
  category: string;
  amount: number;
  transDate: string;
  transMonth?: string | null;  // V2.0：业务归属月份（YYYY-MM-01）
  description: string | null;
  paymentMethod: string | null;
  reference: string | null;
  ps: string | null;
  invoiceNo: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  createdAt: string;
  updatedAt: string | null;
}

function rowToProject(r: any): ProjectRecord {
  return {
    id: r.id,
    customerId: r.customer_id,
    certificationProjectId: r.certification_project_id,  // V2.1
    projectCode: r.project_code,
    name: r.name,
    certificationType: r.certification_type,
    serviceType: r.service_type,
    contractAmount: Number(r.contract_amount ?? 0),
    receivedAmount: Number(r.received_amount ?? 0),
    paidAmount: Number(r.paid_amount ?? 0),
    status: r.status,
    signedAt: r.signed_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    deadlineAt: r.deadline_at,
    notes: r.notes,
    ownerUserId: r.owner_user_id,
    customerName: r.customer_name,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function rowToTransaction(r: any): TransactionRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    customerId: r.customer_id,
    certificationProjectId: r.certification_project_id,  // V2.1
    type: r.type,
    category: r.category,
    amount: Number(r.amount ?? 0),
    transDate: r.trans_date,
    transMonth: r.trans_month ?? null,  // V2.0：业务归属月份
    description: r.description,
    paymentMethod: r.payment_method,
    reference: r.reference,
    ps: r.ps,
    invoiceNo: r.invoice_no,
    projectCode: r.project_code,
    projectName: r.project_name,
    customerName: r.customer_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/**
 * V2.0：从 description 或 transDate 推导 trans_month
 * 优先级：
 * 1. description 开头 "YYYY-MM |"
 * 2. transDate 的月份
 * 3. 当前月
 */
export function deriveTransMonth(transDate?: string, description?: string | null): string {
  // 1. 从 description 提取
  if (description) {
    const m = String(description).match(/^(\d{4})-(\d{2})\s*\|/);
    if (m) {
      return `${m[1]}-${m[2]}-01`;
    }
  }
  // 2. 从 transDate 取月份
  if (transDate) {
    const d = new Date(transDate);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    }
  }
  // 3. 当前月
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

const PROJECT_SELECT = `
  SELECT p.*, c.name AS customer_name
  FROM finance_project p
  LEFT JOIN customer c ON c.id = p.customer_id AND c.deleted_at IS NULL
`;

const TX_SELECT = `
  SELECT t.*,
    p.project_code, p.name AS project_name,
    c.name AS customer_name
  FROM finance_transaction t
  LEFT JOIN finance_project p ON p.id = t.project_id
  LEFT JOIN customer c ON c.id = t.customer_id AND c.deleted_at IS NULL
`;

export class FinanceRepository {
  // ==================== Project ====================
  async listProjects(companyId: string, options: {
    q?: string;
    status?: string;
    customerId?: string;
    offset?: number;
    limit?: number;
  } = {}): Promise<{ items: ProjectRecord[]; total: number }> {
    const { q, status, customerId, offset = 0, limit = 50 } = options;
    const conditions: string[] = ["p.company_id = $1", "p.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (q && q.trim()) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.project_code ILIKE $${paramIdx})`);
      params.push(`%${q.trim()}%`);
      paramIdx++;
    }
    if (status && status.trim()) {
      conditions.push(`p.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (customerId && customerId.trim()) {
      conditions.push(`p.customer_id = $${paramIdx}`);
      params.push(customerId);
      paramIdx++;
    }

    const where = conditions.join(" AND ");
    const items = await query<any>(
      `${PROJECT_SELECT} WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT count(*) FROM finance_project p WHERE ${where}`,
      params
    );
    return {
      items: items.rows.map(rowToProject),
      total: parseInt(total.rows[0].count, 10)
    };
  }

  async getProject(companyId: string, id: string): Promise<ProjectRecord | null> {
    const r = await query<any>(
      `${PROJECT_SELECT} WHERE p.company_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`,
      [companyId, id]
    );
    if (r.rows.length === 0) return null;
    return rowToProject(r.rows[0]);
  }

  async createProject(companyId: string, input: Partial<ProjectRecord>): Promise<ProjectRecord | null> {
    const r = await query<any>(
      `INSERT INTO finance_project
        (company_id, customer_id, certification_project_id, project_code, name, certification_type, service_type,
         contract_amount, status, signed_at, started_at, completed_at, deadline_at,
         notes, owner_user_id, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        companyId,
        input.customerId || null,
        input.certificationProjectId || null,  // V2.1
        input.projectCode || "",
        input.name || "",
        input.certificationType || null,
        input.serviceType || null,
        input.contractAmount || 0,
        input.status || "draft",
        input.signedAt || null,
        input.startedAt || null,
        input.completedAt || null,
        input.deadlineAt || null,
        input.notes || null,
        input.ownerUserId || null,
        input.tags || []
      ]
    );
    if (r.rows.length === 0) return null;
    return this.getProject(companyId, r.rows[0].id);
  }

  async updateProject(companyId: string, id: string, input: Partial<ProjectRecord>): Promise<ProjectRecord | null> {
    const map: Record<string, string> = {
      customerId: "customer_id",
      projectCode: "project_code",
      name: "name",
      certificationType: "certification_type",
      serviceType: "service_type",
      contractAmount: "contract_amount",
      status: "status",
      signedAt: "signed_at",
      startedAt: "started_at",
      completedAt: "completed_at",
      deadlineAt: "deadline_at",
      notes: "notes",
      ownerUserId: "owner_user_id"
    };
    const fields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const [k, col] of Object.entries(map)) {
      if (k in input) {
        fields.push(`${col} = $${paramIdx}`);
        params.push((input as any)[k]);
        paramIdx++;
      }
    }
    if (input.tags !== undefined) {
      fields.push(`tags = $${paramIdx}::text[]`);
      params.push(input.tags);
      paramIdx++;
    }

    if (fields.length === 0) return this.getProject(companyId, id);

    fields.push(`updated_at = NOW()`);
    params.push(companyId);
    params.push(id);

    await query(
      `UPDATE finance_project SET ${fields.join(", ")}
       WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL`,
      params
    );
    return this.getProject(companyId, id);
  }

  async deleteProject(companyId: string, id: string): Promise<boolean> {
    const r = await query(
      `UPDATE finance_project SET deleted_at = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 重新计算项目的已收/已付（汇总交易流水）
   */
  async recomputeProjectTotals(projectId: string): Promise<void> {
    const r = await query<{ type: string; total: string }>(
      `SELECT type, COALESCE(SUM(amount), 0) AS total
       FROM finance_transaction
       WHERE project_id = $1 AND deleted_at IS NULL
       GROUP BY type`,
      [projectId]
    );
    const received = r.rows.find((x) => x.type === "income")?.total ?? "0";
    const paid = r.rows.find((x) => x.type === "expense")?.total ?? "0";
    await query(
      `UPDATE finance_project
       SET received_amount = $1, paid_amount = $2, updated_at = NOW()
       WHERE id = $3`,
      [received, paid, projectId]
    );
  }

  // ==================== Transaction ====================
  async listTransactions(companyId: string, options: {
    type?: "income" | "expense";
    category?: string;
    projectId?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    /** V2.0：日期字段模式 'trans_date' | 'trans_month'，默认 trans_month */
    dateField?: "trans_date" | "trans_month";
    offset?: number;
    limit?: number;
  } = {}): Promise<{ items: TransactionRecord[]; total: number }> {
    const { type, category, projectId, customerId, startDate, endDate, dateField = "trans_month", offset = 0, limit = 50 } = options;
    const conditions: string[] = ["t.company_id = $1", "t.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (type) {
      conditions.push(`t.type = $${paramIdx}`);
      params.push(type);
      paramIdx++;
    }
    if (category && category.trim()) {
      conditions.push(`t.category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }
    if (projectId && projectId.trim()) {
      conditions.push(`t.project_id = $${paramIdx}`);
      params.push(projectId);
      paramIdx++;
    }
    if (customerId && customerId.trim()) {
      conditions.push(`t.customer_id = $${paramIdx}`);
      params.push(customerId);
      paramIdx++;
    }
    if (startDate) {
      conditions.push(`t.${dateField} >= $${paramIdx}`);
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      conditions.push(`t.${dateField} <= $${paramIdx}`);
      params.push(endDate);
      paramIdx++;
    }

    const where = conditions.join(" AND ");
    const items = await query<any>(
      `${TX_SELECT} WHERE ${where}
       ORDER BY t.trans_date DESC, t.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT count(*) FROM finance_transaction t WHERE ${where}`,
      params
    );
    return {
      items: items.rows.map(rowToTransaction),
      total: parseInt(total.rows[0].count, 10)
    };
  }

  async getTransaction(companyId: string, id: string): Promise<TransactionRecord | null> {
    const r = await query<any>(
      `${TX_SELECT} WHERE t.company_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`,
      [companyId, id]
    );
    if (r.rows.length === 0) return null;
    return rowToTransaction(r.rows[0]);
  }

  async createTransaction(companyId: string, input: Partial<TransactionRecord>): Promise<TransactionRecord | null> {
    // 自动按规则找/建项目（按 customer_id + description）
    let resolvedProjectId = input.projectId || null;
    if (!resolvedProjectId && input.customerId && input.description) {
      const custRes = await query<{ name: string }>(
        "SELECT name FROM customer WHERE id = $1",
        [input.customerId]
      );
      const customerName = custRes.rows[0]?.name || "客户";
      const projectName = `${customerName} | ${input.description}`;

      // 找现有
      const existing = await query<{ id: string }>(
        "SELECT id FROM finance_project WHERE company_id = $1 AND customer_id = $2 AND name = $3 AND deleted_at IS NULL",
        [companyId, input.customerId, projectName]
      );
      if (existing.rows.length > 0) {
        resolvedProjectId = existing.rows[0].id;
      } else {
        // 新建（自动生成 project_code）
        const maxCode = await query<{ max_code: string }>(
          "SELECT COALESCE(MAX(CAST(SUBSTRING(project_code FROM 5) AS INTEGER)), 0) AS max_code FROM finance_project WHERE company_id = $1 AND project_code ~ '^PRJ-[0-9]+$'",
          [companyId]
        );
        const nextNum = (parseInt(maxCode.rows[0]?.max_code || "0", 10) || 0) + 1;
        const newCode = `PRJ-${String(nextNum).padStart(6, "0")}`;
        const projRes = await query<{ id: string }>(
          `INSERT INTO finance_project
            (id, company_id, customer_id, project_code, name, status,
             contract_amount, started_at, notes, created_at, updated_at)
           VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, NOW(), $7, NOW(), NOW())
           RETURNING id`,
          [
            companyId,
            input.customerId,
            newCode,
            projectName,
            "in_progress",
            0,
            "自动从交易创建"
          ]
        );
        resolvedProjectId = projRes.rows[0].id;
      }
    }

    const r = await query<any>(
      `INSERT INTO finance_transaction
        (company_id, project_id, customer_id, certification_project_id, type, category, amount,
         trans_date, trans_month, description, payment_method, reference, ps, invoice_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        companyId,
        resolvedProjectId,
        input.customerId || null,
        input.certificationProjectId || null,  // V2.1
        input.type || "income",
        input.category || "",
        input.amount ?? 0,
        input.transDate || new Date().toISOString(),
        // V2.0：trans_month 优先用传入值，否则从 description 或 transDate 自动提取
        input.transMonth || deriveTransMonth(input.transDate, input.description),
        input.description || null,
        input.paymentMethod || null,
        input.reference || null,
        input.ps || null,
        input.invoiceNo || null
      ]
    );
    if (r.rows.length === 0) return null;

    // 重新计算项目总额
    if (resolvedProjectId) {
      await this.recomputeProjectTotals(resolvedProjectId);
    }

    // 重新计算客户累计营收
    if (r.rows[0].customer_id) {
      await customerRepository.recomputeCustomerTotals(r.rows[0].customer_id);
    }

    return this.getTransaction(companyId, r.rows[0].id);
  }

  async updateTransaction(companyId: string, id: string, input: Partial<TransactionRecord>): Promise<TransactionRecord | null> {
    const map: Record<string, string> = {
      projectId: "project_id",
      customerId: "customer_id",
      type: "type",
      category: "category",
      amount: "amount",
      transDate: "trans_date",
      transMonth: "trans_month",  // V2.0：业务归属月份
      description: "description",
      paymentMethod: "payment_method",
      reference: "reference",
      ps: "ps",
      invoiceNo: "invoice_no"
    };
    const fields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    let oldProjectId: string | undefined;

    for (const [k, col] of Object.entries(map)) {
      if (k in input) {
        fields.push(`${col} = $${paramIdx}`);
        params.push((input as any)[k]);
        paramIdx++;
      }
    }
    if (fields.length === 0) return this.getTransaction(companyId, id);

    fields.push(`updated_at = NOW()`);
    params.push(companyId);
    params.push(id);

    await query(
      `UPDATE finance_transaction SET ${fields.join(", ")}
       WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL
       RETURNING project_id`,
      params
    );
    const updated = await this.getTransaction(companyId, id);

    // 重算项目总额（如果项目变化）
    if (updated && updated.projectId) {
      await this.recomputeProjectTotals(updated.projectId);
    }

    // 重算客户累计营收
    if (updated && updated.customerId) {
      await customerRepository.recomputeCustomerTotals(updated.customerId);
    }

    return updated;
  }

  async deleteTransaction(companyId: string, id: string): Promise<boolean> {
    // 先拿到旧项目ID
    const old = await this.getTransaction(companyId, id);

    const r = await query(
      `UPDATE finance_transaction SET deleted_at = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    const ok = (r.rowCount ?? 0) > 0;

    if (ok && old?.projectId) {
      await this.recomputeProjectTotals(old.projectId);
    }
    if (ok && old?.customerId) {
      await customerRepository.recomputeCustomerTotals(old.customerId);
    }
    return ok;
  }

  // ==================== 统计 ====================
  async getSummary(companyId: string, options: {
    startDate?: string;
    endDate?: string;
    /** V2.0：日期字段模式 'trans_date' | 'trans_month'，默认 trans_month */
    dateField?: "trans_date" | "trans_month";
  } = {}): Promise<{
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
    incomeByCategory: Array<{ category: string; total: number; count: number }>;
    expenseByCategory: Array<{ category: string; total: number; count: number }>;
    incomeByCustomer: Array<{ customerId: string; customerName: string | null; total: number }>;
    expenseByCustomer: Array<{ customerId: string; customerName: string | null; total: number }>;
  }> {
    const { startDate, endDate, dateField = "trans_month" } = options;
    const conditions: string[] = ["t.company_id = $1", "t.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (startDate) {
      conditions.push(`${dateField} >= $${paramIdx}`);
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      conditions.push(`${dateField} <= $${paramIdx}`);
      params.push(endDate);
      paramIdx++;
    }
    const where = conditions.join(" AND ");

    // 总计
    const total = await query<{ type: string; total: string; count: string }>(
      `SELECT type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM finance_transaction t WHERE ${where} GROUP BY type`,
      params
    );
    const totalIncome = Number(total.rows.find((r) => r.type === "income")?.total ?? 0);
    const totalExpense = Number(total.rows.find((r) => r.type === "expense")?.total ?? 0);

    // 按分类
    const incomeByCategory = await query<{ category: string; total: string; count: string }>(
      `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM finance_transaction t
       WHERE ${where} AND t.type = 'income'
       GROUP BY category ORDER BY SUM(t.amount) DESC LIMIT 20`,
      params
    );
    const expenseByCategory = await query<{ category: string; total: string; count: string }>(
      `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM finance_transaction t
       WHERE ${where} AND t.type = 'expense'
       GROUP BY category ORDER BY SUM(t.amount) DESC LIMIT 20`,
      params
    );

    // 按客户
    const incomeByCustomer = await query<{ customer_id: string; customer_name: string | null; total: string }>(
      `SELECT t.customer_id, c.name AS customer_name, SUM(t.amount) AS total
       FROM finance_transaction t
       LEFT JOIN customer c ON c.id = t.customer_id
       WHERE ${where} AND t.type = 'income' AND t.customer_id IS NOT NULL
       GROUP BY t.customer_id, c.name ORDER BY SUM(t.amount) DESC LIMIT 10`,
      params
    );
    const expenseByCustomer = await query<{ customer_id: string; customer_name: string | null; total: string }>(
      `SELECT t.customer_id, c.name AS customer_name, SUM(t.amount) AS total
       FROM finance_transaction t
       LEFT JOIN customer c ON c.id = t.customer_id
       WHERE ${where} AND t.type = 'expense' AND t.customer_id IS NOT NULL
       GROUP BY t.customer_id, c.name ORDER BY SUM(t.amount) DESC LIMIT 10`,
      params
    );

    return {
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
      incomeByCategory: incomeByCategory.rows.map((r) => ({
        category: r.category,
        total: Number(r.total),
        count: Number(r.count)
      })),
      expenseByCategory: expenseByCategory.rows.map((r) => ({
        category: r.category,
        total: Number(r.total),
        count: Number(r.count)
      })),
      incomeByCustomer: incomeByCustomer.rows.map((r) => ({
        customerId: r.customer_id,
        customerName: r.customer_name ?? null,
        total: Number(r.total)
      })),
      expenseByCustomer: expenseByCustomer.rows.map((r) => ({
        customerId: r.customer_id,
        customerName: r.customer_name ?? null,
        total: Number(r.total)
      }))
    };
  }
}