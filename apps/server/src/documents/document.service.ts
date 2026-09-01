import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { ValidationError } from "../shared/errors.js";

const execFileAsync = promisify(execFile);

const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".log"]);

// V2.1：OCR 配置
const OCR_CONFIG = {
  enabled: process.env.OCR_ENABLED !== "false",
  lang: process.env.OCR_LANG || "chi_sim+eng",
  maxPages: Number(process.env.OCR_MAX_PAGES || 20),  // 防止巨大 PDF 超时
  timeoutPerPage: 30_000,
  dpi: Number(process.env.OCR_DPI || 150),
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractPptx(buffer: Buffer) {
  const archive = new AdmZip(buffer);
  return archive
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((left, right) => left.entryName.localeCompare(right.entryName))
    .flatMap((entry) =>
      [...entry.getData().toString("utf8").matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(
        (match) => decodeXml(match[1])
      )
    )
    .join("\n");
}

/**
 * V2.1：OCR 扫描版 PDF
 * 流程：PDF → PNG（pdftoppm）→ 文本（tesseract）
 */
async function ocrPdf(buffer: Buffer, fileName: string): Promise<string> {
  if (!OCR_CONFIG.enabled) {
    throw new ValidationError("OCR 功能未启用，无法处理扫描版 PDF");
  }

  const startTime = Date.now();
  const tmpDir = await fs.mkdtemp(path.join("/tmp", "ocr-"));
  const baseName = path.parse(fileName).name || "doc";
  const pdfPath = path.join(tmpDir, `${baseName}.pdf`);

  try {
    // 1. 写入临时 PDF
    await fs.writeFile(pdfPath, buffer);

    // 2. PDF → PNG（限制最大页数）
    await execFileAsync("pdftoppm", [
      "-png", "-r", String(OCR_CONFIG.dpi),
      "-f", "1", "-l", String(OCR_CONFIG.maxPages),
      pdfPath, path.join(tmpDir, "page")
    ], { timeout: 60_000 });

    // 3. 读取生成的 PNG（按页码排序）
    const pngFiles = (await fs.readdir(tmpDir))
      .filter((f) => /^page-\d+\.png$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
        return numA - numB;
      });

    if (pngFiles.length === 0) {
      throw new ValidationError("无法生成图片进行 OCR（可能 PDF 加密或损坏）");
    }

    // 4. OCR 每页
    const pageTexts: string[] = [];
    for (let i = 0; i < pngFiles.length; i++) {
      const pngPath = path.join(tmpDir, pngFiles[i]);
      try {
        const { stdout } = await execFileAsync(
          "tesseract",
          [pngPath, "stdout", "-l", OCR_CONFIG.lang, "--psm", "6"],
          { timeout: OCR_CONFIG.timeoutPerPage, maxBuffer: 10 * 1024 * 1024 }
        );
        const pageText = (stdout || "").trim();
        if (pageText) {
          pageTexts.push(`[第${i + 1}页]\n${pageText}`);
        }
      } catch (ocrErr) {
        console.warn(`[OCR] 失败 ${pngFiles[i]}:`, (ocrErr as Error).message);
        pageTexts.push(`[第${i + 1}页] OCR失败`);
      }
    }

    const fullText = pageTexts.join("\n\n");
    const elapsed = Date.now() - startTime;
    console.log(`[OCR] ${fileName}: ${pngFiles.length} 页, ${elapsed}ms`);

    return fullText;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractDocumentText(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();

  let text = "";

  if (textExtensions.has(extension)) {
    text = file.buffer.toString("utf8");
  } else if (extension === ".pdf") {
    const result = await pdf(file.buffer);
    text = result.text;
  } else if (extension === ".docx") {
    text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  } else if (extension === ".pptx") {
    text = extractPptx(file.buffer);
  } else {
    throw new ValidationError(
      "暂不支持该文件类型，请上传 TXT、Markdown、CSV、JSON、PDF、DOCX 或 PPTX"
    );
  }

  text = (text || "").trim();

  // V2.1：PDF 文本太少 → 可能是扫描版，触发 OCR fallback
  if (extension === ".pdf" && text.length < 50) {
    console.log(`[PDF] ${file.originalname}: 文本长度 ${text.length}，触发 OCR fallback`);
    text = await ocrPdf(file.buffer, file.originalname);
  }

  // 最终检查
  if (!text || text.length < 50) {
    throw new ValidationError(
      "文件中没有提取到可用文本。可能原因：1) 文件是扫描版 PDF（OCR 处理失败）；2) 文件被加密；3) 文件实际为空。"
    );
  }

  return text;
}

export const _test = { OCR_CONFIG };
