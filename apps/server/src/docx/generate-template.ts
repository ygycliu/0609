import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  enterpriseTemplateBranding,
  enterpriseTemplateRecord,
  generateConsultationDocx
} from "./docx-report.service.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../../");
const outputDir = path.join(projectRoot, "templates");
const outputPath = path.join(outputDir, "企业数字化建设方案模板.docx");

await fs.mkdir(outputDir, { recursive: true });
const buffer = await generateConsultationDocx(
  enterpriseTemplateRecord(),
  enterpriseTemplateBranding()
);
await fs.writeFile(outputPath, buffer);
console.log(outputPath);
