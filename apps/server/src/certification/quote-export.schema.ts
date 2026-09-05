import { z } from "zod";

// 报价导出 payload schema（certification 端点专用）
export const quoteExportPayloadSchema = z.object({
  companyName: z.string().trim().min(1).max(100),
  companyContext: z.string().trim().max(1000).optional().default(""),
  quote: z.object({
    companyName: z.string(),
    industry: z.string(),
    employeeCount: z.number(),
    certifications: z.array(z.object({
      certId: z.string(),
      certName: z.string(),
      basePrice: z.number(),
      industryFactor: z.number(),
      adjustedBase: z.number(),
      initialAuditDays: z.number(),
      supervisionAuditDays: z.number(),
      recertificationAuditDays: z.number(),
      auditorLevel: z.enum(["中级", "高级"])
    })),
    sizeFactor: z.number(),
    sizeTier: z.string(),
    subtotal: z.number(),
    afterSizeFactor: z.number(),
    bundleDiscount: z.number(),
    bundleTier: z.string(),
    initialPrice: z.number(),
    supervisionPrice: z.number(),
    expertReviewFee: z.number(),
    groupLeaderFee: z.number(),
    professionalSubsidy: z.number(),
    expertCount: z.number(),
    managementAnnualFee: z.number(),
    basePrice: z.number(),
    taxFee: z.number(),
    businessManagementFee: z.number(),
    finalPrice: z.number(),
    totalAuditDays: z.number(),
    standardCount: z.number(),
    priceIncludes: z.array(z.string()),
    priceExcludes: z.array(z.string()),
    estimatedAuditDays: z.number(),
    generatedAt: z.string()
  })
});
