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

  if (textExtensions.has(extension)) return file.buffer.toString("utf8");
  if (extension === ".pdf") return (await pdf(file.buffer)).text;
  if (extension === ".docx") {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (extension === ".pptx") return extractPptx(file.buffer);

  throw new ValidationError(
    "暂不支持该文件类型，请上传 TXT、Markdown、CSV、JSON、PDF、DOCX 或 PPTX"
  );
}
