import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  enterpriseTemplateBranding,
  enterpriseTemplateRecord,
  generateConsultationDocx,
  generateQuoteDocx
} from "./docx-report.service.js";
import { generateQuote } from "../certification/quote.service.js";
import { quoteExportPayloadSchema } from "../app.js";

describe("generateConsultationDocx", () => {
  it("生成包含正文、样式、页眉和页脚的原生 Open XML 文档", async () => {
    const buffer = await generateConsultationDocx(
      enterpriseTemplateRecord(),
      enterpriseTemplateBranding()
    );
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const archive = new AdmZip(buffer);
    const entries = new Set(archive.getEntries().map((entry) => entry.entryName));
    expect(entries).toContain("[Content_Types].xml");
    expect(entries).toContain("word/document.xml");
    expect(entries).toContain("word/styles.xml");
    expect([...entries].some((entry) => entry.startsWith("word/header"))).toBe(true);
    expect([...entries].some((entry) => entry.startsWith("word/footer"))).toBe(true);

    const documentXml = archive.readAsText("word/document.xml");
    const stylesXml = archive.readAsText("word/styles.xml");
    expect(documentXml).toContain("企业数字化建设方案");
    expect(documentXml).toContain("现状诊断");
    expect(stylesXml).toContain('w:styleId="Heading1"');
    expect(stylesXml).toContain('w:outlineLvl w:val="0"');
  });
});

describe("generateQuoteDocx", () => {
  it("接受真实报价结果并保留认证明细生成原生DOCX", async () => {
    const quote = await generateQuote({
      companyName: "P0验收企业",
      industry: "制造业",
      employeeCount: 120,
      certifications: ["QES"],
      riskLevel: "medium"
    });
    const payload = quoteExportPayloadSchema.parse({
      companyName: "中认认证宁夏分公司",
      quote
    });

    const buffer = await generateQuoteDocx(payload.quote, {
      ...enterpriseTemplateBranding(),
      companyName: payload.companyName,
      clientName: payload.quote.companyName,
      documentTitle: "认证证书报价单",
      includeToc: false,
      includeReferences: false
    });

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const archive = new AdmZip(buffer);
    const documentXml = archive.readAsText("word/document.xml");
    expect(documentXml).toContain("ISO 9001+14001+45001 三体系");
    expect(documentXml).toContain(
      quote.certifications[0]!.adjustedBase.toLocaleString("en-US")
    );
  });
});
