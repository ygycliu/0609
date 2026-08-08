/**
 * 认证报价 仓储 - 历史报价记录
 */
import path from "path";
import * as crypto from "crypto";
import { config } from "../config.js";
import { JsonStore } from "../shared/json-store.js";
import { query, pingDatabase } from "../db/pool.js";
import type { QuoteResult, QuoteInput } from "./quote.service.js";

const AI_CONSULT_CUSTOMER_ID = "7a27c8e2-66cb-46c4-98a5-6f8722a824ef";

/** 把任意字符串转换为稳定 UUID v5-like（用 SHA-1 取前 16 字节） */
function stringToUuid(input: string): string {
  const h = crypto.createHash("sha1").update(input).digest();
  const b = h.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

interface DbQuoteRow {
  id: string;
  quote_code: string;
  customer_id: string | null;
  industry: string;
  employee_count: number;
  risk_level: string;
  product_ids: string[];
  items: unknown;
  subtotal: number;
  discount: number;
  total: number;
  company_name: string;
  generated_at: Date;
  created_at: Date;
  status: string;
}

export interface QuoteRecord {
  id: string;
  quoteCode: string;
  input: QuoteInput;
  result: QuoteResult;
  createdAt: string;
}

interface LegacyQuote {
  id: string;
  quoteCode: string;
  input: QuoteInput;
  result: QuoteResult;
  createdAt: string;
}

function rowToRecord(r: DbQuoteRow): QuoteRecord {
  // 从 items JSONB 重建 input 与 result
  const items = (r.items ?? {}) as { input?: QuoteInput; result?: QuoteResult };
  return {
    id: r.id,
    quoteCode: r.quote_code,
    input: items.input ?? {
      companyName: r.company_name,
      industry: r.industry,
      employeeCount: r.employee_count,
      certifications: [],
      riskLevel: (r.risk_level as "medium" | "high") ?? "medium"
    },
    result: items.result ?? ({
      companyName: r.company_name,
      industry: r.industry,
      employeeCount: r.employee_count,
      certifications: [],
      subtotal: Number(r.subtotal),
      total: Number(r.total),
      generatedAt: r.generated_at?.toISOString() ?? r.created_at?.toISOString()
    } as unknown as QuoteResult),
    createdAt: r.created_at?.toISOString() ?? new Date().toISOString()
  };
}

export class QuoteRepository {
  private readonly store = new JsonStore<LegacyQuote[]>(
    path.join(config.dataDir, "quotes.json"),
    []
  );
  private useDb = false;

  async init(): Promise<void> {
    this.useDb = await pingDatabase();
    if (this.useDb) console.log("✓ QuoteRepository: using PostgreSQL");
    else console.warn("⚠ QuoteRepository: fallback to JSON");
  }

  async list(companyId: string, limit = 100): Promise<QuoteRecord[]> {
    // ... (DB list 下面)
    // 注: 不查 generated_at（表无此列），用 created_at
    if (this.useDb) {
      try {
        const r = await query<DbQuoteRow>(
          `SELECT id, quote_code, customer_id, industry, employee_count, risk_level,
                  product_ids, items, subtotal, discount, total, created_at, status
           FROM quote
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2`,
          [companyId, limit]
        );
        return r.rows.map(rowToRecord);
      } catch (err) {
        console.warn("DB list failed, fallback to JSON:", (err as Error).message);
      }
    }
    return this.store.read();
  }

  async getById(companyId: string, id: string): Promise<QuoteRecord | null> {
    if (this.useDb) {
      try {
        const r = await query<DbQuoteRow>(
          `SELECT id, quote_code, customer_id, industry, employee_count, risk_level,
                  product_ids, items, subtotal, discount, total, generated_at, created_at, status
           FROM quote
           WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [id, companyId]
        );
        return r.rows[0] ? rowToRecord(r.rows[0]) : null;
      } catch (err) {
        console.warn("DB getById failed, fallback to JSON:", (err as Error).message);
      }
    }
    return (await this.store.read()).find((r) => r.id === id) ?? null;
  }

  async save(companyId: string, userId: string, input: QuoteInput, result: QuoteResult): Promise<QuoteRecord> {
    const id = crypto.randomUUID();
    const quoteCode = `QT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const record: QuoteRecord = { id, quoteCode, input, result, createdAt };

    if (this.useDb) {
      try {
        // product_ids 是 uuid[]，但输入是字符串证书代码（如 "QES"）
        // 转成稳定 hash UUID（同一字符串始终同一 uuid）
        const productIds = (input.certifications ?? []).map((c) => stringToUuid(c));
        await query(
          `INSERT INTO quote
            (id, company_id, quote_code, customer_id, industry, employee_count,
             risk_level, product_ids, items, subtotal, discount, total,
             currency, valid_until, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
          [
            id,
            companyId,
            quoteCode,
            AI_CONSULT_CUSTOMER_ID,
            input.industry,
            input.employeeCount,
            input.riskLevel,
            productIds,
            JSON.stringify({ input, result }),
            result.subtotal,
            0,
            result.initialPrice,
            "CNY",
            new Date(Date.now() + 30 * 24 * 3600 * 1000),
            "draft",
            new Date(createdAt),
          ]
        );
        return record;
      } catch (err) {
        console.warn("DB save failed, fallback to JSON:", (err as Error).message);
      }
    }
    const items = await this.store.read();
    items.unshift(record);
    await this.store.write(items.slice(0, 200));
    return record;
  }
}
