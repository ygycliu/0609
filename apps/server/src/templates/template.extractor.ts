/**
 * V2.3 合同模板引擎 - 逆向抽取器
 * 从已交付的合同 DOCX 抽取：
 *   1. 字段定义（与 contract_field_dictionary 对应）
 *   2. 章节结构（识别 N 章 + 内容类型 + 变量）
 *   3. 模板类型（HZCX / ZRC / EXTERNAL）
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { generateWithModel } from "../models/model.gateway.js";

export interface ExtractedChapter {
  chapter_number: string;
  title: string;
  content_type: "fillable" | "static" | "mixed";
  variables: string[];
  static_text?: string;
  checkbox_section?: boolean;
  checkbox_options?: string[];
}

export interface ExtractedSchema {
  contract_type: "HZCX" | "ZRC" | "EXTERNAL" | "OTHER";
  chapter_count: number;
  chapters: ExtractedChapter[];
  field_mapping: Record<string, {
    field_code: string;
    found_in_text: boolean;
    example_value?: string;
    location?: string;
  }>;
  confidence: number;
}

/**
 * 1. 解析 DOCX（用 mammoth）
 */
async function extractDocxText(filePath: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(execFile);

  // 先试 mammoth (Node)
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.value && result.value.length > 100) return result.value;
  } catch (e) { /* fallback */ }

  // fallback antiword
  try {
    const r = await execAsync("antiword", [filePath], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    if (r.stdout && r.stdout.length > 100) return r.stdout;
  } catch (e) { /* fallback */ }

  // fallback 直接读 zip + 简单 XML 解析
  try {
    const buffer = await fs.readFile(filePath);
    // 简单找文档XML
    const xmlMatch = buffer.toString("binary").match(/document\.xml/);
    if (xmlMatch) {
      const mammoth2 = await import("mammoth");
      const result = await mammoth2.extractRawText({ path: filePath });
      return result.value;
    }
  } catch (e) { /* noop */ }

  return "";
}

/**
 * 2. AI 抽取章节 + 字段
 */
export async function extractSchemaFromDocx(filePath: string): Promise<{
  text: string;
  schema: ExtractedSchema;
}> {
  const text = await extractDocxText(filePath);
  if (text.length < 100) {
    return { text, schema: { contract_type: "OTHER", chapter_count: 0, chapters: [], field_mapping: {}, confidence: 0 } };
  }

  const prompt = `你是一个合同结构识别助手。请从以下合同文本中识别章节结构和字段定义。

合同文本：
"""
${text.slice(0, 12000)}
"""

按 JSON 格式输出（必须是合法 JSON）：
{
  "contract_type": "HZCX | ZRC | EXTERNAL | OTHER",
  "chapter_count": 数字,
  "chapters": [
    {
      "chapter_number": "一"或"1"等,
      "title": "章节标题",
      "content_type": "fillable | static | mixed",
      "variables": ["customer_name", ...],
      "static_text": "（如果是static章节，写部分文本；否则省略）",
      "checkbox_section": true | false,
      "checkbox_options": ["QMS","EMS"]  // 如果是 checkbox
    }
  ],
  "field_mapping": {
    "customer_name": { "found_in_text": true, "example_value": "...", "location": "第一节..." },
    "first_audit_fee": { "found_in_text": true, "example_value": "8000", "location": "费用章节" },
    ...
  },
  "confidence": 0.85
}

注意：
- contract_type：根据乙方主体判断（华中集团=HZCX，中认认证=ZRC，其他=EXTERNAL）
- 章节按文档实际章节识别（一/二/三或1/2/3）
- variables 字段填 field_code（camelCase）
- 只输出 JSON`;

  const result = await generateWithModel("ollama:qwen2.5:7b" as any, {
    input: {
      role: "knowledge-assistant" as any,
      industry: "通用",
      companyContext: "合同结构识别",
      request: prompt,
      deliverable: "JSON schema",
      model: "ollama:qwen2.5:7b" as any
    },
    knowledge: []
  });

  let schema: ExtractedSchema = {
    contract_type: "OTHER",
    chapter_count: 0,
    chapters: [],
    field_mapping: {},
    confidence: 0
  };

  try {
    // 尝试从结果中提取 JSON（可能含 markdown ```json``` 块）
    let jsonStr: string | null = null;
    const mdMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
    if (mdMatch) {
      jsonStr = mdMatch[1];
    } else {
      // 尝试找最外层的 { } 块
      const braceMatch = result.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
    }
    if (jsonStr) {
      // 修复常见 JSON 错误：尾部逗号
      jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");
      const parsed = JSON.parse(jsonStr);
      schema = { ...schema, ...parsed };
    } else {
      console.warn("[extract-schema] AI response no JSON:", result.slice(0, 200));
    }
  } catch (e) {
    console.error("[extract-schema] parse failed:", e);
    console.error("RawRaw:", result.slice(0, 500));
  }

  return { text, schema };
}

/**
 * 3. 一键入库：上传 + 抽取 + 入库
 */
export async function uploadAndExtractTemplate(
  filePath: string,
  meta: {
    code: string;
    name: string;
    signingEntityId: string;
    templateCategory: string;
    contractType: string;
    description?: string;
    createdBy?: string;
  }
): Promise<{
  templateId: string;
  text: string;
  schema: ExtractedSchema;
}> {
  // 1. 抽取
  const { text, schema } = await extractSchemaFromDocx(filePath);

  // 2. 返回抽取结果，由 caller 调 repository.create
  return {
    templateId: "", // caller 填
    text,
    schema
  };
}