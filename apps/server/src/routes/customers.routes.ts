/**
 * 客户管理路由（/api/customers/*）
 *
 * 业务：客户档案 CRUD、搜索、CSV导入导出、认证历史范围
 *
 * 拆分前：app.ts L1613-2327（715 行，10 个端点）
 * 拆分后：本文件 + app.ts 一行 app.use("/api/customers", createCustomersRouter({ ... }))
 *
 * ⚠️ 与 customerEnrichRouter 共存：
 *   - customerEnrichRouter（contracts/customer-enrich.routes.js，L5972 装载）= V2.2 反向补全
 *   - 本文件 = 核心 CRUD + 搜索 + CSV
 *   - Express app.use 叠加，inline 路由（注册在前）优先级更高
 *
 * 不动 customerEnrichRouter — 它已经是独立文件了。
 *
 * 端点（10 个）：
 *   GET    /api/customers                    — 客户列表（高级搜索）
 *   GET    /api/customers/names              — 轻量客户名列表（AI扫描匹配）
 *   GET    /api/customers/export.csv         — CSV 导出（含证书明细）
 *   POST   /api/customers/import.csv         — CSV 导入（admin 专用）
 *   GET    /api/customers/export-with-certs.csv — 按证书类型筛选导出
 *   GET    /api/customers/:id                — 客户详情（含跟进/报价统计）
 *   GET    /api/customers/:id/history-scope  — 认证历史范围
 *   POST   /api/customers                    — 创建客户
 *   PATCH  /api/customers/:id                — 更新客户
 *   DELETE /api/customers/:id                — 软删客户
 */

import express, { type Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../shared/errors.js";
import type { CustomerRepository } from "../customers/customer.repository.js";

export interface CustomersRouterDeps {
  getUserFromReq: (request: express.Request) => any;
  customerRepository: CustomerRepository;
}

/** CSV 单元格转义（双引号包裹 + 内部引号转义） */
const csvEsc = (v: any): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

/** 简易 CSV 解析器（支持双引号转义 + CRLF 行结束） */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim()));
}

export function createCustomersRouter(deps: CustomersRouterDeps): Router {
  const { getUserFromReq } = deps;
  const router = express.Router();

  // 客户列表
  router.get("/", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "50"), 1), 200);
      const industry = (request.query.industry as string) || "";
      const status = (request.query.status as string) || "";
      const serviceStage = (request.query.service_stage as string) || "";
      const tags = (request.query.tags as string) || "";

      const result = await deps.customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        industry,
        status,
        serviceStage,
        tags: tags ? tags.split(",").filter(Boolean) : [],
        offset,
        limit
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) {
      next(error);
    }
  });

  // 轻量客户名列表（用于 AI 扫描客户名匹配）
  router.get("/names", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query<{ id: string; name: string }>(
        "SELECT id, name FROM customer WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name",
        [u.companyId]
      );
      response.json({ data: r.rows });
    } catch (error) { next(error); }
  });

  // 导出客户为 CSV
  router.get("/export.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const industry = (request.query.industry as string) || "";
      const status = (request.query.status as string) || "";
      const serviceStage = (request.query.service_stage as string) || "";
      const tags = (request.query.tags as string) || "";

      const result = await deps.customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        industry,
        status,
        serviceStage,
        tags: tags ? tags.split(",").filter(Boolean) : [],
        offset: 0,
        limit: 10000
      });

      // V2.1：加载所有客户的证书（一行一证书，包含证书详情）
      const customerIds = result.items.map((c: any) => c.id);
      const certMap = new Map<string, any[]>();
      if (customerIds.length > 0) {
        const certRes = await query<any>(
          `SELECT
             sc.customer_id,
             pc.id AS cert_id,
             pc.cert_type,
             pc.standard,
             pc.certificate_no,
             pc.issue_date::text AS issue_date,
             pc.valid_until::text AS valid_until,
             pc.issuing_body,
             pc.status AS cert_status,
             pc.acknowledged_at IS NOT NULL AS is_acknowledged,
             (pc.valid_until - CURRENT_DATE) AS days_until_expiry
           FROM project_certificate pc
           JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
           WHERE pc.deleted_at IS NULL
             AND sc.customer_id = ANY($1::uuid[])
           ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`,
          [customerIds]
        );
        for (const row of certRes.rows) {
          const arr = certMap.get(row.customer_id) || [];
          arr.push(row);
          certMap.set(row.customer_id, arr);
        }
      }

      const headers = [
        "客户编号", "客户名称", "行业", "规模", "地区", "联系人",
        "电话", "邮箱", "信用代码", "业务范围", "服务阶段", "客户状态",
        "来源", "来源渠道", "标签", "累计营收", "服务次数",
        "首次服务", "最近服务", "满意度", "备注",
        "证书类型", "证书标准", "证书编号", "颁发机构",
        "签发日期", "到期日期", "证书状态", "距到期天数", "已确认"
      ];
      const customerBase = new Map<string, string[]>();
      for (const c of result.items as any[]) {
        customerBase.set(c.id, [
          c.customer_code, c.name, c.industry, c.scale, c.region,
          c.contact_person, c.contact_phone, c.contact_email,
          c.credit_code, c.business_scope, c.service_stage, c.status,
          c.source, c.source_channel,
          Array.isArray(c.tags) ? c.tags.join("; ") : "",
          c.total_revenue ?? "", c.service_count ?? "",
          c.first_service_at, c.last_service_at,
          c.satisfaction_score, c.notes
        ]);
      }
      const rows: string[][] = [];
      for (const c of result.items) {
        const base = customerBase.get(c.id) || [];
        const certs = certMap.get(c.id) || [];
        if (certs.length === 0) {
          rows.push([...base, "", "", "", "", "", "", "", "", ""]);
        } else {
          for (const cert of certs) {
            rows.push([
              ...base,
              cert.cert_type || "",
              cert.standard || "",
              cert.certificate_no || "",
              cert.issuing_body || "",
              cert.issue_date || "",
              cert.valid_until || "",
              cert.cert_status || "",
              cert.days_until_expiry ?? "",
              cert.is_acknowledged ? "是" : "否"
            ]);
          }
        }
      }
      const csv = [
        "\uFEFF" + headers.map(csvEsc).join(","),
        ...rows.map(row => row.map(csvEsc).join(","))
      ].join("\r\n");

      const filename = `单位信息（含证书）_${new Date().toISOString().slice(0, 10)}.csv`;
      const safeAscii = `customers_with_certs_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });

  // V2.1：从 CSV 导入客户（系统基础数据 → 单位信息）支持客户+证书
  router.post("/import.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可导入单位信息" });
        return;
      }

      const csvText = (request.body as any)?.csv as string;
      if (!csvText || typeof csvText !== "string") {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ 请提供 csv 字段" });
        return;
      }

      const cleanText = csvText.replace(/^\uFEFF/, "");
      const rows = parseCSV(cleanText);
      if (rows.length < 2) {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ CSV 内容为空或只有表头" });
        return;
      }

      const headers = rows[0].map(h => h.trim());
      const nameIdx = headers.indexOf("客户名称");
      const codeIdx = headers.indexOf("客户编号");
      const industryIdx = headers.indexOf("行业");
      const regionIdx = headers.indexOf("地区");
      const contactIdx = headers.indexOf("联系人");
      const phoneIdx = headers.indexOf("电话");
      const emailIdx = headers.indexOf("邮箱");
      const creditCodeIdx = headers.indexOf("信用代码");
      const addressIdx = headers.indexOf("地址");
      const businessIdx = headers.indexOf("业务范围");
      const tagsIdx = headers.indexOf("标签");
      const notesIdx = headers.indexOf("备注");
      const certTypeIdx = headers.indexOf("证书类型");
      const certStandardIdx = headers.indexOf("证书标准");
      const certNoIdx = headers.indexOf("证书编号");
      const issuingBodyIdx = headers.indexOf("颁发机构");
      const issueDateIdx = headers.indexOf("签发日期");
      const validUntilIdx = headers.indexOf("到期日期");

      if (nameIdx === -1) {
        response.status(400).json({ code: "BAD_REQUEST", message: "❌ 缺少必填列：客户名称" });
        return;
      }

      let customersAdded = 0, customersUpdated = 0, certsAdded = 0, certsUpdated = 0, failed = 0;
      const errors: { row: number; reason: string; data: string }[] = [];

      const customerIdCache = new Map<string, string>();
      const certCache = new Map<string, string>();

      const defaultSigningEntity = await query<{ id: string }>(
        `SELECT id FROM signing_entity WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [u.companyId]
      );
      const defaultSigningEntityId = defaultSigningEntity.rows[0]?.id || null;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[nameIdx] || "").trim();
        if (!name) {
          failed++;
          errors.push({ row: i + 1, reason: "客户名称为空", data: row.join(",") });
          continue;
        }
        try {
          let customerId = customerIdCache.get(name);

          if (!customerId) {
            const existing = await query<{ id: string }>(
              `SELECT id FROM customer
               WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL
               LIMIT 1`,
              [u.companyId, name]
            );

            const tagsRaw = tagsIdx >= 0 ? (row[tagsIdx] || "").trim() : "";
            const tags = tagsRaw ? tagsRaw.split(/[;,、]/).map((t: string) => t.trim()).filter(Boolean) : [];

            if (existing.rows.length > 0) {
              customerId = existing.rows[0].id;
              await query(
                `UPDATE customer SET
                  industry = COALESCE(NULLIF($2, ''), industry),
                  region = COALESCE(NULLIF($3, ''), region),
                  contact_person = COALESCE(NULLIF($4, ''), contact_person),
                  contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
                  contact_email = COALESCE(NULLIF($6, ''), contact_email),
                  credit_code = COALESCE(NULLIF($7, ''), credit_code),
                  address = COALESCE(NULLIF($8, ''), address),
                  business_scope = COALESCE(NULLIF($9, ''), business_scope),
                  tags = COALESCE($10, tags),
                  notes = COALESCE(NULLIF($11, ''), notes),
                  updated_at = NOW()
                WHERE id = $1`,
                [
                  customerId,
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  regionIdx >= 0 ? (row[regionIdx] || "").trim() : "",
                  contactIdx >= 0 ? (row[contactIdx] || "").trim() : "",
                  phoneIdx >= 0 ? (row[phoneIdx] || "").trim() : "",
                  emailIdx >= 0 ? (row[emailIdx] || "").trim() : "",
                  creditCodeIdx >= 0 ? (row[creditCodeIdx] || "").trim() : "",
                  addressIdx >= 0 ? (row[addressIdx] || "").trim() : "",
                  businessIdx >= 0 ? (row[businessIdx] || "").trim() : "",
                  tags.length > 0 ? tags : null,
                  notesIdx >= 0 ? (row[notesIdx] || "").trim() : ""
                ]
              );
              customersUpdated++;
            } else {
              const customerCode = codeIdx >= 0 && (row[codeIdx] || "").trim()
                ? (row[codeIdx] || "").trim()
                : `IMP-${Date.now().toString(36)}-${i}`;
              const ins = await query<{ id: string }>(
                `INSERT INTO customer (
                  company_id, customer_code, name, industry, region,
                  contact_person, contact_phone, contact_email, credit_code,
                  address, business_scope, tags, notes, status, source,
                  source_channel, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active','import','csv_import',NOW(),NOW())
                RETURNING id`,
                [
                  u.companyId, customerCode, name,
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  regionIdx >= 0 ? (row[regionIdx] || "").trim() : "",
                  contactIdx >= 0 ? (row[contactIdx] || "").trim() : "",
                  phoneIdx >= 0 ? (row[phoneIdx] || "").trim() : "",
                  emailIdx >= 0 ? (row[emailIdx] || "").trim() : "",
                  creditCodeIdx >= 0 ? (row[creditCodeIdx] || "").trim() : "",
                  addressIdx >= 0 ? (row[addressIdx] || "").trim() : "",
                  businessIdx >= 0 ? (row[businessIdx] || "").trim() : "",
                  tags.length > 0 ? tags : [],
                  notesIdx >= 0 ? (row[notesIdx] || "").trim() : ""
                ]
              );
              customerId = ins.rows[0].id;
              customersAdded++;
            }
            customerIdCache.set(name, customerId);
          }

          const certType = certTypeIdx >= 0 ? (row[certTypeIdx] || "").trim() : "";
          if (certType && customerId) {
            const certNo = certNoIdx >= 0 ? (row[certNoIdx] || "").trim() : "";
            const certKey = `${customerId}|${certNo || certType}`;

            const defaultServiceType = await query<{ id: string }>(
              `SELECT id FROM service_type WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
              [u.companyId]
            );
            const defaultServiceTypeId = defaultServiceType.rows[0]?.id || null;

            let projectId = await query<{ id: string }>(
              `SELECT id FROM certification_project
               WHERE customer_id = $1 AND company_id = $2 AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1`,
              [customerId, u.companyId]
            ).then(r => r.rows[0]?.id || null);

            if (!projectId && defaultServiceTypeId && defaultSigningEntityId) {
              const newProj = await query<{ id: string }>(
                `INSERT INTO certification_project (
                  company_id, project_code, customer_id, customer_name,
                  service_type_id, service_type_code, service_type_name,
                  signing_entity_id, signing_entity_name, status, industry,
                  created_by, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                RETURNING id`,
                [
                  u.companyId,
                  `IMP-${customerId.slice(0, 8)}-${Date.now().toString(36)}`,
                  customerId, name,
                  defaultServiceTypeId, 'import', '证书导入自动创建',
                  defaultSigningEntityId, '华中国际认证检验集团有限公司',
                  'project_archived',
                  industryIdx >= 0 ? (row[industryIdx] || "").trim() : "",
                  u.id || null
                ]
              );
              projectId = newProj.rows[0]?.id || null;
            }

            if (!projectId) {
              errors.push({ row: i + 1, reason: "缺少签约主体/服务类型，无法创建证书项目", data: row.join(",") });
              continue;
            }

            const standard = certStandardIdx >= 0 ? (row[certStandardIdx] || "").trim() : "";
            const issuingBody = issuingBodyIdx >= 0 ? (row[issuingBodyIdx] || "").trim() : "华中国际认证检验集团有限公司";
            const issueDate = issueDateIdx >= 0 ? (row[issueDateIdx] || "").trim() : "";
            const validUntil = validUntilIdx >= 0 ? (row[validUntilIdx] || "").trim() : "";

            const existingCert = await query<{ id: string }>(
              `SELECT id FROM project_certificate
               WHERE project_id = $1 AND cert_type = $2
                 AND ($3 = '' OR certificate_no = $3)
                 AND deleted_at IS NULL LIMIT 1`,
              [projectId, certType, certNo]
            );

            if (existingCert.rows.length > 0) {
              await query(
                `UPDATE project_certificate SET
                  standard = COALESCE(NULLIF($2, ''), standard),
                  certificate_no = COALESCE(NULLIF($3, ''), certificate_no),
                  issuing_body = COALESCE(NULLIF($4, ''), issuing_body),
                  issue_date = COALESCE(NULLIF($5, '')::date, issue_date),
                  valid_until = COALESCE(NULLIF($6, '')::date, valid_until),
                  updated_at = NOW()
                WHERE id = $1`,
                [existingCert.rows[0].id, standard, certNo, issuingBody, issueDate, validUntil]
              );
              certsUpdated++;
            } else {
              await query(
                `INSERT INTO project_certificate (
                  company_id, project_id, cert_type, standard, certificate_no,
                  issuing_body, issue_date, valid_until, status,
                  created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, 'active', NOW(), NOW())`,
                [u.companyId, projectId, certType, standard, certNo,
                 issuingBody || "华中国际认证检验集团有限公司",
                 issueDate || null, validUntil || null]
              );
              certsAdded++;
            }
          }
        } catch (err: any) {
          failed++;
          errors.push({ row: i + 1, reason: err.message || "未知错误", data: row.join(",") });
        }
      }

      response.json({
        data: {
          total: rows.length - 1,
          customers: {
            inserted: customersAdded,
            updated: customersUpdated
          },
          certificates: {
            inserted: certsAdded,
            updated: certsUpdated
          },
          failed,
          errors: errors.slice(0, 50)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // V2.1：按证书类型筛选导出
  router.get("/export-with-certs.csv", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const certTypeFilter = (request.query.cert_type as string) || "";
      const q = (request.query.q as string) || "";
      const offset = 0;
      const limit = 10000;

      const result = await deps.customerRepository.searchAdvanced(u.companyId, {
        q: q.trim(),
        offset, limit
      });

      const customerIds = result.items.map((c: any) => c.id);
      const certMap = new Map<string, any[]>();
      if (customerIds.length > 0) {
        const sql = certTypeFilter
          ? `SELECT sc.customer_id, pc.id AS cert_id, pc.cert_type, pc.standard,
                   pc.certificate_no, pc.issue_date::text AS issue_date, pc.valid_until::text AS valid_until,
                   pc.issuing_body, pc.status AS cert_status,
                   pc.acknowledged_at IS NOT NULL AS is_acknowledged,
                   (pc.valid_until - CURRENT_DATE) AS days_until_expiry
             FROM project_certificate pc
             JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
             WHERE pc.deleted_at IS NULL AND sc.customer_id = ANY($1::uuid[])
               AND ($2 = '' OR pc.cert_type LIKE '%' || $2 || '%')
             ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`
          : `SELECT sc.customer_id, pc.id AS cert_id, pc.cert_type, pc.standard,
                   pc.certificate_no, pc.issue_date::text AS issue_date, pc.valid_until::text AS valid_until,
                   pc.issuing_body, pc.status AS cert_status,
                   pc.acknowledged_at IS NOT NULL AS is_acknowledged,
                   (pc.valid_until - CURRENT_DATE) AS days_until_expiry
             FROM project_certificate pc
             JOIN certification_project sc ON sc.id = pc.project_id AND sc.deleted_at IS NULL
             WHERE pc.deleted_at IS NULL AND sc.customer_id = ANY($1::uuid[])
             ORDER BY sc.customer_id, pc.issue_date DESC NULLS LAST`;
        const params = certTypeFilter ? [customerIds, certTypeFilter] : [customerIds];
        const certRes = await query<any>(sql, params);
        for (const row of certRes.rows) {
          const arr = certMap.get(row.customer_id) || [];
          arr.push(row);
          certMap.set(row.customer_id, arr);
        }
      }

      const headers = [
        "客户编号", "客户名称", "行业", "地区", "联系人", "电话",
        "邮箱", "客户状态", "标签",
        "证书类型", "证书标准", "证书编号", "颁发机构",
        "签发日期", "到期日期", "证书状态", "距到期天数", "已确认"
      ];
      const customerBase = new Map<string, string[]>();
      for (const c of result.items as any[]) {
        customerBase.set(c.id, [
          c.customer_code, c.name, c.industry, c.region,
          c.contact_person, c.contact_phone, c.contact_email,
          c.status, Array.isArray(c.tags) ? c.tags.join("; ") : ""
        ]);
      }
      const rows: string[][] = [];
      for (const c of result.items) {
        const base = customerBase.get(c.id) || [];
        const certs = certMap.get(c.id) || [];
        if (certs.length === 0) continue;
        for (const cert of certs) {
          rows.push([
            ...base,
            cert.cert_type || "", cert.standard || "", cert.certificate_no || "",
            cert.issuing_body || "", cert.issue_date || "", cert.valid_until || "",
            cert.cert_status || "", cert.days_until_expiry ?? "",
            cert.is_acknowledged ? "是" : "否"
          ]);
        }
      }
      const csv = ["\uFEFF" + headers.map(csvEsc).join(","), ...rows.map(row => row.map(csvEsc).join(","))].join("\r\n");

      const typeLabel = certTypeFilter ? `_${certTypeFilter}` : "";
      const filename = `单位信息（证书）${typeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
      const safeAscii = `customers_certs${typeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      response.send(csv);
    } catch (error) { next(error); }
  });

  // 客户详情（含跟进统计）
  router.get("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const customer = await deps.customerRepository.getById(u.companyId, id);
      if (!customer) throw new NotFoundError("客户不存在");

      const statsRes = await query<{
        total_sessions: string;
        active_sessions: string;
        last_session_date: Date | null;
      }>(
        `SELECT
          COUNT(*) AS total_sessions,
          COUNT(*) FILTER (WHERE attachments_ready = false) AS active_sessions,
          MAX(created_at) AS last_session_date
         FROM audit_session
         WHERE company_id = $1 AND customer_name = $2`,
        [u.companyId, customer.name]
      );

      const quoteStatsRes = await query<{
        total_quotes: string;
        total_amount: number | null;
      }>(
        `SELECT
          COUNT(*) AS total_quotes,
          SUM(total) AS total_amount
         FROM quote
         WHERE customer_id = $1 AND deleted_at IS NULL`,
        [id]
      );

      response.json({
        data: {
          ...customer,
          audit_stats: statsRes.rows[0] || { total_sessions: 0, active_sessions: 0, last_session_date: null },
          quote_stats: quoteStatsRes.rows[0] || { total_quotes: 0, total_amount: 0 }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 获取客户历史认证范围
  router.get("/:id/history-scope", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const customer = await deps.customerRepository.getById(u.companyId, id);
      if (!customer) throw new NotFoundError("客户不存在");

      const r = await query<{
        id: string;
        audit_type: string;
        standards: string[];
        industry: string | null;
        employee_count: number | null;
        scheduled_date: Date | null;
        created_at: Date;
      }>(
        `SELECT id, audit_type, standards, industry, employee_count, scheduled_date, created_at
         FROM audit_session
         WHERE company_id = $1 AND customer_name = $2
         ORDER BY created_at DESC
         LIMIT 10`,
        [u.companyId, customer.name]
      );

      const scopes = r.rows.map(row => ({
        sessionId: row.id,
        auditType: row.audit_type,
        standards: row.standards || [],
        industry: row.industry,
        employeeCount: row.employee_count,
        scheduledDate: row.scheduled_date,
        createdAt: row.created_at,
        description: row.standards && row.standards.length > 0
          ? `${row.standards.join(" + ")} (${row.audit_type})`
          : `${row.audit_type} 审核`
      }));

      response.json({ data: scopes });
    } catch (error) { next(error); }
  });

  // 创建客户
  router.post("/", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") throw new ForbiddenError("只有管理员可以维护客户资料");
      const parsed = z
        .object({
          customerCode: z.string().trim().min(1).max(50),
          name: z.string().trim().min(1).max(200),
          industry: z.string().trim().max(100).optional(),
          employeeCount: z.number().int().optional(),
          region: z.string().trim().max(100).optional(),
          contactPerson: z.string().trim().max(100).optional(),
          contactPhone: z.string().trim().max(50).optional(),
          tags: z.array(z.string()).optional(),
          status: z.string().default("active")
        })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
      }
      const created = await deps.customerRepository.create(u.companyId, {
        ...parsed.data,
        industry: parsed.data.industry ?? null,
        employeeCount: parsed.data.employeeCount ?? null,
        region: parsed.data.region ?? null,
        contactPerson: parsed.data.contactPerson ?? null,
        contactPhone: parsed.data.contactPhone ?? null,
        tags: parsed.data.tags ?? []
      });
      response.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const body = request.body as Record<string, unknown>;
      if (!body || typeof body !== "object") throw new ValidationError("请求体不能为空");

      const allowedKeys = [
        "name", "customerCode", "industry", "employeeCount", "region", "address",
        "contactPerson", "contactPhone", "contactEmail", "source", "notes",
        "creditCode", "scale", "sourceChannel", "serviceStage", "businessScope",
        "status", "tags", "satisfactionScore"
      ];
      const update: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (key in body) update[key] = body[key];
      }

      const updated = await deps.customerRepository.update(u.companyId, id, update);
      if (!updated) throw new NotFoundError("客户");
      response.json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      const ok = await deps.customerRepository.softDelete(u.companyId, id);
      if (!ok) throw new NotFoundError("客户");
      response.json({ data: { id, deleted: true } });
    } catch (error) { next(error); }
  });

  return router;
}