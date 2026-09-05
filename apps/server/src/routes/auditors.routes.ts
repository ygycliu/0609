/**
 * V2.2：审核员档案管理（复数 /api/auditors/*）
 * 10 个端点：从 app.ts 拆出（阶段 1 #6）
 *
 * 端点列表：
 *   GET    /                     列出审核员（支持 q/status/level/organization/specialty 筛选）
 *   GET    /stats                统计
 *   GET    /cert-image           按路径取证书图片（限定 /mnt/renz/）
 *   GET    /:id                  获取单个审核员
 *   POST   /                     新增审核员（仅 admin）
 *   PATCH  /:id                  修改审核员（仅 admin）
 *   PATCH  /:id/status           停用/启用（仅 admin）
 *   DELETE /:id                  删除审核员（仅 admin）
 *   POST   /ocr                  OCR 上传图片/PDF
 *   POST   /:id/ocr-all          批量 OCR 单个审核员所有证书（仅 admin）
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import multer from "multer";
import { ValidationError, NotFoundError } from "../shared/errors.js";

export interface AuditorsRouterDeps {
  upload: multer.Multer;
  getUserFromReq: (request: Request) => any;
  // AuditorProfileRepository 实例
  auditorRepo: {
    list: (companyId: string, opts: any) => Promise<{ items: any[]; total: number }>;
    getStats: (companyId: string) => Promise<any>;
    get: (companyId: string, id: string) => Promise<any | null>;
    create: (companyId: string, data: any) => Promise<any>;
    update: (companyId: string, id: string, data: any) => Promise<any | null>;
    setStatus: (companyId: string, id: string, status: any) => Promise<any | null>;
    delete: (companyId: string, id: string) => Promise<boolean>;
  };
  // OCR 模块
  ocrModule: {
    ocrCertificate: (args: { filePath: string; fileName?: string }) => Promise<any>;
  };
}

export function createAuditorsRouter(_deps: AuditorsRouterDeps): Router {
  const router = Router();
  const upload = _deps.upload;
  const auditorRepo = _deps.auditorRepo;
  const ocrModule = _deps.ocrModule;
  const getUserFromReq = _deps.getUserFromReq;

  // ============== V2.0：审核员档案管理 ==============
  // 与 enumCrud 不同：独立表，独立字段，独立业务逻辑
  // auditorRepo 已在 createApp 顶部创建

  // 列出审核员
  router.get("/", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const q = (request.query.q as string) || "";
      const status = (request.query.status as string) || "";
      const level = (request.query.level as string) || "";
      const organization = (request.query.organization as string) || "";
      const specialty = (request.query.specialty as string) || "";
      const limit = Math.min(Math.max(parseInt((request.query.limit as string) || "100"), 1), 500);
      const offset = Math.max(parseInt((request.query.offset as string) || "0"), 0);
      const result = await auditorRepo.list(u.companyId, {
        q: q.trim(),
        status: status || undefined,
        level: level || undefined,
        organization: organization || undefined,
        specialty: specialty || undefined,
        limit,
        offset
      });
      response.json({ data: result.items, total: result.total });
    } catch (error) { next(error); }
  });

  // 统计
  router.get("/stats", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const stats = await auditorRepo.getStats(u.companyId);
      response.json({ data: stats });
    } catch (error) { next(error); }
  });

  // V2.0：认证证书预警 API

  // V2.0：单证书详情

  // V2.0：标记证书为"已处理"（仅 status 备注，不删除）

  // V2.0：批量确认证书

  // V2.0：撤销确认（恢复显示）

  // 单个审核员
  // V2.0：获取证书图片（base64 形式，便于前端预览）
    // 安全：只允许 /mnt/renz/ 下的文件
    // 注意：必须放在 /api/auditors/:id 路由之前，否则会被 id 路由拦截
    router.get("/cert-image", async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const filePath = (request.query.path as string) || "";
        if (!filePath) throw new ValidationError("文件路径必填");
        // 安全检查：必须以 /mnt/renz/ 开头（避免任意文件读取）
        if (!filePath.startsWith("/mnt/renz/")) {
          response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅允许访问 /mnt/renz/ 下的证书图片" });
          return;
        }
        const fsPromises = await import("fs/promises");
        try {
          await fsPromises.access(filePath);
        } catch {
          throw new NotFoundError("证书图片");
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp"
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        const buffer = await fsPromises.readFile(filePath);
        const base64 = buffer.toString("base64");
        response.json({
          data: {
            path: filePath,
            mime,
            ext,
            size: buffer.length,
            base64: `data:${mime};base64,${base64}`
          }
        });
      } catch (error) { next(error); }
    });

    router.get("/:id", async (request, response, next) => {
      try {
        const u = getUserFromReq(request);
        const item = await auditorRepo.get(u.companyId, request.params.id);
        if (!item) throw new NotFoundError("审核员");
        response.json({ data: item });
      } catch (error) { next(error); }
    });

  // 创建审核员
  router.post("/", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以新增审核员档案" });
        return;
      }
      const body = request.body as Record<string, unknown>;
      if (!body.name) throw new ValidationError("姓名必填");
      const created = await auditorRepo.create(u.companyId, {
        name: String(body.name),
        code: body.code as string || null,
        gender: body.gender as string || null,
        idNumber: body.idNumber as string || null,
        phone: body.phone as string || null,
        email: body.email as string || null,
        organization: body.organization as string || null,
        department: body.department as string || null,
        position: body.position as string || null,
        level: (body.level as string) || "intermediate",
        specialties: Array.isArray(body.specialties) ? body.specialties as string[] : [],
        certNo: body.certNo as string || null,
        certIssueDate: body.certIssueDate as string || null,
        certExpiry: body.certExpiry as string || null,
        certStatus: (body.certStatus as string) || "active",
        dailyRate: Number(body.dailyRate ?? 0),
        expertType: (body.expertType as string) || "auditor",
        region: body.region as string || null,
        languages: Array.isArray(body.languages) ? body.languages as string[] : [],
        bio: body.bio as string || null,
        notes: body.notes as string || null,
        status: (body.status as string) || "active",
        tags: Array.isArray(body.tags) ? body.tags as string[] : [],
        source: (body.source as string) || "manual",
        sourcePath: body.sourcePath as string || null
      });
      response.status(201).json({ data: created });
    } catch (error) { next(error); }
  });

  // 更新审核员
  router.patch("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以修改审核员档案" });
        return;
      }
      const updated = await auditorRepo.update(u.companyId, request.params.id, request.body);
      if (!updated) throw new NotFoundError("审核员");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  // 停用/启用
  router.patch("/:id/status", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以停用审核员" });
        return;
      }
      const body = request.body as { status?: string };
      if (!body.status || !["active", "inactive", "retired"].includes(body.status)) {
        throw new ValidationError("status 必须是 active / inactive / retired");
      }
      const updated = await auditorRepo.setStatus(u.companyId, request.params.id, body.status as any);
      if (!updated) throw new NotFoundError("审核员");
      response.json({ data: updated });
    } catch (error) { next(error); }
  });

  // 软删除
  router.delete("/:id", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可以删除审核员" });
        return;
      }
      const ok = await auditorRepo.delete(u.companyId, request.params.id);
      if (!ok) throw new NotFoundError("审核员");
      response.json({ data: { id: request.params.id, deleted: true } });
    } catch (error) { next(error); }
  });

  // V2.0：OCR 识别证书图片
  router.post("/ocr", upload.single("file"), async (request, response, next) => {
    try {
      const file = request.file;
      if (!file) throw new ValidationError("请上传证书图片");
      const ext = path.extname(file.originalname).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".pdf"].includes(ext)) {
        throw new ValidationError("只支持 PNG/JPG/PDF 格式");
      }
      // multer memoryStorage：把 buffer 写临时文件
      const tmpPath = `/tmp/ocr_${Date.now()}${ext}`;
      const fsPromises = await import("fs/promises");
      await fsPromises.writeFile(tmpPath, file.buffer);
      const result = await ocrModule.ocrCertificate({
        filePath: tmpPath,
        fileName: file.originalname
      });
      // 清理
      try { await fsPromises.unlink(tmpPath); } catch {}
      response.json({ data: result });
    } catch (error) { next(error); }
  });

  // V2.0：扫描并 OCR 单个审核员的所有证书图片（按 file 路径）
  router.post("/:id/ocr-all", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (u.role !== "admin") {
        response.status(403).json({ code: "FORBIDDEN", message: "❌ 仅管理员可触发 OCR" });
        return;
      }
      const auditor = await auditorRepo.get(u.companyId, request.params.id);
      if (!auditor) throw new NotFoundError("审核员");
      const certs = auditor.certificates || [];
      const results: any[] = [];
      for (const c of certs) {
        const file = c.file;
        if (!file) continue;
        const fsPromises = await import("fs/promises");
        try {
          await fsPromises.access(file);
          const r = await ocrModule.ocrCertificate({ filePath: file, fileName: c.source_name });
          results.push({ source_name: c.source_name, file, ...r });
        } catch (e: any) {
          results.push({ source_name: c.source_name, file, error: e?.message || "文件不存在" });
        }
      }
      response.json({ data: { total: certs.length, results } });
    } catch (error) { next(error); }
  });
  return router;
}
