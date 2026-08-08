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
  status: string;
  tags: string[];
  createdAt: string;
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
}

function rowToRecord(r: DbRow): CustomerRecord {
  return {
    id: r.id,
    customerCode: r.customer_code,
    name: r.name,
    industry: r.industry,
    employeeCount: r.employee_count,
    region: r.region,
    contactPerson: r.contact_person,
    contactPhone: r.contact_phone,
    status: r.status,
    tags: r.tags ?? [],
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString()
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
        const r = await query<DbRow>(
          `SELECT id, customer_code, name, industry, employee_count, region,
                  contact_person, contact_phone, status, tags, created_at
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

  async create(companyId: string, input: Omit<CustomerRecord, "id" | "createdAt">): Promise<CustomerRecord> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const record: CustomerRecord = { id, ...input, createdAt };

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
}
