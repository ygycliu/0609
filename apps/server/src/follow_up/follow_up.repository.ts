/**
 * 客户跟进 (Follow-up) 仓储
 */
import { query } from "../db/pool.js";

// 阶段定义
export const FOLLOW_UP_STAGES = [
  { key: "expired",         label: "到期",          color: "orange",  order: 1 },
  { key: "quoted",           label: "已报价",        color: "blue",    order: 2 },
  { key: "contract_review",  label: "合同评审",      color: "purple",  order: 3 },
  { key: "contract_signed",  label: "合同签订",      color: "cyan",    order: 4 },
  { key: "implementing",     label: "项目实施",      color: "indigo",  order: 5 },
  { key: "certified",        label: "出证",          color: "teal",    order: 6 },
  { key: "completed",        label: "完成",          color: "green",   order: 7 },
];

export function getStageInfo(key: string) {
  return FOLLOW_UP_STAGES.find(s => s.key === key) || { key, label: key, color: "gray", order: 99 };
}

export interface FollowUpRecord {
  id: string;
  customerId: string;
  customerName?: string;
  projectId: string | null;
  projectCode?: string | null;
  certificationType: string | null;
  stage: string;
  year: number;
  expectedDate: string | null;
  completedAt: string | null;
  expectedAmount: number | null;
  contractAmount: number | null;
  notes: string | null;
  metadata: any;
  ownerUserId: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  archivedYear: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface FollowUpLogRecord {
  id: string;
  followUpId: string;
  fromStage: string | null;
  toStage: string;
  notes: string | null;
  changedBy: string | null;
  changedAt: string;
}

function rowToFollowUp(r: any): FollowUpRecord {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    projectId: r.project_id,
    projectCode: r.project_code,
    certificationType: r.certification_type,
    stage: r.stage,
    year: r.year,
    expectedDate: r.expected_date,
    completedAt: r.completed_at,
    expectedAmount: r.expected_amount != null ? Number(r.expected_amount) : null,
    contractAmount: r.contract_amount != null ? Number(r.contract_amount) : null,
    notes: r.notes,
    metadata: r.metadata,
    ownerUserId: r.owner_user_id,
    isArchived: r.is_archived,
    archivedAt: r.archived_at,
    archivedYear: r.archived_year,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

const FOLLOW_UP_SELECT = `
  SELECT f.*, c.name AS customer_name, p.project_code
  FROM customer_follow_up f
  LEFT JOIN customer c ON c.id = f.customer_id
  LEFT JOIN finance_project p ON p.id = f.project_id
`;

export class FollowUpRepository {
  /**
   * 列出跟进记录
   */
  async listFollowUps(companyId: string, options: {
    customerId?: string;
    stage?: string;
    year?: number;
    isArchived?: boolean;
    offset?: number;
    limit?: number;
  } = {}): Promise<{ items: FollowUpRecord[]; total: number }> {
    const { customerId, stage, year, isArchived, offset = 0, limit = 50 } = options;
    const conditions: string[] = ["f.company_id = $1", "f.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (customerId && customerId.trim()) {
      conditions.push(`f.customer_id = $${paramIdx}`);
      params.push(customerId);
      paramIdx++;
    }
    if (stage && stage.trim()) {
      conditions.push(`f.stage = $${paramIdx}`);
      params.push(stage);
      paramIdx++;
    }
    if (year) {
      conditions.push(`f.year = $${paramIdx}`);
      params.push(year);
      paramIdx++;
    }
    if (isArchived !== undefined) {
      conditions.push(`f.is_archived = $${paramIdx}`);
      params.push(isArchived);
      paramIdx++;
    }

    const where = conditions.join(" AND ");

    const items = await query<any>(
      `${FOLLOW_UP_SELECT} WHERE ${where}
       ORDER BY f.is_archived ASC, f.updated_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT count(*) FROM customer_follow_up f WHERE ${where}`,
      params
    );

    return {
      items: items.rows.map(rowToFollowUp),
      total: parseInt(total.rows[0].count, 10)
    };
  }

  async getFollowUp(companyId: string, id: string): Promise<FollowUpRecord | null> {
    const r = await query<any>(
      `${FOLLOW_UP_SELECT} WHERE f.company_id = $1 AND f.id = $2 AND f.deleted_at IS NULL`,
      [companyId, id]
    );
    if (r.rows.length === 0) return null;
    return rowToFollowUp(r.rows[0]);
  }

  /**
   * 创建跟进
   */
  async createFollowUp(companyId: string, input: Partial<FollowUpRecord>): Promise<FollowUpRecord | null> {
    const r = await query<{ id: string }>(
      `INSERT INTO customer_follow_up
        (company_id, customer_id, project_id, certification_type,
         stage, year, expected_date, expected_amount, contract_amount,
         notes, metadata, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        companyId,
        input.customerId,
        input.projectId || null,
        input.certificationType || null,
        input.stage || "expired",
        input.year || new Date().getFullYear(),
        input.expectedDate || null,
        input.expectedAmount ?? null,
        input.contractAmount ?? null,
        input.notes || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ownerUserId || null
      ]
    );
    if (r.rows.length === 0) return null;
    return this.getFollowUp(companyId, r.rows[0].id);
  }

  /**
   * 更新跟进基础信息
   */
  async updateFollowUp(companyId: string, id: string, input: Partial<FollowUpRecord>): Promise<FollowUpRecord | null> {
    const map: Record<string, string> = {
      projectId: "project_id",
      certificationType: "certification_type",
      year: "year",
      expectedDate: "expected_date",
      expectedAmount: "expected_amount",
      contractAmount: "contract_amount",
      notes: "notes",
      metadata: "metadata",
      ownerUserId: "owner_user_id"
    };

    const fields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const [k, col] of Object.entries(map)) {
      if (k in input) {
        if (k === "metadata") {
          fields.push(`${col} = $${paramIdx}::jsonb`);
          params.push(input.metadata ? JSON.stringify(input.metadata) : null);
        } else {
          fields.push(`${col} = $${paramIdx}`);
          params.push((input as any)[k]);
        }
        paramIdx++;
      }
    }
    if (fields.length === 0) return this.getFollowUp(companyId, id);

    fields.push(`updated_at = NOW()`);
    params.push(companyId);
    params.push(id);

    await query(
      `UPDATE customer_follow_up SET ${fields.join(", ")}
       WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL`,
      params
    );
    return this.getFollowUp(companyId, id);
  }

  /**
   * 推进到下一阶段（同时写日志）
   */
  async advanceStage(companyId: string, id: string, toStage: string, notes: string | null, changedBy: string | null): Promise<FollowUpRecord | null> {
    const current = await this.getFollowUp(companyId, id);
    if (!current) return null;

    const fromStage = current.stage;

    // 更新主表
    await query(
      `UPDATE customer_follow_up
       SET stage = $1::varchar,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
           is_archived = CASE WHEN $1 = 'completed' THEN TRUE ELSE is_archived END,
           archived_at = CASE WHEN $1 = 'completed' AND archived_at IS NULL THEN NOW() ELSE archived_at END,
           archived_year = CASE WHEN $1 = 'completed' AND archived_year IS NULL THEN EXTRACT(YEAR FROM NOW())::INT ELSE archived_year END,
           updated_at = NOW()
       WHERE company_id = $2::uuid AND id = $3::uuid AND deleted_at IS NULL`,
      [toStage, companyId, id]
    );

    // 写日志
    await query(
      `INSERT INTO customer_follow_up_log
        (company_id, follow_up_id, from_stage, to_stage, notes, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, id, fromStage, toStage, notes, changedBy]
    );

    return this.getFollowUp(companyId, id);
  }

  /**
   * 软删除
   */
  async deleteFollowUp(companyId: string, id: string): Promise<boolean> {
    const r = await query(
      `UPDATE customer_follow_up SET deleted_at = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 归档某年所有跟进
   */
  async archiveYear(companyId: string, year: number): Promise<number> {
    const r = await query(
      `UPDATE customer_follow_up
       SET is_archived = TRUE, archived_at = NOW(), archived_year = $3, updated_at = NOW()
       WHERE company_id = $1 AND year = $2 AND deleted_at IS NULL AND is_archived = FALSE`,
      [companyId, year]
    );
    return r.rowCount ?? 0;
  }

  /**
   * 取得跟进日志
   */
  async getFollowUpLogs(companyId: string, followUpId: string): Promise<FollowUpLogRecord[]> {
    const r = await query<any>(
      `SELECT * FROM customer_follow_up_log
       WHERE company_id = $1 AND follow_up_id = $2
       ORDER BY changed_at ASC`,
      [companyId, followUpId]
    );
    return r.rows.map(row => ({
      id: row.id,
      followUpId: row.follow_up_id,
      fromStage: row.from_stage,
      toStage: row.to_stage,
      notes: row.notes,
      changedBy: row.changed_by,
      changedAt: row.changed_at
    }));
  }

  /**
   * 为某客户在某年创建一组跟进（如果不存在）
   * 用于"新年开始"自动从去年合同到期数据创建跟进
   */
  async ensureCustomerForForYear(
    companyId: string,
    customerId: string,
    year: number,
    certificationType: string | null = null,
    expectedDate: string | null = null
  ): Promise<FollowUpRecord> {
    // 查是否已有
    const existing = await query<{ id: string }>(
      `SELECT id FROM customer_follow_up
       WHERE company_id = $1 AND customer_id = $2 AND year = $3
         AND deleted_at IS NULL
         AND ($4::text IS NULL OR certification_type = $4)
       LIMIT 1`,
      [companyId, customerId, year, certificationType]
    );
    if (existing.rows.length > 0) {
      return (await this.getFollowUp(companyId, existing.rows[0].id))!;
    }

    // 新建
    return (await this.createFollowUp(companyId, {
      customerId,
      certificationType: certificationType || null,
      stage: "expired",
      year,
      expectedDate
    }))!;
  }
}