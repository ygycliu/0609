/**
 * V2.0 证书图片 OCR 服务
 *
 * 流程：
 * 1. 读取证书图片（支持本地路径 + base64）
 * 2. 使用 tesseract + chi_sim+eng 识别
 * 3. 解析关键字段（证书编号、资格、有效期等）
 * 4. 推断体系代码（QMS/EMS/OHSMS/FSMS）
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";

const execFileAsync = promisify(execFile);

export interface OcrResult {
  /** 原始 OCR 文本 */
  rawText: string;
  /** 识别的字段 */
  fields: {
    name?: string;
    idNumber?: string;
    certNo?: string;
    qualification?: string;
    organization?: string;
    validFrom?: string;
    validTo?: string;
    issuer?: string;
  };
  /** 推断的体系代码 */
  systems: string[];
  /** 推断的证书名称 */
  certName: string;
  /** 错误信息（如有）*/
  error?: string;
}

const SYSTEM_PATTERNS: Array<{ code: string; keywords: string[] }> = [
  { code: "QMS", keywords: ["QMS", "质量管理体系", "质量"] },
  { code: "EMS", keywords: ["EMS", "环境管理体系", "环境"] },
  { code: "OHSMS", keywords: ["OHSMS", "职业健康安全", "OHS"] },
  { code: "FSMS", keywords: ["FSMS", "食品安全", "FS"] },
  { code: "ISMS", keywords: ["ISMS", "信息安全", "ISO 27001"] },
  { code: "QMSEMS", keywords: ["QMS+EMS", "质量+环境"] }
];

/**
 * 解析 OCR 文本提取字段
 */
function parseFields(text: string): OcrResult["fields"] {
  const fields: OcrResult["fields"] = {};

  // 姓名（多种可能："姓名"、"持证人"）
  const nameMatch = text.match(/(?:姓名|持证人)[:：\s]*([\u4e00-\u9fa5]{2,5})/);
  if (nameMatch) fields.name = nameMatch[1].trim();

  // 身份证号
  const idMatch = text.match(/身份证号[:：\s]*(\d{17}[\dXx]|\d{15})/);
  if (idMatch) fields.idNumber = idMatch[1];

  // 注册证号（要更长 + 含 NO 或数字年份）
  const certNoMatch = text.match(/(?:注册证号|证书编号|证号)[:：\s]*((?:\d{4}-)?NO[A-Z0-9-]{6,30}|[A-Z]{0,3}\d{4,}-\d{4,}[A-Z0-9-]*|\d{8,})/i);
  if (certNoMatch) fields.certNo = certNoMatch[1].trim();

  // 注册资格 / 资格等级
  const qualMatch = text.match(/(?:注册资格|资格等级|资格)[:：\s]*(.{2,30}?)(?=\n|$|执业|有效)/m);
  if (qualMatch) {
    fields.qualification = qualMatch[1].trim()
      .replace(/[:：].*$/, "")  // 去掉行尾冒号
      .replace(/\s+/g, " ");
  }

  // 执业机构
  const orgMatch = text.match(/执业机构[:：\s]*(.{2,40}?)(?=\n|$|有效)/m);
  if (orgMatch) fields.organization = orgMatch[1].trim();

  // 有效日期
  const validMatch = text.match(/有效日期[:：\s]*(\d{4}[-./]\d{1,2}[-./]\d{1,2})\s*至\s*(\d{4}[-./]\d{1,2}[-./]\d{1,2})/);
  if (validMatch) {
    fields.validFrom = validMatch[1].replace(/[./]/g, "-");
    fields.validTo = validMatch[2].replace(/[./]/g, "-");
  }

  // 颁发机构
  if (text.includes("中国认证认可协会") || text.includes("CCAA")) {
    fields.issuer = "中国认证认可协会 (CCAA)";
  } else if (text.includes("CNAS")) {
    fields.issuer = "中国合格评定国家认可委员会 (CNAS)";
  } else if (text.includes("IAF")) {
    fields.issuer = "国际认可论坛 (IAF)";
  }

  return fields;
}

/**
 * 推断体系代码
 */
function inferSystems(text: string, fileName?: string): string[] {
  const systems = new Set<string>();

  // 1. 从文本中匹配
  for (const sys of SYSTEM_PATTERNS) {
    for (const kw of sys.keywords) {
      if (text.includes(kw)) {
        systems.add(sys.code);
        break;
      }
    }
  }

  // 2. 从文件名推断（Q/E/S/F）
  if (fileName) {
    const m = fileName.match(/[._-]([A-Z])\.(png|jpg|jpeg|pdf)$/i);
    if (m) {
      const codeMap: Record<string, string> = { E: "EMS", Q: "QMS", S: "OHSMS", F: "FSMS" };
      const c = codeMap[m[1].toUpperCase()];
      if (c) systems.add(c);
    }
  }

  return Array.from(systems);
}

/**
 * 推断证书名称
 */
function inferCertName(systems: string[], fields: OcrResult["fields"]): string {
  const sys = systems[0] || "CUSTOM";
  const nameMap: Record<string, string> = {
    QMS: "质量管理体系认证审核员",
    EMS: "环境管理体系认证审核员",
    OHSMS: "职业健康安全管理体系认证审核员",
    FSMS: "食品安全管理体系认证审核员",
    ISMS: "信息安全管理体系认证审核员"
  };
  if (fields.qualification) {
    return `${nameMap[sys] || "管理体系认证审核员"}（${fields.qualification}）`;
  }
  return nameMap[sys] || "管理体系认证审核员证书";
}

/**
 * 主入口：OCR 证书图片
 */
export async function ocrCertificate(input: {
  filePath?: string;
  fileBase64?: string;
  fileName?: string;
}): Promise<OcrResult> {
  let workFile = input.filePath;

  // 如果是 base64，先写临时文件
  if (input.fileBase64 && !workFile) {
    const tmpPath = `/tmp/ocr_${Date.now()}.png`;
    require("fs").writeFileSync(tmpPath, Buffer.from(input.fileBase64, "base64"));
    workFile = tmpPath;
  }

  if (!workFile || !existsSync(workFile)) {
    return {
      rawText: "",
      fields: {},
      systems: [],
      certName: "",
      error: `文件不存在：${workFile}`
    };
  }

  try {
    // Tesseract OCR（中英文混合）
    const { stdout } = await execFileAsync("tesseract", [workFile, "stdout", "-l", "chi_sim+eng", "--psm", "6"], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    });

    const text = stdout.trim();
    const fields = parseFields(text);
    const systems = inferSystems(text, input.fileName);
    const certName = inferCertName(systems, fields);

    return {
      rawText: text,
      fields,
      systems,
      certName
    };
  } catch (e: any) {
    return {
      rawText: "",
      fields: {},
      systems: [],
      certName: "",
      error: e?.message || "OCR 失败"
    };
  }
}
