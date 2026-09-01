/**
 * 审核员档案 - 仓储
 */

import { query } from "../db/pool.js";

export interface AuditorProfileRecord {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  gender: string | null;
  idNumber: string | null;
  phone: string | null;
  email: string | null;
  organization: string | null;
  department: string | null;
  position: string | null;
  level: string;
  specialties: string[];
  certNo: string | null;
  certIssueDate: string | null;
  certExpiry: string | null;
  certStatus: string;
  dailyRate: number;
  expertType: string | null;
  region: string | null;
  languages: string[];
  bio: string | null;
  notes: string | null;
  status: string;
  tags: string[];
  source: string;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string | null;
}

function rowToAuditor(r: any): AuditorProfileRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    code: r.code,
    gender: r.gender,
    idNumber: r.id_number,
    phone: r.phone,
    email: r.email,
    organization: r.organization,
    department: r.department,
    position: r.position,
    level: r.level || "intermediate",
    specialties: r.specialties || [],
    certNo: r.cert_no,
    certIssueDate: r.cert_issue_date,
    certExpiry: r.cert_expiry,
    certStatus: r.cert_status || "active",
    dailyRate: Number(r.daily_rate ?? 0),
    expertType: r.expert_type,
    region: r.region,
    languages: r.languages || [],
    bio: r.bio,
    notes: r.notes,
    status: r.status || "active",
    tags: r.tags || [],
    source: r.source || "manual",
    sourcePath: r.source_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

const AUDITOR_SELECT = `
  SELECT * FROM auditor_profile
`;

export class AuditorProfileRepository {
  /** 列出所有审核员（支持筛选） */
  async list(companyId: string, options: {
    q?: string;
    status?: string;
    level?: string;
    organization?: string;
    specialty?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: AuditorProfileRecord[]; total: number }> {
    const { q, status, level, organization, specialty, limit = 100, offset = 0 } = options;
    const conditions: string[] = ["company_id = $1", "deleted_at IS NULL"];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (q) {
      conditions.push(`(name ILIKE $${paramIdx} OR code ILIKE $${paramIdx} OR phone ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`);
      params.push(`%${q.trim()}%`);
      paramIdx++;
    }
    if (status) {
      conditions.push(`status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (level) {
      conditions.push(`level = $${paramIdx}`);
      params.push(level);
      paramIdx++;
    }
    if (organization) {
      conditions.push(`organization ILIKE $${paramIdx}`);
      params.push(`%${organization}%`);
      paramIdx++;
    }
    if (specialty) {
      conditions.push(`$${paramIdx} = ANY(specialties)`);
      params.push(specialty);
      paramIdx++;
    }

    const where = conditions.join(" AND ");

    const items = await query<any>(
      `${AUDITOR_SELECT} WHERE ${where}
       ORDER BY status ASC, name ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM auditor_profile WHERE ${where}`,
      params
    );

    return {
      items: items.rows.map(rowToAuditor),
      total: Number(total.rows[0].count)
    };
  }

  /** 取单个审核员 */
  async get(companyId: string, id: string): Promise<AuditorProfileRecord | null> {
    const r = await query<any>(
      `${AUDITOR_SELECT} WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    if (r.rows.length === 0) return null;
    return rowToAuditor(r.rows[0]);
  }

  /** 创建审核员 */
  async create(companyId: string, input: Partial<AuditorProfileRecord>): Promise<AuditorProfileRecord> {
    const r = await query<any>(
      `INSERT INTO auditor_profile
        (company_id, name, code, gender, id_number, phone, email,
         organization, department, position, level, specialties,
         cert_no, cert_issue_date, cert_expiry, cert_status,
         daily_rate, expert_type, region, languages,
         bio, notes, status, tags, source, source_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       RETURNING *`,
      [
        companyId,
        input.name,
        input.code || null,
        input.gender || null,
        input.idNumber || null,
        input.phone || null,
        input.email || null,
        input.organization || null,
        input.department || null,
        input.position || null,
        input.level || "intermediate",
        input.specialties || [],
        input.certNo || null,
        input.certIssueDate || null,
        input.certExpiry || null,
        input.certStatus || "active",
        input.dailyRate ?? 0,
        input.expertType || "auditor",
        input.region || null,
        input.languages || [],
        input.bio || null,
        input.notes || null,
        input.status || "active",
        input.tags || [],
        input.source || "manual",
        input.sourcePath || null
      ]
    );
    return rowToAuditor(r.rows[0]);
  }

  /** 更新审核员 */
  async update(companyId: string, id: string, input: Partial<AuditorProfileRecord>): Promise<AuditorProfileRecord | null> {
    const map: Record<string, string> = {
      name: "name",
      code: "code",
      gender: "gender",
      idNumber: "id_number",
      phone: "phone",
      email: "email",
      organization: "organization",
      department: "department",
      position: "position",
      level: "level",
      specialties: "specialties",
      certNo: "cert_no",
      certIssueDate: "cert_issue_date",
      certExpiry: "cert_expiry",
      certStatus: "cert_status",
      dailyRate: "daily_rate",
      expertType: "expert_type",
      region: "region",
      languages: "languages",
      bio: "bio",
      notes: "notes",
      status: "status",
      tags: "tags"
    };
    const fields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const [k, col] of Object.entries(map)) {
      if (k in input && input[k as keyof AuditorProfileRecord] !== undefined) {
        fields.push(`${col} = $${paramIdx}`);
        params.push((input as any)[k]);
        paramIdx++;
      }
    }
    if (fields.length === 0) return this.get(companyId, id);

    fields.push(`updated_at = NOW()`);
    params.push(companyId);
    params.push(id);

    const r = await query<any>(
      `UPDATE auditor_profile SET ${fields.join(", ")}
       WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL
       RETURNING *`,
      params
    );
    if (r.rows.length === 0) return null;
    return rowToAuditor(r.rows[0]);
  }

  /** 软删除 */
  async delete(companyId: string, id: string): Promise<boolean> {
    const r = await query<any>(
      `UPDATE auditor_profile SET deleted_at = NOW(), updated_at = NOW()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** 停用/启用 */
  async setStatus(companyId: string, id: string, status: "active" | "inactive" | "retired"): Promise<AuditorProfileRecord | null> {
    return this.update(companyId, id, { status });
  }

  /** 统计 */
  async getStats(companyId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    byLevel: Record<string, number>;
    byOrg: Record<string, number>;
  }> {
    const all = await query<any>(
      `SELECT status, level, organization FROM auditor_profile
       WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const total = all.rows.length;
    const active = all.rows.filter((r) => r.status === "active").length;
    const inactive = all.rows.filter((r) => r.status !== "active").length;
    const byLevel: Record<string, number> = {};
    const byOrg: Record<string, number> = {};
    for (const r of all.rows) {
      byLevel[r.level] = (byLevel[r.level] || 0) + 1;
      const org = r.organization || "未分类";
      byOrg[org] = (byOrg[org] || 0) + 1;
    }
    return { total, active, inactive, byLevel, byOrg };
  }
}
