/**
 * V2.2 客户反向补全 API（从合同/发票等数据补全客户）
 */
import { Router, Request, Response as ExResponse, NextFunction } from "express";
import { query } from "../db/pool.js";
import { authMiddleware } from "../auth/auth.service.js";
import { readCookie, ACCESS_COOKIE } from "../auth/session.js";
import {
  findCustomerByName,
  enrichCustomerFromContracts,
  batchMatchCustomers
} from "./customer.matcher.js";

export const customerEnrichRouter = Router();

// V2.2：auth middleware
customerEnrichRouter.use(async (req: Request, _res: ExResponse, next: NextFunction) => {
  try {
    const token = readCookie(req as any, ACCESS_COOKIE);
    const user = await authMiddleware(token);
    if (!user) { (_res as any).status(401).json({ code: "UNAUTHORIZED" }); return; }
    (req as any).user = user;
    next();
  } catch (e) { next(e); }
});

// ============================================================
// 1. POST /api/customers/match-from-text
//    输入文本（合同/发票/邮件中的客户名），返回最匹配的客户
// ============================================================
customerEnrichRouter.post("/match-from-text", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "缺少 name" });
    const result = await findCustomerByName(u.companyId, name);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ============================================================
// 2. POST /api/customers/auto-create
//    从合同抽取的信息自动创建客户（带回填信息）
// ============================================================
customerEnrichRouter.post("/auto-create", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const body = req.body;
    if (!body.name) return res.status(400).json({ error: "缺少 name" });
    const customerName = body.name.trim();

    // 创建客户
    const r = await query<{ id: string }>(
      `INSERT INTO customer (
        company_id, name, contact_person, contact_phone, industry,
        bank_name, bank_account, notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING id`,
      [
        u.companyId,
        customerName,
        body.contact_person || null,
        body.contact_phone || null,
        body.industry || null,
        body.bank_name || null,
        body.bank_account || null,
        body.notes || ("从合同导入：" + (body.contract_no || "未提供"))
      ]
    );
    const customerId = r.rows[0].id;

    // 加别名（如果有原始合同文本）
    if (body.alias_name && body.alias_name !== customerName) {
      await query(
        `INSERT INTO customer_alias (company_id, customer_id, alias_name, source)
         VALUES ($1, $2, $3, 'contract_import')
         ON CONFLICT (company_id, alias_name) DO NOTHING`,
        [u.companyId, customerId, body.alias_name]
      );
    }

    // 返回完整客户
    const newCustomer = await query(
      `SELECT * FROM customer WHERE id = $1`,
      [customerId]
    );
    res.json({ data: newCustomer.rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 3. GET /api/customers/:id/enrich-from-contracts
//    从该客户的合同回填缺失字段
// ============================================================
customerEnrichRouter.get("/:id/enrich-from-contracts", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const id = String(req.params.id);
    const result = await enrichCustomerFromContracts(u.companyId, id);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ============================================================
// 4. POST /api/customers/batch-match
//    批量匹配多个客户名（用于批量导入前预览）
// ============================================================
customerEnrichRouter.post("/batch-match", async (req: Request, res: ExResponse, next) => {
  try {
    const u = (req as any).user;
    const { names } = req.body;
    if (!Array.isArray(names)) return res.status(400).json({ error: "names 必须是数组" });
    const result = await batchMatchCustomers(u.companyId, names);
    const obj: Record<string, any> = {};
    result.forEach((v, k) => {
      obj[k] = {
        customer: v.customer,
        matchType: v.matchType,
        confidence: v.confidence
      };
    });
    res.json({ data: obj });
  } catch (e) { next(e); }
});

// ============================================================
// 5. GET /api/customers/aliases/:customerId
//    列出某客户的所有别名
// ============================================================
customerEnrichRouter.get("/aliases/:customerId", async (req: Request, res: ExResponse, next) => {
  try {
    const r = await query(
      `SELECT id, alias_name, source, match_count, created_at
       FROM customer_alias
       WHERE customer_id = $1
       ORDER BY match_count DESC, created_at DESC`,
      [String(req.params.customerId)]
    );
    res.json({ data: r.rows });
  } catch (e) { next(e); }
});