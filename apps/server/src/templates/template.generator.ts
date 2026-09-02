/**
 * V2.3 合同生成器
 * 使用 docxtemplater 渲染 DOCX，LibreOffice 转 PDF
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const execAsync = promisify(execFile);

/**
 * 用 docxtemplater 渲染 DOCX 模板
 */
export async function renderDocx(templatePath: string, fieldValues: Record<string, any>): Promise<Buffer> {
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ""
  });

  // 字段值预处理
  const safeValues: Record<string, any> = {};
  for (const [k, v] of Object.entries(fieldValues)) {
    if (Array.isArray(v)) {
      // 数组转字符串
      safeValues[k] = v.join("、");
    } else if (typeof v === "number") {
      safeValues[k] = v.toString();
    } else if (v == null) {
      safeValues[k] = "";
    } else {
      safeValues[k] = v;
    }
  }

  doc.render(safeValues);

  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}

/**
 * 用 LibreOffice 把 DOCX 转 PDF
 */
export async function convertToPdf(docxPath: string, outputDir: string): Promise<string> {
  // soffice --headless --convert-to pdf --outdir <outputDir> <docxPath>
  await execAsync("soffice", [
    "--headless",
    "--convert-to", "pdf",
    "--outdir", outputDir,
    docxPath
  ], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

  const pdfName = path.basename(docxPath).replace(/\.docx?$/i, ".pdf");
  return path.join(outputDir, pdfName);
}

/**
 * 完整生成流程：渲染 DOCX → 转 PDF → 存盘
 */
export async function generateContract(
  templatePath: string,
  fieldValues: Record<string, any>,
  options: {
    outputDir: string;
    outputBaseName: string;
  }
): Promise<{
  docxPath: string;
  pdfPath: string | null;
  fileSize: number;
  generationTimeMs: number;
}> {
  const startTime = Date.now();

  // 1. 渲染 DOCX
  const docxBuffer = await renderDocx(templatePath, fieldValues);

  // 2. 保存 DOCX
  const docxPath = path.join(options.outputDir, `${options.outputBaseName}.docx`);
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.writeFile(docxPath, docxBuffer);

  // 3. 转 PDF
  let pdfPath: string | null = null;
  try {
    pdfPath = await convertToPdf(docxPath, options.outputDir);
  } catch (e: any) {
    console.warn(`[generate] PDF conversion failed: ${e.message}`);
  }

  // 4. 获取文件大小
  const stat = await fs.stat(pdfPath || docxPath);

  return {
    docxPath,
    pdfPath,
    fileSize: stat.size,
    generationTimeMs: Date.now() - startTime
  };
}