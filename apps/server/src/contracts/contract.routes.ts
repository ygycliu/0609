/**
 * V2.2 合同管理 - 路由（15 个端点）
 */
import { Router, Request, Response as ExResponse, NextFunction } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import multer from "multer";
import { ContractRepository } from "./contract.repository.js";
import {
  extractFromFile,
  extractText,
  extractContractFields,
  getFileType,
  saveUploadedFile
} from "./contract.extractor.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { findCustomerByName } from "./customer.matcher.js";
import { authMiddleware } from "../auth/auth.service.js";
import { readCookie, ACCESS_COOKIE } from "../auth/session.js";

export const contractRouter = Router();
const repo = new ContractRepository();

// V2.2：auth middleware 注入 req.user
contractRouter.use(async (req: Request, _res: ExResponse, next: NextFunction) => {
  try {
    const token = readCookie(req as any, ACCESS_COOKIE);
    const user = await authMiddleware(token);
    if (!user) {
      (_res as any).status(401).json({ code: "UNAUTHORIZED", message: "请登录" });
      return;
    }
    (req as any).user = user;
    next();
  } catch (e) {
    next(e);
  }
});

function q(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v[0] || undefined;
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function qs(v: any): string {
  const r = q(v);
  if (r === undefined) throw new Error("缺少必填参数");
  return r;
}

// Multer 内存上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

interface AuthedRequest extends Request {
  user?: { id: string; companyId: string; role: string };
}

function getUser(req: AuthedRequest) {
  return req.user || { id: "", companyId: "00000000-0000-0000-0000-000000000001", role: "admin" };
}

// ================================= =============
// 1. 合同 CRUD
// ================================= =============

// 列表
contractRouter.get("/", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    const opts: any = {};
    if (q(req.query.signing_entity_id)) opts.signingEntityId = q(req.query.signing_entity_id);
    if (q(req.query.customer_id)) opts.customerId = q(req.query.customer_id);
    if (q(req.query.status)) opts.status = q(req.query.status);
    if (q(req.query.contract_type)) opts.contractType = q(req.query.contract_type);
    if (q(req.query.q)) opts.q = q(req.query.q);
    if (q(req.query.start_date)) opts.startDate = q(req.query.start_date);
    if (q(req.query.end_date)) opts.endDate = q(req.query.end_date);
    const minAmt = q(req.query.min_amount);
    if (minAmt && !Number.isNaN(Number(minAmt))) opts.minAmount = Number(minAmt);
    const maxAmt = q(req.query.max_amount);
    if (maxAmt && !Number.isNaN(Number(maxAmt))) opts.maxAmount = Number(maxAmt);
    if (q(req.query.certification_type)) opts.certificationType = q(req.query.certification_type);
    if (q(req.query.has_file) === "true") opts.hasFile = true;
    const limit = q(req.query.limit);
    opts.limit = limit ? Math.min(Number(limit), 200) : 50;
    const offset = q(req.query.offset);
    opts.offset = offset ? Math.max(Number(offset), 0) : 0;

    const result = await repo.list(u.companyId, opts);
    res.json({ data: result.items, total: result.total });
  } catch (e) { next(e); }
});

// 详情
contractRouter.get("/:id", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    const c = await repo.get(u.companyId, qs(req.params.id));
    if (!c) return res.status(404).json({ error: "未找到合同" });
    const files = await repo.listFiles(u.companyId, c.id);
    const projects = await repo.listLinkedProjects(c.id);
    const events = await repo.listEvents(c.id);

    // V2.3.2：结构化详情 — 增加 AI 抽取字段、原始数据、关联信息
    const ai = c.rawExtracted?.extracted || c.rawExtracted || {};

    // 规范化结构化字段（AI 抽取的是中文 key → 标准化 camelCase）
    const structured = {
      // 主体信息
      customer: c.customerId ? {
        id: c.customerId,
        name: c.customerName,
        code: null  // 可后续补充
      } : null,
      signingEntity: c.signingEntityId ? {
        id: c.signingEntityId,
        name: c.signingEntityName,
        aiExtractedName: ai['乙方主体'] || null
      } : null,

      // 认证信息（来自 AI 或手工）
      certification: {
        category: ai['合同类型'] || null,
        systems: ai['认证体系'] || ai.cert_systems || ai.certification_types || c.certificationTypes || [],
        scope: ai['认证范围'] || ai.cert_scope || null,
        auditRegion: ai['审核区域'] || ai.audit_region || null,
        employeeCount: ai['员工人数'] || ai.employee_count || null,
        siteCount: ai['分公司/分厂数'] || ai.site_count || null,
        tempSiteCount: ai['临时现场数'] || ai.temp_site_count || null,
        accreditationMark: ai['认可标志'] || ai.accreditation_mark || null,
        certificateValidity: ai['证书有效期'] || ai.certificate_validity || null,
        multiSiteRequired: ai['多场所要求'] || ai.multi_site_required || false,
        specialRequirements: ai['其他特殊要求'] || ai.special_requirements || null,
        originalContractNo: ai['原合同编号'] || null
      },

      // 财务信息
      financial: {
        totalAmount: Number(ai['合同金额'] || c.contractAmount || 0),
        firstAuditFee: ai['初次认证费'] || ai.first_audit_fee || null,
        firstYearSupervisionFee: ai['第一年监督审核费'] || ai.first_year_supervision_fee || null,
        secondYearSupervisionFee: ai['第二年监督审核费'] || ai.second_year_supervision_fee || null,
        recertFee: ai['再认证费'] || ai.recert_fee || null,
        paymentTerms: ai['付款条款'] || ai.payment_terms || null,
        bankName: ai['开户行'] || c.bankName || ai.bank_name || null,
        bankHolder: ai['户名'] || c.bankHolder || ai.bank_holder || null,
        bankAccount: ai['账号'] || c.bankAccount || ai.bank_account || null
      },

      // 联系人
      contact: {
        person: ai['联系人'] || c.contactPerson || ai.contact_person || null,
        phone: ai['联系电话'] || c.contactPhone || ai.contact_phone || null,
        email: ai['电子邮箱'] || ai.contact_email || null,
        position: ai['联系人职务'] || ai.contact_position || null
      },

      // 时间
      timeline: {
        signedAt: ai['签订日期'] || c.signedAt,
        effectiveAt: ai['生效日期'] || c.effectiveAt,
        expireAt: ai['到期日期'] || c.expireAt
      },

      // AI 元数据
      aiMeta: {
        confidence: c.extractionConfidence,
        source: ai.source || c.source,
        extractedAt: c.createdAt,
        aiModel: ai.ai_model || null,
        serviceType: ai['服务类型'] || null
      }
    };

    // 第一个文件的 OCR 文本（前 5000 字符）
    const ocrText = files && files.length > 0 ? files[0].ocrText : null;
    const primaryFile = files && files.length > 0 ? files[0] : null;

    res.json({
      data: {
        ...c,
        structured,
        primaryFile: primaryFile ? {
          id: primaryFile.id,
          fileName: primaryFile.fileName,
          fileType: primaryFile.fileType,
          fileSize: primaryFile.fileSize,
          sha256: primaryFile.sha256,
          uploadedAt: primaryFile.uploadedAt,
          downloadUrl: `/ai/api/contracts/files/${primaryFile.id}/download`,
          ocrStatus: primaryFile.ocrStatus,
          ocrText  // 前 5000 字符
        } : null,
        files,
        projects,
        events
      }
    });
  } catch (e) { next(e); }
});

// 创建（手动）
contractRouter.post("/", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员可创建" });
    const c = await repo.create(u.companyId, { ...req.body, source: "manual" });
    if (!c) return res.status(400).json({ error: "创建失败" });
    await repo.addEvent(u.companyId, {
      contractId: c.id,
      eventType: "created",
      toStatus: c.status,
      operatorId: u.id,
      notes: "手动创建"
    });
    res.json({ data: c });
  } catch (e) { next(e); }
});

// 更新
contractRouter.patch("/:id", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员可更新" });
    const before = await repo.get(u.companyId, qs(req.params.id));
    if (!before) return res.status(404).json({ error: "未找到" });
    const c = await repo.update(u.companyId, qs(req.params.id), req.body);
    // 状态变更记录事件
    if (req.body.status && req.body.status !== before.status) {
      await repo.addEvent(u.companyId, {
        contractId: qs(req.params.id),
        eventType: req.body.status === "terminated" ? "terminated" : "status_changed",
        fromStatus: before.status,
        toStatus: req.body.status,
        operatorId: u.id
      });
    } else {
      await repo.addEvent(u.companyId, {
        contractId: qs(req.params.id),
        eventType: "updated",
        operatorId: u.id,
        payload: { changed: Object.keys(req.body) }
      });
    }
    res.json({ data: c });
  } catch (e) { next(e); }
});

// 删除
contractRouter.delete("/:id", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员可删除" });
    const ok = await repo.softDelete(u.companyId, qs(req.params.id));
    if (!ok) return res.status(404).json({ error: "未找到" });
    await repo.addEvent(u.companyId, {
      contractId: qs(req.params.id),
      eventType: "deleted",
      operatorId: u.id
    });
    res.json({ data: { id: qs(req.params.id), deleted: true } });
  } catch (e) { next(e); }
});

// ================================= =============
// 2. PDF 导入（核心 V2.2）
// ================================= =============

// 上传 PDF 并抽取字段
contractRouter.post(
  "/import/pdf",
  upload.single("file"),
  async (req: AuthedRequest, res: ExResponse, next) => {
    try {
      const u = getUser(req);
      if (u.role !== "admin") return res.status(403).json({ error: "仅管理员可导入" });
      if (!req.file) return res.status(400).json({ error: "未上传文件" });

      // 提取
      const result = await extractFromFile(req.file.buffer, req.file.originalname);

      // 智能匹配客户
      let matchedCustomer: any = null;
      let newCustomerNeeded = false;
      if (result.extracted.甲方客户名) {
        const match = await findCustomerByName(u.companyId, result.extracted.甲方客户名);
        if (match.customer) {
          matchedCustomer = {
            id: match.customer.id,
            name: match.customer.name,
            matchType: match.matchType,
            confidence: match.confidence
          };
          // 加别名
          await repo.addAlias(u.companyId, match.customer.id, result.extracted.甲方客户名, "contract_import");
        } else {
          newCustomerNeeded = true;
        }
      }

      // 智能匹配签约主体
      let matchedEntity: any = null;
      if (result.extracted.乙方主体) {
        const entities = await query<any>(
          `SELECT id, name, short_name, entity_code FROM signing_entity
           WHERE company_id = $1 AND deleted_at IS NULL`,
          [u.companyId]
        );
        const txt = result.extracted.乙方主体;
        for (const e of entities.rows) {
          if (e.name === txt || e.short_name === txt || txt.includes(e.short_name || "")) {
            matchedEntity = { id: e.id, name: e.name, entity_code: e.entity_code };
            break;
          }
        }
      }

      res.json({
        data: {
          file: {
            originalName: req.file.originalname,
            size: req.file.size,
            storagePath: result.file.path,
            sha256: result.file.sha256,
            usedOcr: result.usedOcr
          },
          text: result.text,
          extracted: result.extracted,
          confidence: result.confidence,
          errors: result.errors,
          matched: {
            customer: matchedCustomer,
            newCustomerNeeded,
            signingEntity: matchedEntity
          }
        }
      });
    } catch (e: any) {
      console.error("[import/pdf]", e);
      res.status(500).json({ error: e.message || "导入失败" });
    }
  }
);

// 确认入库（人工确认后）
contractRouter.post("/import/confirm", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const body = req.body;
    if (!body.file?.storagePath || !body.customerId || !body.signingEntityId || !body.contractNo) {
      return res.status(400).json({ error: "缺少必填字段" });
    }

    // 1. 创建合同
    const contract = await repo.create(u.companyId, {
      customerId: body.customerId,
      contractNo: body.contractNo,
      contractType: body.contractType || "main",
      parentContractId: body.parentContractId || null,
      signingEntityId: body.signingEntityId,
      title: body.title,
      contractAmount: Number(body.contractAmount || 0),
      certificationTypes: body.certificationTypes || [],
      signedAt: body.signedAt,
      effectiveAt: body.effectiveAt,
      expireAt: body.expireAt,
      bankName: body.bankName,
      bankAccount: body.bankAccount,
      bankHolder: body.bankHolder,
      contactPerson: body.contactPerson,
      contactPhone: body.contactPhone,
      serviceType: body.serviceType,
      status: body.status || "draft",
      rawExtracted: body.extracted,
      extractionConfidence: body.confidence,
      source: "pdf_import",
      notes: body.notes,
      createdBy: u.id
    });
    if (!contract) return res.status(400).json({ error: "创建合同失败" });

    // 2. 关联文件
    const fileId = await repo.addFile(u.companyId, {
      contractId: contract.id,
      fileName: body.file.originalName,
      fileType: getFileType(body.file.originalName),
      fileSize: body.file.size || 0,
      storagePath: body.file.storagePath,
      sha256: body.file.sha256 || null,
      ocrStatus: body.file.usedOcr ? "done" : "done",
      ocrText: body.text || null,
      ocrExtracted: body.extracted || null,
      version: 1,
      isPrimary: true,
      uploadedBy: u.id
    });
    await repo.update(u.companyId, contract.id, { fileId });

    // 3. 关联项目
    if (body.relatedProjectIds && Array.isArray(body.relatedProjectIds)) {
      for (const pid of body.relatedProjectIds) {
        await repo.linkProject(u.companyId, contract.id, pid, body.allocatedAmount || null);
      }
    }

    // 4. 加别名
    if (body.extracted?.甲方客户名) {
      await repo.addAlias(u.companyId, body.customerId, body.extracted.甲方客户名, "contract_import");
    }

    // 5. 事件
    await repo.addEvent(u.companyId, {
      contractId: contract.id,
      eventType: "created",
      toStatus: contract.status,
      payload: { source: "pdf_import", confidence: body.confidence },
      operatorId: u.id
    });

    res.json({ data: contract });
  } catch (e: any) {
    console.error("[import/confirm]", e);
    res.status(500).json({ error: e.message });
  }
});

// ================================= =============
// 3. 文件管理
// ================================= =============

// 列出文件
contractRouter.get("/:id/files", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    const files = await repo.listFiles(u.companyId, qs(req.params.id));
    res.json({ data: files });
  } catch (e) { next(e); }
});

// 上传文件（追加版本）
contractRouter.post(
  "/:id/files",
  upload.single("file"),
  async (req: AuthedRequest, res: ExResponse, next) => {
    try {
      const u = getUser(req);
      if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
      if (!req.file) return res.status(400).json({ error: "未上传文件" });
      const existing = await repo.listFiles(u.companyId, qs(req.params.id));
      const fileId = await repo.addFile(u.companyId, {
        contractId: qs(req.params.id),
        fileName: req.file.originalname,
        fileType: getFileType(req.file.originalname),
        fileSize: req.file.size,
        storagePath: "",
        sha256: null,
        ocrStatus: "pending",
        ocrText: null,
        ocrExtracted: null,
        version: existing.length + 1,
        isPrimary: false,
        uploadedBy: u.id
      });
      res.json({ data: { id: fileId } });
    } catch (e) { next(e); }
  }
);

// 下载文件
contractRouter.get("/files/:fileId/download", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    const file = await repo.getFile(u.companyId, qs(req.params.fileId));
    if (!file) return res.status(404).json({ error: "未找到文件" });
    if (!file.storage_path) return res.status(404).json({ error: "文件未存储" });
    res.download(file.storage_path, file.file_name);
  } catch (e) { next(e); }
});

// 删除文件
contractRouter.delete("/files/:fileId", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const ok = await repo.deleteFile(u.companyId, qs(req.params.fileId));
    if (!ok) return res.status(404).json({ error: "未找到" });
    res.json({ data: { id: qs(req.params.fileId), deleted: true } });
  } catch (e) { next(e); }
});

// ================================= =============
// 4. 项目关联
// ================================= =============

// 关联项目
contractRouter.post("/:id/projects", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const { certification_project_id, allocated_amount } = req.body;
    if (!certification_project_id) return res.status(400).json({ error: "缺少项目ID" });
    await repo.linkProject(u.companyId, qs(req.params.id), certification_project_id, allocated_amount || null);
    await repo.addEvent(u.companyId, {
      contractId: qs(req.params.id),
      eventType: "project_linked",
      payload: { certification_project_id, allocated_amount },
      operatorId: u.id
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// 取消关联
contractRouter.delete("/:id/projects/:projectId", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    await repo.unlinkProject(u.companyId, qs(req.params.id), qs(req.params.projectId));
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ================================= =============
// 5. 统计
// ================================= =============

contractRouter.get("/stats/summary", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    const stats = await repo.getStats(u.companyId);
    res.json({ data: stats });
  } catch (e) { next(e); }
});

// ================================= =============
// 6. 批量导入（V2.2 关键）
// ================================= =============

// 扫描目录
contractRouter.post("/import/batch", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const u = getUser(req);
    if (u.role !== "admin") return res.status(403).json({ error: "仅管理员" });
    const { source_path, batch_name } = req.body;
    if (!source_path) return res.status(400).json({ error: "缺少目录路径" });

    const batchId = await repo.createBatch(
      u.companyId,
      batch_name || `批量导入 ${new Date().toLocaleDateString()}`,
      source_path,
      u.id
    );

    // 异步处理
    process.nextTick(() => processBatch(batchId, source_path, u).catch(err => {
      console.error("[batch]", err);
    }));

    res.json({ data: { batchId, status: "processing" } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 异步批量处理
async function processBatch(batchId: string, sourcePath: string, u: { id: string; companyId: string }) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execFile);

    // 找所有 PDF/DOC（用 cd + ls 避免中文路径 ENOENT）
    const r = await execAsync("bash", ["-c", `cd "${sourcePath}" && find . -maxdepth 2 -type f \\( -name "*.pdf" -o -name "*.doc" -o -name "*.docx" \\) -printf "%p\n"`], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    const files = r.stdout.trim().split("\n").filter(Boolean).map(f => `${sourcePath}/${f.startsWith("./") ? f.slice(2) : f}`);
    const total = files.length;

    let success = 0, failed = 0, pending = 0;
    for (const file of files) {
      try {
        const buffer = await fs.readFile(file);
        const ext = path.extname(file).toLowerCase();
        const fileType = (ext === ".pdf" ? "pdf" : ext === ".doc" ? "doc" : ext === ".docx" ? "docx" : "image") as "pdf" | "doc" | "docx" | "image";
        let textResult: { text: string; usedOcr: boolean; errors: string[] };
        if (ext === ".pdf" && buffer.length > 500 * 1024) {
          // 大文件只 OCR 前 2 页
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(execFile);
          const tmpPrefix = `/tmp/contract_batch_${Date.now()}`;
          try {
            await execAsync("pdftoppm", ["-png", "-r", "150", "-f", "1", "-l", "2", file, tmpPrefix], { timeout: 30000 });
            const { readdir, unlink } = await import("node:fs/promises");
            const tmpFiles = await readdir("/tmp");
            const pngs = tmpFiles.filter(f => f.startsWith(path.basename(tmpPrefix)) && f.endsWith(".png")).sort();
            let text = "";
            for (const png of pngs.slice(0, 2)) {
              const r = await execAsync("tesseract", [`/tmp/${png}`, "stdout", "-l", "chi_sim+eng", "--psm", "6"], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
              text += r.stdout + "\n";
              await unlink(`/tmp/${png}`).catch(() => {});
            }
            textResult = { text: text.trim(), usedOcr: true, errors: [] };
          } catch (e: any) {
            textResult = await extractText(file, fileType).catch(() => ({ text: "", usedOcr: false, errors: [e.message] }));
          }
        } else {
          textResult = await extractText(file, fileType);
        }
        const result = {
          file: { path: file, sha256: "", size: buffer.length },
          text: textResult.text,
          usedOcr: textResult.usedOcr,
          extracted: null as any,
          confidence: 0,
          errors: textResult.errors
        };

        if (result.text.length < 30) {
          failed++;
          continue;
        }

        // AI 抽取
        let aiResult;
        try {
          aiResult = await extractContractFields(result.text);
        } catch (e: any) {
          result.errors.push(`AI failed: ${e.message}`);
          failed++;
          continue;
        }
        result.extracted = aiResult.extracted;
        result.confidence = aiResult.confidence;

        // 自动匹配客户
        let customerId: string | null = null;
        if (result.extracted.甲方客户名) {
          const m = await findCustomerByName(u.companyId, result.extracted.甲方客户名);
          if (m.customer) customerId = m.customer.id;
        }
        if (!customerId) {
          pending++;
          continue;
        }

        // 自动匹配签约主体
        let signingEntityId: string | null = null;
        if (result.extracted.乙方主体) {
          const ents = await query<any>(
            `SELECT id FROM signing_entity WHERE company_id = $1 AND deleted_at IS NULL AND (name = $2 OR short_name = $2 OR $2 LIKE '%' || short_name || '%') LIMIT 1`,
            [u.companyId, result.extracted.乙方主体]
          );
          if (ents.rows[0]) signingEntityId = ents.rows[0].id;
        }
        if (!signingEntityId) {
          pending++;
          continue;
        }

        // 创建合同（status=draft 等人工确认）
        const contractNo = result.extracted.合同编号 || `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const c = await repo.create(u.companyId, {
          customerId,
          contractNo,
          contractType: result.extracted.合同类型 || "main",
          signingEntityId,
          title: `【批量导入】${path.basename(file, path.extname(file))}`,
          contractAmount: result.extracted.合同金额 || 0,
          certificationTypes: result.extracted.认证体系 || [],
          signedAt: result.extracted.签订日期,
          bankName: result.extracted.开户行,
          bankAccount: result.extracted.账号,
          bankHolder: result.extracted.户名,
          contactPerson: result.extracted.联系人,
          contactPhone: result.extracted.联系电话,
          serviceType: result.extracted.服务类型,
          status: "draft",
          rawExtracted: result.extracted,
          extractionConfidence: result.confidence,
          source: "pdf_import",
          notes: `自动从 ${sourcePath} 导入`,
          createdBy: u.id
        });

        // 加文件
        if (c) {
          await repo.addFile(u.companyId, {
            contractId: c.id,
            fileName: path.basename(file),
            fileType: getFileType(file),
            fileSize: buffer.length,
            storagePath: result.file.path,
            sha256: result.file.sha256,
            ocrStatus: "done",
            ocrText: result.text,
            ocrExtracted: result.extracted,
            version: 1,
            isPrimary: true,
            uploadedBy: u.id
          });
          success++;
        } else {
          failed++;
        }
      } catch (e: any) {
        console.error(`[batch] file ${file} failed:`, e.message);
        failed++;
      }
      // 更新进度（每5个文件）
      if ((success + failed + pending) % 5 === 0) {
        await repo.updateBatchProgress(batchId, total, success, failed, pending);
      }
    }
    await repo.updateBatchProgress(batchId, total, success, failed, pending);
    await repo.completeBatch(batchId, "completed");
  } catch (e: any) {
    console.error("[batch process]", e);
    await repo.completeBatch(batchId, "failed");
  }
}

// 批次列表
contractRouter.get("/import/batches", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const r = await query<any>(
      `SELECT * FROM contract_import_batch ORDER BY started_at DESC LIMIT 50`
    );
    res.json({ data: r.rows });
  } catch (e) { next(e); }
});

// 批次详情
contractRouter.get("/import/batches/:id", async (req: AuthedRequest, res: ExResponse, next) => {
  try {
    const batch = await repo.getBatch(qs(req.params.id));
    if (!batch) return res.status(404).json({ error: "未找到" });
    res.json({ data: batch });
  } catch (e) { next(e); }
});