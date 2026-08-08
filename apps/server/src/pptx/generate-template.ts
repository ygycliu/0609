import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateConsultationPptx,
  presentationTemplateBranding,
  presentationTemplateRecord
} from "./pptx-presentation.service.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../../");
const outputDir = path.join(projectRoot, "templates");
const outputPath = path.join(outputDir, "数字化建设方案演示模板.pptx");

await fs.mkdir(outputDir, { recursive: true });
const buffer = await generateConsultationPptx(
  presentationTemplateRecord(),
  presentationTemplateBranding()
);
await fs.writeFile(outputPath, buffer);
console.log(outputPath);
