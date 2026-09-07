/**
 * V2.3.8：帮助中心 FAQ 路由
 *
 * 端点：
 *   GET    /api/help/faqs         列出 FAQ（支持 q/category/module/tag/status 筛选 + 分页）
 *   GET    /api/help/faqs/categories  获取分类聚合统计
 *   GET    /api/help/faqs/:id     获取单个 FAQ（同时 +1 view_count）
 *   POST   /api/help/faqs         录入新 FAQ
 *   PATCH  /api/help/faqs/:id     修改 FAQ（admin 或创建人）
 *   DELETE /api/help/faqs/:id     删除/归档 FAQ（admin）
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../shared/errors.js";

type AuthedRequest = Request;

export interface HelpRouterDeps {
  getUserFromReq: (req: Request) => { companyId: string; id: string; username?: string; isAdmin?: boolean; role?: string };
}

const CATEGORY_VALUES = ["合同", "客户", "认证", "财务", "审核", "系统", "其他"] as const;
const MODULE_VALUES = ["contract", "customer", "audit", "finance", "system", "knowledge", "其他"] as const;
const STATUS_VALUES = ["active", "draft", "archived"] as const;

export function createHelpRouter(_deps: HelpRouterDeps): Router {
  const { getUserFromReq } = _deps;
  const router = Router();

  // 1) GET /faqs/categories — 分类聚合（必须放在 /:id 之前，否则会被 catch）
  router.get("/faqs/categories", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const r = await query<{ category: string; count: string }>(
        `SELECT category, COUNT(*)::text AS count
           FROM help_faq
          WHERE company_id = $1 AND status = 'active'
          GROUP BY category
          ORDER BY category`,
        [u.companyId]
      );
      response.json({
        data: r.rows.map((row) => ({ category: row.category, count: parseInt(row.count, 10) }))
      });
    } catch (err) { next(err); }
  });

  // 2) GET /faqs — 列表（搜索 + 筛选 + 分页）
  router.get("/faqs", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = z
        .object({
          q: z.string().trim().optional().default(""),
          category: z.string().trim().optional(),
          module: z.string().trim().optional(),
          tag: z.string().trim().optional(),
          status: z.enum(STATUS_VALUES).optional().default("active"),
          page: z.coerce.number().int().min(1).optional().default(1),
          pageSize: z.coerce.number().int().min(1).max(200).optional().default(20)
        })
        .safeParse(request.query);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");

      const { q, category, module: mod, tag, status, page, pageSize } = parsed.data;
      const where: string[] = ["company_id = $1", "status = $2"];
      const params: any[] = [u.companyId, status];
      let pIdx = 3;

      if (q) {
        where.push(`(question ILIKE $${pIdx} OR answer ILIKE $${pIdx} OR $${pIdx + 1} = ANY(tags))`);
        params.push(`%${q}%`, q);
        pIdx += 2;
      }
      if (category) { where.push(`category = $${pIdx++}`); params.push(category); }
      if (mod)      { where.push(`related_module = $${pIdx++}`); params.push(mod); }
      if (tag)      { where.push(`$${pIdx++} = ANY(tags)`); params.push(tag); }

      const offset = (page - 1) * pageSize;
      const sql = `
        SELECT id, category, question, answer, tags, error_code, related_module,
               status, view_count, created_by, created_at, updated_at
          FROM help_faq
         WHERE ${where.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT $${pIdx++} OFFSET $${pIdx++}`;
      params.push(pageSize, offset);

      const countSql = `SELECT COUNT(*)::text AS total FROM help_faq WHERE ${where.join(" AND ")}`;
      const [rows, count] = await Promise.all([
        query(sql, params),
        query<{ total: string }>(countSql, params.slice(0, params.length - 2))
      ]);

      response.json({
        data: rows.rows,
        total: parseInt(count.rows[0]?.total ?? "0", 10),
        page,
        pageSize
      });
    } catch (err) { next(err); }
  });

  // 3) GET /faqs/:id — 详情（view_count +1）
  router.get("/faqs/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      if (!id) throw new ValidationError("缺少 FAQ ID");
      const r = await query(
        `SELECT id, category, question, answer, tags, error_code, related_module,
                status, view_count, created_by, created_at, updated_at
           FROM help_faq WHERE id = $1 AND company_id = $2`,
        [id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("FAQ 不存在");
      // +1 view_count（异步，不阻塞）
      query(`UPDATE help_faq SET view_count = view_count + 1 WHERE id = $1`, [id]).catch(() => {});
      response.json({ data: r.rows[0] });
    } catch (err) { next(err); }
  });

  // 4) POST /faqs — 录入
  router.post("/faqs", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = z
        .object({
          category: z.enum(CATEGORY_VALUES).optional().default("其他"),
          question: z.string().trim().min(2, "问题至少 2 字").max(500),
          answer: z.string().trim().min(2, "答案至少 2 字").max(10000),
          tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
          error_code: z.string().trim().max(100).optional(),
          related_module: z.enum(MODULE_VALUES).optional(),
          status: z.enum(STATUS_VALUES).optional().default("active")
        })
        .safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "请求参数无效");
      const data = parsed.data;

      const r = await query(
        `INSERT INTO help_faq (company_id, category, question, answer, tags, error_code, related_module, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, category, question, answer, tags, error_code, related_module, status, view_count, created_by, created_at, updated_at`,
        [u.companyId, data.category, data.question, data.answer, data.tags, data.error_code ?? null, data.related_module ?? null, data.status, u.id]
      );
      response.status(201).json({ data: r.rows[0] });
    } catch (err) { next(err); }
  });

  // 5) PATCH /faqs/:id — 修改（admin 或创建人）
  router.patch("/faqs/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const id = request.params.id;
      if (!id) throw new ValidationError("缺少 FAQ ID");
      const existing = await query<{ created_by: string | null }>(
        `SELECT created_by FROM help_faq WHERE id = $1 AND company_id = $2`,
        [id, u.companyId]
      );
      if (existing.rows.length === 0) throw new NotFoundError("FAQ 不存在");
      const isCreator = existing.rows[0].created_by === u.id;
      const isAdmin = u.isAdmin || u.role === "admin";
      if (!isAdmin && !isCreator) throw new ForbiddenError("仅管理员或创建人可修改");

      const parsed = z
        .object({
          category: z.enum(CATEGORY_VALUES).optional(),
          question: z.string().trim().min(2).max(500).optional(),
          answer: z.string().trim().min(2).max(10000).optional(),
          tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
          error_code: z.string().trim().max(100).nullable().optional(),
          related_module: z.enum(MODULE_VALUES).nullable().optional(),
          status: z.enum(STATUS_VALUES).optional()
        })
        .safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "请求参数无效");
      const data = parsed.data;

      const fields: string[] = [];
      const params: any[] = [];
      let pIdx = 1;
      for (const [key, value] of Object.entries(data)) {
        fields.push(`${key} = $${pIdx++}`);
        params.push(value);
      }
      if (fields.length === 0) {
        // 无修改，直接返回当前数据
        const cur = await query(`SELECT * FROM help_faq WHERE id = $${pIdx++}`, [id]);
        response.json({ data: cur.rows[0] });
        return;
      }
      fields.push(`updated_at = now()`);
      params.push(id);
      params.push(u.companyId);

      const r = await query(
        `UPDATE help_faq SET ${fields.join(", ")}
          WHERE id = $${pIdx++} AND company_id = $${pIdx++}
          RETURNING id, category, question, answer, tags, error_code, related_module, status, view_count, created_by, created_at, updated_at`,
        params
      );
      response.json({ data: r.rows[0] });
    } catch (err) { next(err); }
  });

  // 6) DELETE /faqs/:id — 归档（admin）
  router.delete("/faqs/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const isAdmin = u.isAdmin || u.role === "admin";
      if (!isAdmin) throw new ForbiddenError("仅管理员可删除 FAQ");
      const id = request.params.id;
      if (!id) throw new ValidationError("缺少 FAQ ID");
      const r = await query(
        `UPDATE help_faq SET status = 'archived', updated_at = now()
          WHERE id = $1 AND company_id = $2 RETURNING id`,
        [id, u.companyId]
      );
      if (r.rows.length === 0) throw new NotFoundError("FAQ 不存在");
      response.json({ data: { id, archived: true } });
    } catch (err) { next(err); }
  });

  return router;
}
