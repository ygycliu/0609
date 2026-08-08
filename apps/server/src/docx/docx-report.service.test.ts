import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  enterpriseTemplateBranding,
  enterpriseTemplateRecord,
  generateConsultationDocx
} from "./docx-report.service.js";

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
