/**
 * Consultation 仓储 - 知识库咨询历史记录
 * DB 优先，JSON 文件 fallback
 */
import path from "path";
import * as crypto from "crypto";
import { config } from "../config.js";
import { JsonStore } from "../shared/json-store.js";
import { query, pingDatabase } from "../db/pool.js";
import type { ConsultationRecord } from "../shared/types.js";

const AI_CONSULT_CUSTOMER_ID = "7a27c8e2-66cb-46c4-98a5-6f8722a824ef";

interface DbRow {
  id: string;
  role: string;
  industry: string;
  company_context: string;
  request: string;
  deliverable: string;
  model: string;
  result: string;
  references: unknown; // JSONB
  created_at: Date;
  content?: unknown; // deliverable.content (JSONB)
}

function rowToRecord(r: DbRow): ConsultationRecord {
  // references 可能来自 content（如果 content 是 JSONB）
  let references: unknown = r.references;
  if ((references === null || references === undefined) && r.content && typeof r.content === "object") {
    const c = r.content as Record<string, unknown>;
    references = c.references ?? references;
  }
  return {
    id: r.id,
    role: r.role as ConsultationRecord["role"],
    industry: r.industry,
    companyContext: r.company_context,
    request: r.request,
    deliverable: r.deliverable,
    model: r.model as ConsultationRecord["model"],
    result: r.result,
    references: (references ?? []) as ConsultationRecord["references"],
    createdAt: r.created_at.toISOString()
  };
}

export class ConsultationRepository {
  private readonly store = new JsonStore<ConsultationRecord[]>(
    path.join(config.dataDir, "consultations.json"),
    []
  );
  private useDb = false;

  async init(): Promise<void> {
    this.useDb = await pingDatabase();
    if (this.useDb) console.log("✓ ConsultationRepository: using PostgreSQL");
    else console.warn("⚠ ConsultationRepository: fallback to JSON");
  }

  async list(companyId: string): Promise<ConsultationRecord[]> {
    if (this.useDb) {
      try {
        const r = await query<DbRow>(
          `SELECT
             cp.id,
             d.content->>'role' AS role,
             d.content->>'industry' AS industry,
             d.content->>'companyContext' AS company_context,
             d.content->>'request' AS request,
             d.content->>'deliverable' AS deliverable,
             d.content->>'model' AS model,
             d.content->>'result' AS result,
             d.content->'references' AS references,
             cp.created_at,
             d.content AS content
           FROM consultation_project cp
           JOIN deliverable d ON d.project_id = cp.id
           WHERE cp.company_id = $1 AND cp.deleted_at IS NULL
           ORDER BY cp.created_at DESC LIMIT 200`,
          [companyId]
        );
        return r.rows.map(rowToRecord);
      } catch (err) {
        console.warn("DB list failed, fallback to JSON:", (err as Error).message);
      }
    }
    return this.store.read();
  }

  async getById(companyId: string, id: string): Promise<ConsultationRecord | null> {
    if (this.useDb) {
      try {
        const r = await query<DbRow>(
          `SELECT
             cp.id,
             d.content->>'role' AS role,
             d.content->>'industry' AS industry,
             d.content->>'companyContext' AS company_context,
             d.content->>'request' AS request,
             d.content->>'deliverable' AS deliverable,
             d.content->>'model' AS model,
             d.content->>'result' AS result,
             d.content->'references' AS references,
             cp.created_at,
             d.content AS content
           FROM consultation_project cp
           JOIN deliverable d
             ON d.project_id = cp.id
            AND d.deleted_at IS NULL
           WHERE cp.id = $1
             AND cp.company_id = $2
             AND cp.deleted_at IS NULL
           ORDER BY d.created_at DESC
           LIMIT 1`,
          [id, companyId]
        );
        return r.rows[0] ? rowToRecord(r.rows[0]) : null;
      } catch (err) {
        console.warn("DB getById failed, fallback to JSON:", (err as Error).message);
      }
    }
    return (await this.store.read()).find((r) => r.id === id) ?? null;
  }

  async create(companyId: string, userId: string, record: ConsultationRecord): Promise<ConsultationRecord> {
    if (this.useDb) {
      try {
        await query(
          `INSERT INTO consultation_project
            (id, company_id, project_code, customer_id, owner_user_id, name,
             description, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            record.id,
            companyId,
            `CONS-${record.id.slice(0, 8)}`,
            AI_CONSULT_CUSTOMER_ID,
            userId,
            record.industry + " - " + record.deliverable,
            `${record.companyContext}\n${record.request}`,
            "completed",
            new Date(record.createdAt),
          ]
        );
        await query(
          `INSERT INTO deliverable
            (id, company_id, project_id, type, title, content, status,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            crypto.randomUUID(),
            companyId,
            record.id,
            "consultation_response",
            record.industry + " - " + record.deliverable,
            JSON.stringify({
              result: record.result,
              references: record.references ?? [],
              role: record.role,
              model: record.model,
              industry: record.industry,
              companyContext: record.companyContext,
              request: record.request,
              deliverable: record.deliverable
            }),
            "approved",
            new Date(record.createdAt),
          ]
        );
        return record;
      } catch (err) {
        console.warn("DB create failed, fallback to JSON:", (err as Error).message);
      }
    }
    const items = await this.store.read();
    items.unshift(record);
    await this.store.write(items);
    return record;
  }
}
