import path from "node:path";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { ValidationError } from "../shared/errors.js";

const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".log"]);

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

  // V2.1：检查提取结果
  if (!text || text.length < 50) {
    throw new ValidationError(
      "文件中没有提取到可用文本。可能原因：1) 文件是扫描版 PDF（需要 OCR）；2) 文件被加密；3) 文件实际为空。请尝试重新导出为文字版 PDF。"
    );
  }

  return text;
}
