/**
 * V2.3 合同模板引擎 - 数据访问层
 * 逆向思路：从合同抽取 schema → 存储模板 → 生成新合同
 */
import { query } from "../db/pool.js";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

export interface TemplateRecord {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  signingEntityId: string;
  templateCategory: "main" | "supplement" | "supervision" | "recertification";
  contractType: "HZCX" | "ZRC" | "EXTERNAL" | null;
  chapterCount: number;
  fileFormat: string;
  templatePath: string;
  fieldSchema: any;
  chapterSchema: any;
  status: "active" | "archived" | "draft";
  version: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

function rowToTemplate(r: any): TemplateRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    description: r.description,
    signingEntityId: r.signing_entity_id,
    templateCategory: r.template_category,
    contractType: r.contract_type,
    chapterCount: r.chapter_count ?? 0,
    fileFormat: r.file_format ?? "docx",
    templatePath: r.template_path,
    fieldSchema: r.field_schema ?? {},
    chapterSchema: r.chapter_schema ?? {},
    status: r.status,
    version: r.version ?? 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  };
}

export class TemplateRepository {
  async list(companyId: string, options: {
    signingEntityId?: string;
    contractType?: string;
    templateCategory?: string;
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: TemplateRecord[]; total: number }> {
    const conditions: string[] = ["t.company_id = $1", "t.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let idx = 2;

    if (options.signingEntityId) {
      conditions.push(`t.signing_entity_id = $${idx++}`);
      params.push(options.signingEntityId);
    }
    if (options.contractType) {
      conditions.push(`t.contract_type = $${idx++}`);
      params.push(options.contractType);
    }
    if (options.templateCategory) {
      conditions.push(`t.template_category = $${idx++}`);
      params.push(options.templateCategory);
    }
    if (options.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(options.status);
    }
    if (options.q) {
      conditions.push(`(t.name ILIKE $${idx} OR t.code ILIKE $${idx})`);
      params.push(`%${options.q}%`);
      idx++;
    }

    const where = conditions.join(" AND ");
    const offset = options.offset ?? 0;
    const limit = Math.min(options.limit ?? 50, 200);

    const items = await query<any>(
      `SELECT t.*, se.name AS signing_entity_name
       FROM contract_template t
       LEFT JOIN signing_entity se ON se.id = t.signing_entity_id
       WHERE ${where}
       ORDER BY t.contract_type, t.code
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT COUNT(*) FROM contract_template t WHERE ${where}`,
      params
    );
    return {
      items: items.rows.map(rowToTemplate),
      total: parseInt(total.rows[0].count, 10)
    };
  }

  async get(companyId: string, id: string): Promise<TemplateRecord | null> {
    const r = await queryOne<any>(
      `SELECT t.*, se.name AS signing_entity_name
       FROM contract_template t
       LEFT JOIN signing_entity se ON se.id = t.signing_entity_id
       WHERE t.company_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`,
      [companyId, id]
    );
    if (!r) return null;
    return rowToTemplate(r);
  }

  async getByCode(companyId: string, code: string): Promise<TemplateRecord | null> {
    const r = await queryOne<any>(
      `SELECT t.* FROM contract_template t
       WHERE t.company_id = $1 AND t.code = $2 AND t.deleted_at IS NULL
       ORDER BY t.version DESC LIMIT 1`,
      [companyId, code]
    );
    if (!r) return null;
    return rowToTemplate(r);
  }

  async create(companyId: string, input: Partial<TemplateRecord>): Promise<TemplateRecord | null> {
    const r = await query<any>(
      `INSERT INTO contract_template (
        company_id, code, name, description, signing_entity_id,
        template_category, contract_type, chapter_count, file_format,
        template_path, field_schema, chapter_schema, status, version, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        companyId,
        input.code,
        input.name,
        input.description ?? null,
        input.signingEntityId,
        input.templateCategory,
        input.contractType ?? null,
        input.chapterCount ?? 0,
        input.fileFormat ?? "docx",
        input.templatePath,
        input.fieldSchema ? JSON.stringify(input.fieldSchema) : "{}",
        input.chapterSchema ? JSON.stringify(input.chapterSchema) : "{}",
        input.status ?? "active",
        input.version ?? 1,
        input.createdBy ?? null
      ]
    );
    if (r.rows.length === 0) return null;
    return this.get(companyId, r.rows[0].id);
  }

  async update(companyId: string, id: string, input: Partial<TemplateRecord>): Promise<TemplateRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const map: Record<string, string> = {
      name: "name",
      description: "description",
      chapterCount: "chapter_count",
      fieldSchema: "field_schema",
      chapterSchema: "chapter_schema",
      status: "status"
    };
    for (const [k, v] of Object.entries(input)) {
      if (map[k] && v !== undefined) {
        fields.push(`${map[k]} = $${idx++}`);
        params.push(k === "fieldSchema" || k === "chapterSchema" ? JSON.stringify(v) : v);
      }
    }
    if (fields.length === 0) return this.get(companyId, id);
    fields.push(`updated_at = NOW()`);
    params.push(companyId, id);

    await query(
      `UPDATE contract_template SET ${fields.join(", ")}
       WHERE company_id = $${idx++} AND id = $${idx} AND deleted_at IS NULL`,
      params
    );
    return this.get(companyId, id);
  }

  async softDelete(companyId: string, id: string): Promise<boolean> {
    const r = await query(
      `UPDATE contract_template SET deleted_at = NOW(), status = 'archived'
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ==================== Field Dictionary ====================

  async listFields(): Promise<any[]> {
    const r = await query<any>(
      `SELECT * FROM contract_field_dictionary ORDER BY sort_order, field_category, id`
    );
    return r.rows;
  }

  async getField(fieldCode: string): Promise<any | null> {
    return await queryOne<any>(
      `SELECT * FROM contract_field_dictionary WHERE field_code = $1`,
      [fieldCode]
    );
  }

  // ==================== Generation ====================

  async recordGeneration(companyId: string, gen: {
    templateId: string;
    templateVersion: number;
    contractId?: string | null;
    customerId: string;
    certificationProjectId?: string | null;
    fieldValues: any;
    outputFormat: string;
    generatedFilePath?: string | null;
    pdfFileId?: string | null;
    generationTimeMs?: number | null;
    fileSize?: number | null;
    status: string;
    errorMessage?: string | null;
    createdBy?: string | null;
  }): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO contract_generation (
        company_id, template_id, template_version, contract_id, customer_id,
        certification_project_id, field_values, output_format,
        generated_file_path, pdf_file_id, generation_time_ms, file_size,
        status, error_message, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        companyId, gen.templateId, gen.templateVersion, gen.contractId ?? null, gen.customerId,
        gen.certificationProjectId ?? null, JSON.stringify(gen.fieldValues), gen.outputFormat,
        gen.generatedFilePath ?? null, gen.pdfFileId ?? null, gen.generationTimeMs ?? null, gen.fileSize ?? null,
        gen.status, gen.errorMessage ?? null, gen.createdBy ?? null
      ]
    );
    return r.rows[0].id;
  }

  async listGenerations(companyId: string, options: {
    templateId?: string;
    customerId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const conditions: string[] = ["g.company_id = $1"];
    const params: any[] = [companyId];
    let idx = 2;

    if (options.templateId) {
      conditions.push(`g.template_id = $${idx++}`);
      params.push(options.templateId);
    }
    if (options.customerId) {
      conditions.push(`g.customer_id = $${idx++}`);
      params.push(options.customerId);
    }

    const r = await query<any>(
      `SELECT g.*, t.name AS template_name, c.name AS customer_name
       FROM contract_generation g
       LEFT JOIN contract_template t ON t.id = g.template_id
       LEFT JOIN customer c ON c.id = g.customer_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY g.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, options.limit ?? 50, options.offset ?? 0]
    );
    return r.rows;
  }

  async getGeneration(companyId: string, id: string): Promise<any | null> {
    return await queryOne<any>(
      `SELECT g.*, t.name AS template_name, c.name AS customer_name
       FROM contract_generation g
       LEFT JOIN contract_template t ON t.id = g.template_id
       LEFT JOIN customer c ON c.id = g.customer_id
       WHERE g.company_id = $1 AND g.id = $2`,
      [companyId, id]
    );
  }

  // ==================== Version ====================

  async createVersion(companyId: string, templateId: string, input: {
    filePath: string;
    fieldSchema: any;
    chapterSchema: any;
    changeNote?: string;
    extractedFromContractId?: string | null;
    extractionConfidence?: number | null;
    createdBy?: string | null;
  }): Promise<{ id: string; version: number }> {
    // 获取最新 version
    const last = await queryOne<{ version: number }>(
      `SELECT version FROM contract_template_version
       WHERE template_id = $1 ORDER BY version DESC LIMIT 1`,
      [templateId]
    );
    const newVersion = (last?.version ?? 0) + 1;

    const r = await query<{ id: string; version: number }>(
      `INSERT INTO contract_template_version (
        template_id, version, file_path, field_schema, chapter_schema,
        change_note, extracted_from_contract_id, extraction_confidence, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, version`,
      [
        templateId, newVersion, input.filePath,
        JSON.stringify(input.fieldSchema), JSON.stringify(input.chapterSchema),
        input.changeNote ?? null, input.extractedFromContractId ?? null,
        input.extractionConfidence ?? null, input.createdBy ?? null
      ]
    );
    return { id: r.rows[0].id, version: r.rows[0].version };
  }
}