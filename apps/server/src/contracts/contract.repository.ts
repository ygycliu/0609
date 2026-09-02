/**
 * 合同管理 - 数据访问层（V2.2）
 */
import { query } from "../db/pool.js";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

export interface ContractRecord {
  id: string;
  companyId: string;
  customerId: string;
  contractNo: string;
  contractType: "main" | "supplement" | "change" | "terminate";
  parentContractId: string | null;
  signingEntityId: string;
  title: string | null;
  contractAmount: number;
  certificationTypes: string[];
  signedAt: string | null;
  effectiveAt: string | null;
  expireAt: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  serviceType: string | null;
  status: "draft" | "signed" | "effective" | "completed" | "terminated" | "archived";
  rawExtracted: any;
  extractionConfidence: number | null;
  source: "pdf_import" | "manual" | "api";
  notes: string | null;
  fileId: string | null;
  customerName: string | null;
  signingEntityName: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

function rowToContract(r: any): ContractRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    customerId: r.customer_id,
    contractNo: r.contract_no,
    contractType: r.contract_type,
    parentContractId: r.parent_contract_id,
    signingEntityId: r.signing_entity_id,
    title: r.title,
    contractAmount: Number(r.contract_amount ?? 0),
    certificationTypes: r.certification_types ?? [],
    signedAt: r.signed_at,
    effectiveAt: r.effective_at,
    expireAt: r.expire_at,
    bankName: r.bank_name,
    bankAccount: r.bank_account,
    bankHolder: r.bank_holder,
    contactPerson: r.contact_person,
    contactPhone: r.contact_phone,
    serviceType: r.service_type,
    status: r.status,
    rawExtracted: r.raw_extracted,
    extractionConfidence: r.extraction_confidence != null ? Number(r.extraction_confidence) : null,
    source: r.source,
    notes: r.notes,
    fileId: r.file_id,
    customerName: r.customer_name ?? null,
    signingEntityName: r.signing_entity_name ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  };
}

export class ContractRepository {
  // ==================== Contract CRUD ====================

  async list(companyId: string, options: {
    signingEntityId?: string;
    customerId?: string;
    status?: string;
    contractType?: string;
    certificationType?: string;
    q?: string;
    startDate?: string;
    endDate?: string;
    minAmount?: number;
    maxAmount?: number;
    hasFile?: boolean;
    offset?: number;
    limit?: number;
  } = {}): Promise<{ items: ContractRecord[]; total: number }> {
    const conditions: string[] = ["c.company_id = $1", "c.deleted_at IS NULL"];
    const params: any[] = [companyId];
    let idx = 2;

    if (options.signingEntityId) {
      conditions.push(`c.signing_entity_id = $${idx++}`);
      params.push(options.signingEntityId);
    }
    if (options.customerId) {
      conditions.push(`c.customer_id = $${idx++}`);
      params.push(options.customerId);
    }
    if (options.status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(options.status);
    }
    if (options.contractType) {
      conditions.push(`c.contract_type = $${idx++}`);
      params.push(options.contractType);
    }
    if (options.q) {
      conditions.push(`(c.title ILIKE $${idx} OR c.contract_no ILIKE $${idx})`);
      params.push(`%${options.q}%`);
      idx++;
    }
    if (options.startDate) {
      conditions.push(`c.signed_at >= $${idx++}`);
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push(`c.signed_at <= $${idx++}`);
      params.push(options.endDate);
    }
    if (options.minAmount != null && !Number.isNaN(options.minAmount)) {
      conditions.push(`c.contract_amount >= $${idx++}`);
      params.push(options.minAmount);
    }
    if (options.maxAmount != null && !Number.isNaN(options.maxAmount)) {
      conditions.push(`c.contract_amount <= $${idx++}`);
      params.push(options.maxAmount);
    }
    if (options.hasFile) {
      conditions.push(`c.file_id IS NOT NULL`);
    }
    if (options.certificationType) {
      conditions.push(`$${idx++} = ANY(c.certification_types)`);
      params.push(options.certificationType);
    }

    const where = conditions.join(" AND ");
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;

    const items = await query<any>(
      `SELECT c.*, cu.name AS customer_name, se.name AS signing_entity_name
       FROM contract c
       LEFT JOIN customer cu ON cu.id = c.customer_id
       LEFT JOIN signing_entity se ON se.id = c.signing_entity_id
       WHERE ${where}
       ORDER BY c.signed_at DESC NULLS LAST, c.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    const total = await query<{ count: string }>(
      `SELECT count(*) FROM contract c WHERE ${where}`,
      params
    );
    return {
      items: items.rows.map(rowToContract),
      total: parseInt(total.rows[0].count, 10)
    };
  }

  async get(companyId: string, id: string): Promise<ContractRecord | null> {
    const r = await queryOne<any>(
      `SELECT c.*, cu.name AS customer_name, se.name AS signing_entity_name
       FROM contract c
       LEFT JOIN customer cu ON cu.id = c.customer_id
       LEFT JOIN signing_entity se ON se.id = c.signing_entity_id
       WHERE c.company_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [companyId, id]
    );
    if (!r) return null;
    return rowToContract(r);
  }

  async create(companyId: string, input: Partial<ContractRecord>): Promise<ContractRecord | null> {
    const r = await query<any>(
      `INSERT INTO contract (
        company_id, customer_id, contract_no, contract_type, parent_contract_id,
        signing_entity_id, title, contract_amount, certification_types,
        signed_at, effective_at, expire_at, bank_name, bank_account, bank_holder,
        contact_person, contact_phone, service_type, status, raw_extracted,
        extraction_confidence, source, notes, file_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *`,
      [
        companyId,
        input.customerId,
        input.contractNo,
        input.contractType ?? "main",
        input.parentContractId ?? null,
        input.signingEntityId,
        input.title ?? null,
        input.contractAmount ?? 0,
        input.certificationTypes ?? [],
        input.signedAt ?? null,
        input.effectiveAt ?? null,
        input.expireAt ?? null,
        input.bankName ?? null,
        input.bankAccount ?? null,
        input.bankHolder ?? null,
        input.contactPerson ?? null,
        input.contactPhone ?? null,
        input.serviceType ?? null,
        input.status ?? "draft",
        input.rawExtracted ? JSON.stringify(input.rawExtracted) : null,
        input.extractionConfidence ?? null,
        input.source ?? "pdf_import",
        input.notes ?? null,
        input.fileId ?? null,
        input.createdBy ?? null
      ]
    );
    if (r.rows.length === 0) return null;
    return this.get(companyId, r.rows[0].id);
  }

  async update(companyId: string, id: string, input: Partial<ContractRecord>): Promise<ContractRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const map: Record<string, string> = {
      customerId: "customer_id",
      contractNo: "contract_no",
      contractType: "contract_type",
      parentContractId: "parent_contract_id",
      signingEntityId: "signing_entity_id",
      title: "title",
      contractAmount: "contract_amount",
      certificationTypes: "certification_types",
      signedAt: "signed_at",
      effectiveAt: "effective_at",
      expireAt: "expire_at",
      bankName: "bank_name",
      bankAccount: "bank_account",
      bankHolder: "bank_holder",
      contactPerson: "contact_person",
      contactPhone: "contact_phone",
      serviceType: "service_type",
      status: "status",
      notes: "notes",
      fileId: "file_id"
    };

    for (const [k, v] of Object.entries(input)) {
      if (map[k] && v !== undefined) {
        fields.push(`${map[k]} = $${idx++}`);
        params.push(k === "certificationTypes" && Array.isArray(v) ? v : v);
      }
    }
    if (fields.length === 0) return this.get(companyId, id);
    fields.push(`updated_at = NOW()`);
    params.push(companyId, id);

    await query(
      `UPDATE contract SET ${fields.join(", ")}
       WHERE company_id = $${idx++} AND id = $${idx} AND deleted_at IS NULL`,
      params
    );
    return this.get(companyId, id);
  }

  async softDelete(companyId: string, id: string): Promise<boolean> {
    const r = await query(
      `UPDATE contract SET deleted_at = NOW() WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ==================== File ====================

  async addFile(companyId: string, file: {
    contractId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    storagePath: string;
    sha256: string | null;
    ocrStatus: string;
    ocrText: string | null;
    ocrExtracted: any;
    version: number;
    isPrimary: boolean;
    uploadedBy: string | null;
  }): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO contract_file (
        company_id, contract_id, file_name, file_type, file_size,
        storage_path, sha256, ocr_status, ocr_text, ocr_extracted,
        version, is_primary, uploaded_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id`,
      [
        companyId, file.contractId, file.fileName, file.fileType, file.fileSize,
        file.storagePath, file.sha256, file.ocrStatus, file.ocrText,
        file.ocrExtracted ? JSON.stringify(file.ocrExtracted) : null,
        file.version, file.isPrimary, file.uploadedBy
      ]
    );
    return r.rows[0].id;
  }

  async getFile(companyId: string, fileId: string): Promise<any | null> {
    const r = await queryOne<any>(
      `SELECT * FROM contract_file WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, fileId]
    );
    return r || null;
  }

  async listFiles(companyId: string, contractId: string): Promise<any[]> {
    const r = await query<any>(
      `SELECT * FROM contract_file WHERE company_id = $1 AND contract_id = $2 AND deleted_at IS NULL
       ORDER BY is_primary DESC, version DESC, uploaded_at DESC`,
      [companyId, contractId]
    );
    return r.rows;
  }

  async deleteFile(companyId: string, fileId: string): Promise<boolean> {
    const r = await query(
      `UPDATE contract_file SET deleted_at = NOW() WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [companyId, fileId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async updateFileOcr(companyId: string, fileId: string, data: {
    ocrStatus?: string;
    ocrText?: string;
    ocrExtracted?: any;
  }): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (data.ocrStatus) { fields.push(`ocr_status = $${idx++}`); params.push(data.ocrStatus); }
    if (data.ocrText != null) { fields.push(`ocr_text = $${idx++}`); params.push(data.ocrText); }
    if (data.ocrExtracted) { fields.push(`ocr_extracted = $${idx++}`); params.push(JSON.stringify(data.ocrExtracted)); }
    if (fields.length === 0) return;
    params.push(companyId, fileId);
    await query(
      `UPDATE contract_file SET ${fields.join(", ")} WHERE company_id = $${idx++} AND id = $${idx}`,
      params
    );
  }

  // ==================== Project 关联 ====================

  async linkProject(companyId: string, contractId: string, certProjectId: string, allocatedAmount: number | null): Promise<void> {
    await query(
      `INSERT INTO contract_project (company_id, contract_id, certification_project_id, allocated_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (contract_id, certification_project_id) DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount`,
      [companyId, contractId, certProjectId, allocatedAmount]
    );
  }

  async unlinkProject(companyId: string, contractId: string, certProjectId: string): Promise<void> {
    await query(
      `DELETE FROM contract_project WHERE company_id = $1 AND contract_id = $2 AND certification_project_id = $3`,
      [companyId, contractId, certProjectId]
    );
  }

  async listLinkedProjects(contractId: string): Promise<any[]> {
    const r = await query<any>(
      `SELECT cp.id, cp.project_code, cp.customer_name, cp.status, cp.contract_amount,
              cpr.allocated_amount, cpr.created_at
       FROM contract_project cpr
       JOIN certification_project cp ON cp.id = cpr.certification_project_id
       WHERE cpr.contract_id = $1
       ORDER BY cpr.created_at DESC`,
      [contractId]
    );
    return r.rows;
  }

  // ==================== Event 流 ====================

  async addEvent(companyId: string, event: {
    contractId: string;
    eventType: string;
    fromStatus?: string;
    toStatus?: string;
    payload?: any;
    operatorId?: string;
    notes?: string;
  }): Promise<void> {
    await query(
      `INSERT INTO contract_event (company_id, contract_id, event_type, from_status, to_status, payload, operator_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        companyId, event.contractId, event.eventType, event.fromStatus ?? null,
        event.toStatus ?? null, event.payload ? JSON.stringify(event.payload) : null,
        event.operatorId ?? null, event.notes ?? null
      ]
    );
  }

  async listEvents(contractId: string): Promise<any[]> {
    const r = await query<any>(
      `SELECT * FROM contract_event WHERE contract_id = $1 ORDER BY created_at DESC`,
      [contractId]
    );
    return r.rows;
  }

  // ==================== Customer Alias ====================

  async addAlias(companyId: string, customerId: string, aliasName: string, source: string): Promise<void> {
    await query(
      `INSERT INTO customer_alias (company_id, customer_id, alias_name, source, match_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (company_id, alias_name) DO UPDATE SET
         match_count = customer_alias.match_count + 1,
         customer_id = EXCLUDED.customer_id`,
      [companyId, customerId, aliasName, source]
    );
  }

  async findAlias(companyId: string, aliasName: string): Promise<{ customerId: string } | null> {
    const r = await queryOne<{ customer_id: string }>(
      `SELECT customer_id FROM customer_alias
       WHERE company_id = $1 AND LOWER(alias_name) = LOWER($2)
       LIMIT 1`,
      [companyId, aliasName]
    );
    return r ? { customerId: r.customer_id } : null;
  }

  // ==================== Batch ====================

  async createBatch(companyId: string, batchName: string, sourcePath: string, operatorId: string): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO contract_import_batch (company_id, batch_name, source_path, operator_id, status)
       VALUES ($1, $2, $3, $4, 'processing') RETURNING id`,
      [companyId, batchName, sourcePath, operatorId]
    );
    return r.rows[0].id;
  }

  async updateBatchProgress(batchId: string, total: number, success: number, failed: number, pending: number): Promise<void> {
    await query(
      `UPDATE contract_import_batch SET total_files = $2, success_count = $3, failed_count = $4, pending_count = $5
       WHERE id = $1`,
      [batchId, total, success, failed, pending]
    );
  }

  async completeBatch(batchId: string, status: "completed" | "failed"): Promise<void> {
    await query(
      `UPDATE contract_import_batch SET status = $2, completed_at = NOW() WHERE id = $1`,
      [batchId, status]
    );
  }

  async getBatch(batchId: string): Promise<any | null> {
    return await queryOne<any>(`SELECT * FROM contract_import_batch WHERE id = $1`, [batchId]);
  }

  // ==================== Stats ====================

  async getStats(companyId: string): Promise<any> {
    const totalR = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM contract WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const totalAmountR = await queryOne<{ sum: string }>(
      `SELECT COALESCE(SUM(contract_amount), 0)::text AS sum FROM contract WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const byStatusR = await query<any>(
      `SELECT status, COUNT(*)::text AS count FROM contract
       WHERE company_id = $1 AND deleted_at IS NULL GROUP BY status`,
      [companyId]
    );
    const byEntityR = await query<any>(
      `SELECT se.id, se.name, COUNT(c.id)::text AS cnt, COALESCE(SUM(c.contract_amount),0)::text AS amount
       FROM signing_entity se
       LEFT JOIN contract c ON c.signing_entity_id = se.id AND c.deleted_at IS NULL
       WHERE se.company_id = $1
       GROUP BY se.id, se.name ORDER BY amount DESC`,
      [companyId]
    );
    return {
      total: parseInt(totalR?.count ?? "0", 10),
      totalAmount: Number(totalAmountR?.sum ?? 0),
      byStatus: byStatusR.rows.reduce((acc: any, r: any) => { acc[r.status] = parseInt(r.count, 10); return acc; }, {}),
      byEntity: byEntityR.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        count: parseInt(r.cnt, 10),
        amount: Number(r.amount)
      }))
    };
  }
}