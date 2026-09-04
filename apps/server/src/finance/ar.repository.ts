/**
 * 财务管理 - 应收账款 (AR) 仓储
 */
import { query } from "../db/pool.js";

export interface ARRecord {
  id: string;
  customerId: string;
  customerName?: string;
  projectId: string | null;
  projectCode?: string | null;
  arNo: string;
  title: string;
  description: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  status: string;
  overdueDays: number;
  lastRemindAt: string | null;
  remindCount: number;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ARPaymentRecord {
  id: string;
  arId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
}

function rowToAR(r: any): ARRecord {
  const total = Number(r.total_amount) || 0;
  const paid = Number(r.paid_amount) || 0;
  // 动态计算 overdue_days（因为不能用 GENERATED 列）
  let overdueDays = Number(r.overdue_days) || 0;
  if (!r.paid_at && r.due_date) {
    const due = new Date(r.due_date).getTime();
    const now = Date.now();
    if (now > due) {
      overdueDays = Math.floor((now - due) / (1000 * 60 * 60 * 24));
    }
  }
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    projectId: r.project_id,
    projectCode: r.project_code,
    arNo: r.ar_no,
    title: r.title,
    description: r.description,
    totalAmount: total,
    paidAmount: paid,
    remainingAmount: Math.max(0, total - paid),
    issueDate: r.issue_date,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    status: r.status,
    overdueDays,
    lastRemindAt: r.last_remind_at,
    remindCount: r.remind_count,
    ownerUserId: r.owner_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

const AR_SELECT = `
  SELECT ar.*, c.name AS customer_name, p.project_code
  FROM finance_ar ar
  LEFT JOIN customer c ON c.id = ar.customer_id
  LEFT JOIN finance_project p ON p.id = ar.project_id
`;

export class ARRepository {
  // 列出 AR
  async listAR(companyId: string, options: {
    customerId?: string;
    status?: string;
    overdueOnly?: boolean;
    offset?: number;
    limit?: number;
  } = {}): Promise<{ items: ARRecord[]; total: number; totalAmount: number; remainingAmount: number }> {
    const { customerId, status, overdueOnly, offset = 0, limit = 50 } = options;
    const conditions: string[] = ["ar.company_id = $1", "ar.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (customerId && customerId.trim()) {
      conditions.push(`ar.customer_id = $${paramIdx}`);
      params.push(customerId);
      paramIdx++;
    }
    if (status && status.trim()) {
      conditions.push(`ar.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (overdueOnly) {
      conditions.push(`ar.paid_at IS NULL AND ar.due_date < NOW()`);
    }
    const where = conditions.join(" AND ");

    const items = await query<any>(
      `${AR_SELECT} WHERE ${where}
       ORDER BY ar.due_date ASC, ar.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string, total: string, remaining: string }>(
      `SELECT count(*) AS count,
              COALESCE(SUM(ar.total_amount), 0) AS total,
              COALESCE(SUM(ar.total_amount - ar.paid_amount), 0) AS remaining
       FROM finance_ar ar WHERE ${where}`,
      params
    );
    return {
      items: items.rows.map(rowToAR),
      total: parseInt(total.rows[0].count, 10),
      totalAmount: Number(total.rows[0].total) || 0,
      remainingAmount: Number(total.rows[0].remaining) || 0
    };
  }

  // 按客户聚合 Top 10
  async getARTopByCustomer(companyId: string, limit = 10): Promise<Array<{
    customerId: string;
    customerName: string;
    arCount: number;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    maxOverdueDays: number;
  }>> {
    const r = await query<{
      customer_id: string;
      customer_name: string;
      ar_count: string;
      total_amount: string;
      paid_amount: string;
      remaining_amount: string;
      max_overdue: string;
    }>(
      `SELECT
         ar.customer_id,
         c.name AS customer_name,
         COUNT(*) AS ar_count,
         COALESCE(SUM(ar.total_amount), 0) AS total_amount,
         COALESCE(SUM(ar.paid_amount), 0) AS paid_amount,
         COALESCE(SUM(ar.total_amount - ar.paid_amount), 0) AS remaining_amount,
         COALESCE(MAX(
           CASE WHEN ar.paid_at IS NULL AND ar.due_date < NOW()
                THEN EXTRACT(DAY FROM NOW() - ar.due_date)::INT
                ELSE 0 END
         ), 0) AS max_overdue
       FROM finance_ar ar
       LEFT JOIN customer c ON c.id = ar.customer_id
       WHERE ar.company_id = $1
         AND ar.deleted_at IS NULL
         AND ar.paid_at IS NULL
         AND ar.status NOT IN ('paid', 'cancelled')
       GROUP BY ar.customer_id, c.name
       HAVING SUM(ar.total_amount - ar.paid_amount) > 0
       ORDER BY remaining_amount DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return r.rows.map(row => ({
      customerId: row.customer_id,
      customerName: row.customer_name ?? "未关联客户",
      arCount: parseInt(row.ar_count, 10),
      totalAmount: Number(row.total_amount),
      paidAmount: Number(row.paid_amount),
      remainingAmount: Number(row.remaining_amount),
      maxOverdueDays: parseInt(row.max_overdue, 10)
    }));
  }

  /**
   * V2.0：智能应收账款 Top N（从 finance_transaction 收入聚合）
   *
   * 适用场景：未建立正式 finance_ar 档案，但想看客户应收估算
   * 算法：
   *   - 总应收 = SUM(income.amount) by customer
   *   - 已收 = SUM(income.amount)（所有 income 视为已收）
   *   - 未收 = 总应收 - 已收 = 0（保留字段，未来扩展）
   *   - 逾期天数 = trans_date 到今天（用作"未确认应收"指标）
   *
   * 注意：此为估算值，仅供参考。正式场景请用 finance_ar 表。
   */
  async getARTopByCustomerSmart(companyId: string, options: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}): Promise<Array<{
    customerId: string;
    customerName: string;
    arCount: number;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    maxOverdueDays: number;
    source: "smart";
  }>> {
    const { startDate, endDate, limit = 10 } = options;
    const conditions: string[] = [
      "t.company_id = $1",
      "t.deleted_at IS NULL",
      "t.type = 'income'"
    ];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (startDate) {
      conditions.push(`t.trans_month >= $${paramIdx}`);
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      conditions.push(`t.trans_month <= $${paramIdx}`);
      params.push(endDate);
      paramIdx++;
    }

    const where = conditions.join(" AND ");

    // 智能聚合：每个客户的收入总额 + 交易笔数 + 最近一次交易距今天数
    const r = await query<any>(
      `SELECT
         t.customer_id,
         c.name AS customer_name,
         COUNT(*) AS ar_count,
         COALESCE(SUM(t.amount), 0) AS total_amount,
         COALESCE(SUM(t.amount), 0) AS paid_amount,
         0 AS remaining_amount,
         COALESCE(MAX(
           EXTRACT(DAY FROM NOW() - t.trans_date)::INT
         ), 0) AS max_overdue
       FROM finance_transaction t
       LEFT JOIN customer c ON c.id = t.customer_id
       WHERE ${where} AND t.customer_id IS NOT NULL
       GROUP BY t.customer_id, c.name
       ORDER BY total_amount DESC
       LIMIT $${paramIdx}`,
      [...params, limit]
    );
    return r.rows.map((row: any) => ({
      customerId: row.customer_id,
      customerName: row.customer_name ?? "未关联客户",
      arCount: parseInt(row.ar_count, 10),
      totalAmount: Number(row.total_amount),
      paidAmount: Number(row.paid_amount),
      remainingAmount: Number(row.remaining_amount),
      maxOverdueDays: parseInt(row.max_overdue, 10),
      source: "smart" as const
    }));
  }

  // 取得 AR 详情
  async getAR(companyId: string, id: string): Promise<ARRecord | null> {
    const r = await query<any>(`${AR_SELECT} WHERE ar.company_id = $1 AND ar.id = $2 AND ar.deleted_at IS NULL`, [companyId, id]);
    if (r.rows.length === 0) return null;
    return rowToAR(r.rows[0]);
  }

  // 取得 AR 的所有收款记录
  async getARPayments(arId: string): Promise<ARPaymentRecord[]> {
    const r = await query<any>(
      `SELECT * FROM finance_ar_payment
       WHERE ar_id = $1 AND deleted_at IS NULL
       ORDER BY payment_date ASC, created_at ASC`,
      [arId]
    );
    return r.rows.map(row => ({
      id: row.id,
      arId: row.ar_id,
      amount: Number(row.amount),
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      reference: row.reference,
      notes: row.notes
    }));
  }

  // 创建 AR
  async createAR(companyId: string, input: Partial<ARRecord>): Promise<ARRecord | null> {
    const r = await query<{ id: string }>(
      `INSERT INTO finance_ar
        (company_id, customer_id, project_id, ar_no, title, description,
         total_amount, paid_amount, issue_date, due_date, status, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        companyId,
        input.customerId,
        input.projectId || null,
        input.arNo || "",
        input.title || "",
        input.description || null,
        input.totalAmount ?? 0,
        input.paidAmount ?? 0,
        input.issueDate || new Date().toISOString(),
        input.dueDate || new Date().toISOString(),
        input.status || "pending",
        input.ownerUserId || null
      ]
    );
    if (r.rows.length === 0) return null;
    return this.getAR(companyId, r.rows[0].id);
  }

  // 更新 AR
  async updateAR(companyId: string, id: string, input: Partial<ARRecord>): Promise<ARRecord | null> {
    const map: Record<string, string> = {
      customerId: "customer_id",
      projectId: "project_id",
      arNo: "ar_no",
      title: "title",
      description: "description",
      totalAmount: "total_amount",
      paidAmount: "paid_amount",
      issueDate: "issue_date",
      dueDate: "due_date",
      status: "owner_user_id"
    };
    // 修正 owner_user_id 映射
    map.status = "status";
    map.ownerUserId = "owner_user_id";

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
    if (fields.length === 0) return this.getAR(companyId, id);

    fields.push(`updated_at = NOW()`);
    params.push(companyId);
    params.push(id);

    await query(
      `UPDATE finance_ar SET ${fields.join(", ")}
       WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL`,
      params
    );
    return this.getAR(companyId, id);
  }

  // 软删除 AR
  async deleteAR(companyId: string, id: string): Promise<boolean> {
    const r = await query(
      `UPDATE finance_ar SET deleted_at = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // 添加收款记录
  async addPayment(companyId: string, arId: string, input: Partial<ARPaymentRecord>): Promise<ARPaymentRecord | null> {
    const r = await query<{ id: string }>(
      `INSERT INTO finance_ar_payment
        (company_id, ar_id, amount, payment_date, payment_method, reference, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        companyId,
        arId,
        input.amount ?? 0,
        input.paymentDate || new Date().toISOString(),
        input.paymentMethod || null,
        input.reference || null,
        input.notes || null
      ]
    );
    if (r.rows.length === 0) return null;

    // 更新 AR 的 paid_amount
    const total = await query<{ total: string }>(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM finance_ar_payment WHERE ar_id = $1 AND deleted_at IS NULL",
      [arId]
    );
    const paidAmount = Number(total.rows[0].total) || 0;

    // 查 AR 总金额，判断状态
    const ar = await this.getAR(companyId, arId);
    let newStatus = "partial";
    let paidAt: string | null = null;
    if (ar && paidAmount >= ar.totalAmount) {
      newStatus = "paid";
      paidAt = new Date().toISOString();
    }

    await query(
      `UPDATE finance_ar SET paid_amount = $1, status = $2, paid_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [paidAmount, newStatus, paidAt, arId]
    );

    return {
      id: r.rows[0].id,
      arId,
      amount: input.amount ?? 0,
      paymentDate: input.paymentDate || new Date().toISOString(),
      paymentMethod: input.paymentMethod || null,
      reference: input.reference || null,
      notes: input.notes || null
    };
  }
}