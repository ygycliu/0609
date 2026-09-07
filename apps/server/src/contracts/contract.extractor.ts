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
    // 旧版 .doc: 先 antiword，失败 → libreoffice 转 PDF → OCR
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    try {
      const r = await execFileAsync("antiword", [filePath], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
      const text = r.stdout.trim();
      if (text.length > 50) return { text, usedOcr: false, errors };
      errors.push(`antiword returned only ${text.length} chars, try libreoffice`);
    } catch (e: any) {
      errors.push(`antiword failed: ${e.message}, try libreoffice`);
    }
    // V2.3.7 Bug #1: .doc antiword 失败/空白时，先用 libreoffice 转 PDF 再 OCR
    // 原因：tesseract 不能直接处理 .doc 二进制
    try {
      const convertedPdf = await convertDocToPdf(filePath);
      if (convertedPdf) {
        const ocrResult = await ocrPdf(convertedPdf);
        // 清理临时 PDF
        const { unlink } = await import("node:fs/promises");
        await unlink(convertedPdf).catch(() => {});
        return ocrResult;
      }
    } catch (e: any) {
      errors.push(`libreoffice conversion failed: ${e.message}, fallback to direct OCR`);
    }
    // 最后兜底：直接 OCR（基本会失败，但保留链路）
    return await ocrFile(filePath);
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
 * V2.3.7 Bug #1: 用 libreoffice 把 .doc/.docx 转 .pdf
 * 用途：当 antiword/mammoth 失败或返回文本太短时，绕过直接 OCR 二进制的死路
 * @returns 生成的 PDF 路径，失败返回 null
 */
async function convertDocToPdf(filePath: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp } = await import("node:fs/promises");
  const path = await import("node:path");
  const execFileAsync = promisify(execFile);
  const tmpDir = await mkdtemp("/tmp/contract_doc2pdf_");
  try {
    // --headless --convert-to pdf --outdir <dir> <file>
    await execFileAsync("libreoffice", [
      "--headless", "--convert-to", "pdf", "--outdir", tmpDir, filePath
    ], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tmpDir);
    const pdfFile = files.find(f => f.toLowerCase().endsWith(".pdf"));
    if (pdfFile) return path.join(tmpDir, pdfFile);
    return null;
  } catch (e: any) {
    console.warn("[convertDocToPdf] libreoffice failed:", e.message);
    return null;
  }
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
 * V2.3 AI 结构化抽取（用云端 MiniMax-M3）
 */
export async function extractContractFields(
  text: string,
  preferredModel: string = "openai"
): Promise<{ extracted: ExtractedContract; confidence: number }> {
  const { generateWithModel } = await import("../models/model.gateway.js");

  // V2.3.7 Bug #2: 合同金额/签字栏经常在末页，之前 slice(0,16000) 截掉
  // 改为"前 14K + 末 4K"策略：保留开头上下文 + 末页签字栏和金额
  const HEAD_CHARS = 14000;
  const TAIL_CHARS = 4000;
  const truncatedText = text.length > HEAD_CHARS + TAIL_CHARS
    ? text.slice(0, HEAD_CHARS) + "\n\n[...省略中间内容，重点关注末页签字栏与合同金额...]\n\n" + text.slice(-TAIL_CHARS)
    : text;

  const prompt = `你是一个认证服务行业的合同信息抽取助手。

合同全文：
"""
${truncatedText}
"""

请严格按 JSON 格式输出（必须是合法 JSON，禁止任何其他文字）：

{
  "甲方客户名": "完整公司名（含'有限公司'等）",
  "乙方主体": "中认认证有限公司" / "中认认证有限公司宁夏分公司" / "华中国际认证检验集团有限公司" / "银川博文荣达咨询服务有限公司" / "其他",
  "合同编号": "如 FS/CA-SC24-342/1、HT-2024-001、2026-008 等，多个用 | 分隔",
  "合同类型": "main" / "supplement" / "change" / null,
  "合同金额": 数字（元，无千分位，无单位）,
  "签订日期": "YYYY-MM-DD 或 null",
  "生效日期": "YYYY-MM-DD 或 null",
  "到期日期": "YYYY-MM-DD 或 null",
  "开户行": "完整银行名 或 null",
  "账号": "账号 或 null",
  "户名": "完整户名 或 null",
  "联系人": "联系人姓名 或 null",
  "联系电话": "11位手机号 或 null",
  "认证体系": ["QMS","EMS","OHSMS"] 或 [],
  "服务类型": "认证服务" / "咨询" / "培训" / null,
  "原合同编号": "补充协议引用主合同号 或 null"
}

强规则（必须遵守）：
1. **找不到的字段填 null**，绝不要瞎猜
2. **日期严格 YYYY-MM-DD**：不完整日期（如 2024-05）填 null，绝不要带 -MM 截断
3. **金额纯数字**：15000.00 不要 15,000 或 1.5万；金额单位一般是人民币元
4. **合同编号在第一页右上/左上角**、也可能在末页签字栏
5. **联系人/电话在最后一页"经办人/委托代理人/联系人"栏**
6. **认证体系勾选才填**：质量管理体系=QMS，环境=EMS，职业健康=OHSMS
7. **只输出 JSON**，禁止 3反引号 + json + 3反引号 标记，禁止解释文字
8. V2.3.7 Bug #2: 重点扫描末页"合同金额/合同总价款/含税金额/人民币大写"等字段——金额经常出现在末页签字栏附近，不是首页`;

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