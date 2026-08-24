/**
 * 客户档案仓储
 */
import path from "path";
import * as crypto from "crypto";
import { config } from "../config.js";
import { JsonStore } from "../shared/json-store.js";
import { query, pingDatabase } from "../db/pool.js";

interface DbRow {
  id: string;
  customer_code: string;
  name: string;
  industry: string | null;
  employee_count: number | null;
  region: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  status: string;
  tags: string[] | null;
  created_at: Date;
}

export interface CustomerRecord {
  id: string;
  customerCode: string;
  name: string;
  industry: string | null;
  employeeCount: number | null;
  region: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  source: string | null;
  notes: string | null;
  // 新增字段
  creditCode: string | null;
  scale: string | null;
  sourceChannel: string | null;
  serviceStage: string | null;
  businessScope: string | null;
  firstServiceAt: string | null;
  lastServiceAt: string | null;
  totalRevenue: number | null;
  serviceCount: number | null;
  satisfactionScore: number | null;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string | null;
}

interface LegacyCustomer {
  id: string;
  customerCode: string;
  name: string;
  industry: string | null;
  employeeCount: number | null;
  status: string;
  tags: string[];
  createdAt: string;
  // 可选字段（兼容老数据）
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  region?: string | null;
  address?: string | null;
  source?: string | null;
  notes?: string | null;
  creditCode?: string | null;
  scale?: string | null;
  sourceChannel?: string | null;
  serviceStage?: string | null;
  businessScope?: string | null;
  firstServiceAt?: string | null;
  lastServiceAt?: string | null;
  totalRevenue?: number | null;
  serviceCount?: number | null;
  satisfactionScore?: number | null;
  updatedAt?: string | null;
}


interface DbCustomerRow extends Record<string, any> {}

export interface CustomerSearchOptions {
  q?: string;
  industry?: string;
  status?: string;
  serviceStage?: string;
  tags?: string[];
  offset?: number;
  limit?: number;
}

export interface CustomerInput {
  customerCode?: string;
  name: string;
  industry?: string | null;
  employeeCount?: number | null;
  region?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  source?: string | null;
  notes?: string | null;
  creditCode?: string | null;
  scale?: string | null;
  sourceChannel?: string | null;
  serviceStage?: string | null;
  businessScope?: string | null;
  status?: string;
  tags?: string[];
  satisfactionScore?: number | null;
}

function rowToRecord(r: any): CustomerRecord {
  return {
    id: r.id,
    customerCode: r.customer_code,
    name: r.name,
    industry: r.industry,
    employeeCount: r.employee_count,
    region: r.region,
    contactPerson: r.contact_person,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    address: r.address,
    source: r.source,
    notes: r.notes,
    creditCode: r.credit_code,
    scale: r.scale,
    sourceChannel: r.source_channel,
    serviceStage: r.service_stage,
    businessScope: r.business_scope,
    firstServiceAt: r.first_service_at ? r.first_service_at.toISOString?.() || r.first_service_at : null,
    lastServiceAt: r.last_service_at ? r.last_service_at.toISOString?.() || r.last_service_at : null,
    totalRevenue: r.total_revenue ? Number(r.total_revenue) : null,
    serviceCount: r.service_count ?? 0,
    satisfactionScore: r.satisfaction_score,
    status: r.status || "active",
    tags: r.tags ?? [],
    createdAt: r.created_at?.toISOString?.() ?? r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at?.toISOString?.() || r.updated_at || null
  };
}

export class CustomerRepository {
  private readonly store = new JsonStore<LegacyCustomer[]>(
    path.join(config.dataDir, "customers.json"),
    []
  );
  private useDb = false;

  async init(): Promise<void> {
    this.useDb = await pingDatabase();
    if (this.useDb) console.log("✓ CustomerRepository: using PostgreSQL");
    else console.warn("⚠ CustomerRepository: fallback to JSON");
  }

  async list(companyId: string): Promise<CustomerRecord[]> {
    if (this.useDb) {
      try {
        const r = await query<any>(
          `SELECT id, customer_code, name, industry, employee_count, region,
                  contact_person, contact_phone, contact_email, address, source, notes,
                  credit_code, scale, source_channel, service_stage, business_scope,
                  first_service_at, last_service_at, total_revenue, service_count,
                  satisfaction_score, status, tags, created_at, updated_at
           FROM customer
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 500`,
          [companyId]
        );
        return r.rows.map(rowToRecord);
      } catch (err) {
        console.warn("DB customer list failed:", (err as Error).message);
      }
    }
    return this.store.read() as unknown as CustomerRecord[];
  }

  async create(companyId: string, input: Partial<Omit<CustomerRecord, "id" | "createdAt">>): Promise<CustomerRecord> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const record: CustomerRecord = {
      id,
      customerCode: input.customerCode ?? "",
      name: input.name ?? "",
      industry: input.industry ?? null,
      employeeCount: input.employeeCount ?? null,
      region: input.region ?? null,
      contactPerson: input.contactPerson ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      address: input.address ?? null,
      source: input.source ?? null,
      notes: input.notes ?? null,
      creditCode: input.creditCode ?? null,
      scale: input.scale ?? null,
      sourceChannel: input.sourceChannel ?? null,
      serviceStage: input.serviceStage ?? null,
      businessScope: input.businessScope ?? null,
      firstServiceAt: input.firstServiceAt ?? null,
      lastServiceAt: input.lastServiceAt ?? null,
      totalRevenue: input.totalRevenue ?? null,
      serviceCount: input.serviceCount ?? 0,
      satisfactionScore: input.satisfactionScore ?? null,
      status: input.status ?? "active",
      tags: input.tags ?? [],
      createdAt,
      updatedAt: null
    };

    if (this.useDb) {
      try {
        await query(
          `INSERT INTO customer
            (id, company_id, customer_code, name, industry, employee_count, region,
             contact_person, contact_phone, status, tags, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            id,
            companyId,
            input.customerCode,
            input.name,
            input.industry,
            input.employeeCount,
            input.region,
            input.contactPerson,
            input.contactPhone,
            input.status,
            input.tags ?? [],
            new Date(createdAt),
          ]
        );
        return record;
      } catch (err) {
        console.warn("DB customer create failed:", (err as Error).message);
      }
    }
    const items = await this.store.read();
    items.unshift(record);
    await this.store.write(items);
    return record;
  }

  /**
   * 模糊搜索客户（按名称/编号）
   * 使用 trgm 索引做相似度排序
   */
  async search(companyId: string, searchTerm: string, limit: number = 20): Promise<CustomerRecord[]> {
    if (this.useDb) {
      try {
        // 利用 pg_trgm 索引 + ILIKE 模糊匹配
        const r = await query<any>(
          `SELECT id, customer_code, name, industry, employee_count, region,
                  contact_person, contact_phone, contact_email, address, source, notes,
                  credit_code, scale, source_channel, service_stage, business_scope,
                  first_service_at, last_service_at, total_revenue, service_count,
                  satisfaction_score, status, tags, created_at, updated_at
           FROM customer
           WHERE company_id = $1 AND deleted_at IS NULL
             AND (name ILIKE $2 OR customer_code ILIKE $2)
           ORDER BY
             CASE WHEN name = $3 THEN 0 ELSE 1 END,
             CASE WHEN name ILIKE $4 THEN 0 ELSE 1 END,
             created_at DESC
           LIMIT $5`,
          [companyId, `%${searchTerm}%`, searchTerm, `${searchTerm}%`, limit]
        );
        return r.rows.map(rowToRecord);
      } catch (err) {
        console.warn("DB customer search failed:", (err as Error).message);
      }
    }
    // JSON fallback：内存过滤
    const items = (await this.store.read()) as unknown as CustomerRecord[];
    const q = searchTerm.toLowerCase();
    return items
      .filter(c => c.name.toLowerCase().includes(q) || c.customerCode.toLowerCase().includes(q))
      .slice(0, limit);
  }

  /**
   * 按 ID 查客户
   */
  async getById(companyId: string, id: string): Promise<CustomerRecord | null> {
    if (this.useDb) {
      try {
        const r = await query<any>(
          `SELECT id, customer_code, name, industry, employee_count, region,
                  contact_person, contact_phone, contact_email, address, source, notes,
                  credit_code, scale, source_channel, service_stage, business_scope,
                  first_service_at, last_service_at, total_revenue, service_count,
                  satisfaction_score, status, tags, created_at, updated_at
           FROM customer
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id]
        );
        if (r.rows.length === 0) return null;
        return rowToRecord(r.rows[0]);
      } catch (err) {
        console.warn("DB customer getById failed:", (err as Error).message);
      }
    }
    const items = (await this.store.read()) as unknown as CustomerRecord[];
    return items.find(c => c.id === id) ?? null;
  }

  /**
   * 高级搜索：关键词 + 行业 + 状态 + 服务阶段 + 标签 + 分页
   */
  async searchAdvanced(companyId: string, options: CustomerSearchOptions): Promise<{ items: CustomerRecord[]; total: number }> {
    const { q, status, serviceStage, tags, offset = 0, limit = 50 } = options;
    const industry = options.industry;

    if (this.useDb) {
      try {
        const conditions: string[] = ["company_id = $1", "deleted_at IS NULL"];
        const params: any[] = [companyId];
        let paramIdx = 2;

        if (q && q.trim()) {
          conditions.push(`(name ILIKE $${paramIdx} OR customer_code ILIKE $${paramIdx} OR credit_code ILIKE $${paramIdx})`);
          params.push(`%${q.trim()}%`);
          paramIdx++;
        }

        if (industry && industry.trim()) {
          conditions.push(`industry = $${paramIdx}`);
          params.push(industry);
          paramIdx++;
        }

        if (status && status.trim()) {
          conditions.push(`status = $${paramIdx}`);
          params.push(status);
          paramIdx++;
        }

        if (serviceStage && serviceStage.trim()) {
          conditions.push(`service_stage = $${paramIdx}`);
          params.push(serviceStage);
          paramIdx++;
        }

        if (tags && tags.length > 0) {
          conditions.push(`tags && $${paramIdx}::text[]`);
          params.push(tags);
          paramIdx++;
        }

        const whereClause = conditions.join(" AND ");
        const offsetParam = paramIdx;
        const limitParam = paramIdx + 1;

        const itemsResult = await query<any>(
          `SELECT id, customer_code, name, industry, employee_count, region,
                  contact_person, contact_phone, contact_email, address, source, notes,
                  credit_code, scale, source_channel, service_stage, business_scope,
                  first_service_at, last_service_at, total_revenue, service_count,
                  satisfaction_score, status, tags, created_at, updated_at
           FROM customer
           WHERE ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${limitParam} OFFSET $${offsetParam}`,
          [...params, offset, limit]
        );

        const totalResult = await query<{ count: string }>(
          `SELECT count(*) FROM customer WHERE ${whereClause}`,
          params
        );

        return {
          items: itemsResult.rows.map(rowToRecord),
          total: parseInt(totalResult.rows[0].count, 10)
        };
      } catch (err) {
        console.warn("DB customer searchAdvanced failed:", (err as Error).message);
      }
    }
    return { items: [], total: 0 };
  }

  /**
   * 更新客户信息
   */
  async update(companyId: string, id: string, input: Partial<CustomerInput>): Promise<CustomerRecord | null> {
    if (this.useDb) {
      try {
        const fields: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        const map: Record<string, string> = {
          name: "name",
          customerCode: "customer_code",
          industry: "industry",
          employeeCount: "employee_count",
          region: "region",
          address: "address",
          contactPerson: "contact_person",
          contactPhone: "contact_phone",
          contactEmail: "contact_email",
          source: "source",
          notes: "notes",
          creditCode: "credit_code",
          scale: "scale",
          sourceChannel: "source_channel",
          serviceStage: "service_stage",
          businessScope: "business_scope",
          satisfactionScore: "satisfaction_score"
        };

        for (const [key, dbCol] of Object.entries(map)) {
          if (key in input) {
            fields.push(`${dbCol} = $${paramIdx}`);
            params.push((input as any)[key]);
            paramIdx++;
          }
        }

        if ("tags" in input && input.tags) {
          fields.push(`tags = $${paramIdx}::text[]`);
          params.push(input.tags);
          paramIdx++;
        }

        if ("status" in input && input.status) {
          fields.push(`status = $${paramIdx}`);
          params.push(input.status);
          paramIdx++;
        }

        if (fields.length === 0) return null;

        fields.push(`updated_at = NOW()`);
        params.push(companyId);
        params.push(id);

        await query(
          `UPDATE customer SET ${fields.join(", ")}
           WHERE company_id = $${paramIdx} AND id = $${paramIdx + 1} AND deleted_at IS NULL`,
          params
        );

        return await this.getById(companyId, id);
      } catch (err) {
        console.warn("DB customer update failed:", (err as Error).message);
        return null;
      }
    }
    return null;
  }

  /**
   * 软删除客户
   */

  /**
   * 重新计算客户的累计营收统计
   * 在交易创建/删除时调用
   */
  async recomputeCustomerTotals(customerId: string): Promise<void> {
    const r = await query<{ total: string, cnt: string, first_at: string | null, last_at: string | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total,
         COUNT(*) FILTER (WHERE type = 'income') AS cnt,
         MIN(trans_date) AS first_at,
         MAX(trans_date) AS last_at
       FROM finance_transaction
       WHERE customer_id = $1 AND deleted_at IS NULL`,
      [customerId]
    );
    const row = r.rows[0];
    await query(
      `UPDATE customer SET
         total_revenue = $1,
         service_count = $2,
         first_service_at = $3,
         last_service_at = $4,
         updated_at = NOW()
       WHERE id = $5`,
      [
        Number(row.total) || 0,
        Number(row.cnt) || 0,
        row.first_at,
        row.last_at,
        customerId,
      ]
    );
  }

  async softDelete(companyId: string, id: string): Promise<boolean> {
    if (this.useDb) {
      try {
        const r = await query(
          `UPDATE customer SET deleted_at = NOW(), updated_at = NOW()
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id]
        );
        return (r.rowCount ?? 0) > 0;
      } catch (err) {
        console.warn("DB customer softDelete failed:", (err as Error).message);
        return false;
      }
    }
    return false;
  }

}
