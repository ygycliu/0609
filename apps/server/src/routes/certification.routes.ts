import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../shared/errors.js";
import { QuoteRepository } from "../certification/quote.repository.js";
import {
  generateQuote,
  getAvailableCertifications,
  INDUSTRY_OPTIONS,
  RISK_LEVEL_OPTIONS
} from "../certification/quote.service.js";
import { generateQuoteDocx } from "../docx/docx-report.service.js";
import { quoteExportPayloadSchema } from "../certification/quote-export.schema.js";

type AuthedRequest = Request;
type ExResponse = Response;

export interface CertificationRouterDeps {
  getUserFromReq: (req: Request) => { companyId: string; id: string; username?: string; userId?: string };
  quoteRepository: QuoteRepository;
}

export function createCertificationRouter(deps: CertificationRouterDeps): Router {
  const { getUserFromReq, quoteRepository } = deps;
  const router = Router();

  // 1) GET /options
    router.get("/options", (_request, response) => {
    response.json({
      data: {
        industries: INDUSTRY_OPTIONS,
        riskLevels: RISK_LEVEL_OPTIONS,
        certifications: getAvailableCertifications()
      }
    });
  });

  // 2) POST /quote
    router.post("/quote", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      const parsed = z
        .object({
          companyName: z.string().trim().min(1, "请填写企业名称").max(100),
          industry: z.string().trim().min(1, "请选择企业类型"),
          employeeCount: z.number().int().min(1, "人数必须 ≥ 1").max(100000),
          certifications: z.array(z.string().trim().min(1)).min(1, "至少选择一项认证"),
          riskLevel: z.enum(["medium", "high"]).default("medium"),
          certificationScope: z.string().trim().max(2000).optional().default(""),
          expertCount: z.number().int().min(1).max(20).optional().default(1)
        })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "请求参数无效");
      }
      const result = await generateQuote(parsed.data);
      // 持久化到 DB（DB 不可用时 fallback 到 JSON 文件）
      let quoteId: string | undefined;
      try {
        const rec = await quoteRepository.save(u.companyId, u.id, parsed.data, result);
        quoteId = rec.id;
      } catch (err) {
        console.warn("Quote save failed (non-fatal):", (err as Error).message);
      }
      response.json({ data: result, quoteId });
    } catch (error) {
      next(error);
    }
  });

  // 3) GET /quotes
    router.get("/quotes", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      response.json({ data: await quoteRepository.list(u.companyId) });
    } catch (error) {
      next(error);
    }
  });

  // 4) POST /quote/export/docx
    router.post("/quote/export/docx", async (request, response, next) => {
    try {
      const parsed = quoteExportPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "导出参数无效");
      }
      const buffer = await generateQuoteDocx(parsed.data.quote, {
        // 首页显示认证机构信息（固定）
        companyName: "华中国际认证检验集团有限公司",
        clientName: parsed.data.companyName,
        projectName: "认证证书报价",
        documentTitle: "认证证书报价单",
        version: "v1.0",
        preparedBy: "刘军",
        agencyAddress: "银川国智知识产权服务园201室",
        agencyContact: "13195086656",
        confidentiality: "内部",
        includeToc: false,
        includeReferences: false
      });
      const safeName = `${parsed.data.companyName}-认证报价单.docx`.replace(/[\\/:*?"<>|]/g, "-");
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`
      );
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
