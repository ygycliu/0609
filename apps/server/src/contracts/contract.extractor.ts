/**
 * V2.2 合同管理 - 提取服务
 * 流程：PDF/DOC → OCR → 文本 → AI 结构化抽取
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { config } from "../config.js";

const UPLOAD_ROOT = path.join(config.uploadsDir, "contracts");
const SUPPORTED_EXTS = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB（与全局一致）

export interface ExtractedContract {
  // 基本信息
  甲方客户名: string | null;
  乙方主体: string | null;
  合同编号: string | null;
  合同类型: "main" | "supplement" | "change" | null;
  合同金额: number | null;
  // 日期
  签订日期: string | null;
  生效日期: string | null;
  到期日期: string | null;
  // 财务
  开户行: string | null;
  账号: string | null;
  户名: string | null;
  // 联系
  联系人: string | null;
  联系电话: string | null;
  // 业务
  认证体系: string[] | null;
  服务类型: string | null;
  原合同编号: string | null;
}

export interface ExtractionResult {
  text: string;
  extracted: ExtractedContract;
  confidence: number;
  errors: string[];
}

/**
 * 1. 文件类型分发
 */
export function getFileType(fileName: string): "pdf" | "doc" | "docx" | "image" | "unknown" {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc") return "doc";
  if (ext === ".docx") return "docx";
  if ([".png", ".jpg", ".jpeg"].includes(ext)) return "image";
  return "unknown";
}

/**
 * 2. 保存上传文件
 */
export async function saveUploadedFile(
  buffer: Buffer,
  originalName: string
): Promise<{ path: string; sha256: string; size: number }> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制`);
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(UPLOAD_ROOT, yearMonth);
  await fs.mkdir(dir, { recursive: true });

  // SHA256 去重
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileId = sha256.substring(0, 16);
  const ext = path.extname(originalName) || ".pdf";
  const fileName = `${fileId}${ext}`;
  const filePath = path.join(dir, fileName);

  // 检查是否已存在
  try {
    await fs.access(filePath);
    // 已存在，跳过写入
    return { path: filePath, sha256, size: buffer.length };
  } catch {
    await fs.writeFile(filePath, buffer);
    return { path: filePath, sha256, size: buffer.length };
  }
}

/**
 * 3. 提取文本（PDF / DOC / 图片 OCR）
 */
export async function extractText(
  filePath: string,
  fileType: "pdf" | "doc" | "docx" | "image"
): Promise<{ text: string; usedOcr: boolean; errors: string[] }> {
  const errors: string[] = [];
  let usedOcr = false;

  if (fileType === "pdf") {
    // 先试 pdftotext（文本版 PDF）
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    try {
      const r = await execFileAsync("pdftotext", ["-layout", filePath, "-"], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
      const text = r.stdout.trim();
      if (text.length > 50) {
        return { text, usedOcr: false, errors };
      }
      // 文本太短，可能是扫描版
    } catch (e: any) {
      errors.push(`pdftotext failed: ${e.message}`);
    }
    // fallback: OCR
    return await ocrPdf(filePath);
  }

  if (fileType === "doc") {
    // 旧版 .doc
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    try {
      const r = await execFileAsync("antiword", [filePath], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
      return { text: r.stdout.trim(), usedOcr: false, errors };
    } catch (e: any) {
      errors.push(`antiword failed: ${e.message}, try OCR`);
      return await ocrFile(filePath);
    }
  }

  if (fileType === "docx") {
    // 新版 .docx - 用 nodejs mammoth
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      const text = (result.value || "").trim();
      if (text.length > 50) return { text, usedOcr: false, errors };
      return await ocrFile(filePath);
    } catch (e: any) {
      errors.push(`mammoth failed: ${e.message}, try OCR`);
      return await ocrFile(filePath);
    }
  }

  if (fileType === "image") {
    return await ocrFile(filePath);
  }

  errors.push("未知文件类型");
  return { text: "", usedOcr: false, errors };
}

/**
 * OCR PDF（pdftoppm + tesseract）
 */
async function ocrPdf(filePath: string): Promise<{ text: string; usedOcr: boolean; errors: string[] }> {
  const errors: string[] = [];
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const tmpPrefix = `/tmp/contract_ocr_${Date.now()}`;
  try {
    // 转 PNG
    await execFileAsync("pdftoppm", ["-png", "-r", "200", filePath, tmpPrefix], { timeout: 60000 });
    // OCR
    const { readdir, unlink } = await import("node:fs/promises");
    const files = await readdir("/tmp");
    const pngs = files.filter(f => f.startsWith(path.basename(tmpPrefix)) && f.endsWith(".png")).sort();
    let text = "";
    for (const png of pngs) {
      const r = await execFileAsync("tesseract", [`/tmp/${png}`, "stdout", "-l", "chi_sim+eng", "--psm", "6"], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
      text += r.stdout + "\n";
      await unlink(`/tmp/${png}`).catch(() => {});
    }
    return { text: text.trim(), usedOcr: true, errors };
  } catch (e: any) {
    errors.push(`OCR failed: ${e.message}`);
    return { text: "", usedOcr: true, errors };
  }
}

async function ocrFile(filePath: string): Promise<{ text: string; usedOcr: boolean; errors: string[] }> {
  const errors: string[] = [];
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const r = await execFileAsync("tesseract", [filePath, "stdout", "-l", "chi_sim+eng", "--psm", "6"], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    return { text: r.stdout.trim(), usedOcr: true, errors };
  } catch (e: any) {
    errors.push(`OCR failed: ${e.message}`);
    return { text: "", usedOcr: true, errors };
  }
}

/**
 * 4. AI 结构化抽取（用本地 qwen2.5:7b）
 */
export async function extractContractFields(
  text: string,
  preferredModel: string = "ollama:qwen2.5:7b"
): Promise<{ extracted: ExtractedContract; confidence: number }> {
  const { generateWithModel } = await import("../models/model.gateway.js");

  const prompt = `你是一个合同信息抽取助手。请从以下合同文本中提取结构化字段。

合同文本：
"""
${text.slice(0, 8000)}
"""

按 JSON 格式输出（必须是合法 JSON）：
{
  "甲方客户名": "完整公司名（含'有限公司'等）",
  "乙方主体": "中认认证有限公司" 或 "中认认证有限公司宁夏分公司" 或 "华中国际认证检验集团有限公司" 或 "其他",
  "合同编号": "完整编号（如 FS/CA-SC24-342/1，多个用 | 分隔）",
  "合同类型": "main 主合同" / "supplement 补充协议" / "change 合同变更",
  "合同金额": 数字（元，无千分位，无单位）,
  "签订日期": "YYYY-MM-DD 或 null",
  "生效日期": "YYYY-MM-DD 或 null",
  "到期日期": "YYYY-MM-DD 或 null",
  "开户行": "完整银行名 或 null",
  "账号": "账号 或 null",
  "户名": "完整户名 或 null",
  "联系人": "联系人姓名 或 null",
  "联系电话": "11位手机号 或 null",
  "认证体系": ["QMS", "EMS", "OHSMS"]  // 从括号里勾选的
  "服务类型": "认证服务 或 null",
  "原合同编号": "如果是补充协议，引用主合同号 或 null"
}

注意：
- 找不到的字段填 null
- 数字金额是阿拉伯数字（如 15000.00）
- 日期用 YYYY-MM-DD 格式（如果只有 YYYY-MM 或 YYYY 也保留原样）
- 认证体系只在勾选时填
- 只输出 JSON，不要任何其他文字`;

  const result = await generateWithModel(preferredModel as any, {
    input: {
      role: "knowledge-assistant" as any,
      industry: "通用",
      companyContext: "合同信息抽取",
      request: prompt,
      deliverable: "结构化字段JSON",
      model: preferredModel as any
    },
    knowledge: []
  });

  // 解析 JSON
  let extracted: ExtractedContract = {
    甲方客户名: null,
    乙方主体: null,
    合同编号: null,
    合同类型: null,
    合同金额: null,
    签订日期: null,
    生效日期: null,
    到期日期: null,
    开户行: null,
    账号: null,
    户名: null,
    联系人: null,
    联系电话: null,
    认证体系: null,
    服务类型: null,
    原合同编号: null
  };
  let confidence = 0;

  try {
    // 尝试从结果中提取 JSON（可能含 markdown ```json``` 块）
    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) || result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      extracted = { ...extracted, ...parsed };
      // 计算置信度：非空字段比例
      const filled = Object.values(parsed).filter(v => v != null && v !== "").length;
      const total = Object.keys(parsed).length;
      confidence = filled / total;
    } else {
      console.warn("[contract-extract] AI response no JSON:", result.slice(0, 200));
    }
  } catch (e: any) {
    console.error("[contract-extract] JSON parse failed:", e.message);
    console.error("Raw:", result.slice(0, 300));
  }

  return { extracted, confidence };
}

/**
 * 5. 整体提取流程（上传 → 保存 → 文本 → AI）
 */
export async function extractFromFile(
  buffer: Buffer,
  originalName: string
): Promise<{
  file: { path: string; sha256: string; size: number; fileType: string };
  text: string;
  usedOcr: boolean;
  extracted: ExtractedContract;
  confidence: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // 1. 保存
  const fileType = getFileType(originalName);
  if (fileType === "unknown") {
    errors.push(`不支持的文件类型: ${path.extname(originalName)}`);
    throw new Error(errors.join("; "));
  }
  const saved = await saveUploadedFile(buffer, originalName);

  // 2. 提取文本
  const textResult = await extractText(saved.path, fileType);
  errors.push(...textResult.errors);

  // 3. AI 抽取
  let extracted: ExtractedContract = {
    甲方客户名: null, 乙方主体: null, 合同编号: null, 合同类型: null,
    合同金额: null, 签订日期: null, 生效日期: null, 到期日期: null,
    开户行: null, 账号: null, 户名: null, 联系人: null, 联系电话: null,
    认证体系: null, 服务类型: null, 原合同编号: null
  };
  let confidence = 0;
  if (textResult.text.length > 30) {
    try {
      const ai = await extractContractFields(textResult.text);
      extracted = ai.extracted;
      confidence = ai.confidence;
    } catch (e: any) {
      errors.push(`AI 抽取失败: ${e.message}`);
    }
  } else {
    errors.push("文本提取太短，跳过 AI 抽取");
  }

  return {
    file: { ...saved, fileType },
    text: textResult.text,
    usedOcr: textResult.usedOcr,
    extracted,
    confidence,
    errors
  };
}