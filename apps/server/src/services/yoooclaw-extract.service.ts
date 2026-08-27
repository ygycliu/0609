/**
 * YoooClaw 录音智能提取服务
 *
 * 链路：录音文件 → ASR 转写 → LLM 提取（todos / follow_ups / knowledge）
 *
 * 设计原则：
 * - 直接 fetch 调用 OpenAI 兼容 API（避免额外依赖）
 * - 失败时回退，不阻塞主流程
 * - LLM 一次性输出三类结构化数据
 */

import { query } from "../db/pool.js";

// 自动检测可用模型端点（优先 8000 → 11434 → 任何可用）
async function findOpenAIEndpoint(): Promise<string> {
  const candidates = [
    process.env.OPENAI_BASE_URL,
    "http://127.0.0.1:8000",
    "http://127.0.0.1:11434",
    "http://localhost:11434"
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const baseClean = base.endsWith("/v1") ? base : base;
    // 测一个轻量请求（不用 /models 因为 ollama 不一定有）
    try {
      const res = await fetch(`${baseClean}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      });
      if (res.ok || res.status === 400) {  // 400 = 模型名错但 endpoint 工作
        return baseClean.endsWith("/v1") ? baseClean : `${baseClean}/v1`;
      }
    } catch {}
  }
  return (process.env.OPENAI_BASE_URL || "http://127.0.0.1:8000") + (process.env.OPENAI_BASE_URL?.endsWith("/v1") ? "" : "/v1");
}

const OPENAI_MODEL = process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || "qwen2.5:7b";
const EFFECTIVE_BASE = process.env.OPENAI_BASE_URL || "";  // 用于调试日志

console.log(`[yoooclaw-extract] init: model=${OPENAI_MODEL} envBase=${EFFECTIVE_BASE}`);

const SYSTEM_PROMPT = `你是认证咨询公司（华中国际认证）的销售助理。
你的任务：从录音转写文本中，自动提取业务要素。

**输出 JSON Schema**（严格遵守，不要有任何额外字段）：
{
  "todos": [
    {
      "title": "简洁明确（动词开头，不超过 25 字）",
      "description": "补充说明（基于原文，不杜撰）",
      "dueAt": "ISO 8601 日期（从原文提取"下周/周三"等相对时间） 或 null",
      "priority": "high | medium | low",
      "category": "general | follow_up | sales | delivery | certificate | payment",
      "customerName": "客户名称 或 null"
    }
  ],
  "followUps": [
    {
      "customerName": "客户全名（必填）",
      "stage": "expired | quoted | contract_review | contract_signed | implementing | certified",
      "year": 2026,
      "expectedDate": "ISO 日期 或 null",
      "contractAmount": 数字 或 null,
      "certificationType": "ISO9001 | ISO14001 | ISO45001 | HACCP 或 null",
      "issuingBody": "zhongren | huazhong | other",
      "summary": "1-2 句总结"
    }
  ],
  "knowledge": "1-2 句话总结（如有特别政策/标准/技术细节）"
}

**提取原则**：
1. 只提取录音中**明确提到**的事项，不要推测
2. todo 应该是**需要做的事**，而不是已经发生的事
3. 客户名严格匹配原文中提到的写法
4. 金额数字保留原文
5. 没有相应内容时返回空数组`;

export interface ExtractedTodo {
  title: string;
  description?: string;
  dueAt?: string | null;
  priority?: "high" | "medium" | "low";
  category?: string;
  customerName?: string | null;
}

export interface ExtractedFollowUp {
  customerName: string;
  customerPhone?: string;
  stage?: string;
  year?: number;
  expectedDate?: string | null;
  contractAmount?: number | null;
  certificationType?: string | null;
  issuingBody?: string;
  summary?: string;
}

export interface ExtractionResult {
  todos: ExtractedTodo[];
  followUps: ExtractedFollowUp[];
  knowledge: string;
}

/**
 * 直接 fetch 调用 OpenAI 兼容 API（动态发现 endpoint）
 */
async function callLLM(prompt: string): Promise<string> {
  const endpoint = await findOpenAIEndpoint();
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (process.env.OPENAI_API_KEY || "ollama")
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "你是 JSON 输出专家。只输出合法 JSON。" },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} - ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

/**
 * 从转写文本提取结构化数据
 */
export async function extractFromTranscript(
  transcript: string,
  recordingName?: string
): Promise<ExtractionResult> {
  let truncated = transcript;
  if (transcript.length > 12000) {
    truncated = transcript.slice(0, 8000) + "\n\n[...中间省略...]\n\n" + transcript.slice(-2000);
  }

  const prompt = `${SYSTEM_PROMPT}\n\n录音标题：${recordingName || "(未命名)"}\n\n录音转写：\n"""\n${truncated}\n"""`;

  try {
    const content = await callLLM(prompt);
    const parsed = JSON.parse(content);
    return {
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      knowledge: typeof parsed.knowledge === "string" ? parsed.knowledge : ""
    };
  } catch (e: any) {
    console.warn(`[yoooclaw-extract] LLM 调用失败：${e.message}`);
    return { todos: [], followUps: [], knowledge: "" };
  }
}

/**
 * 把提取的 todos 持久化到 todo 表
 */
export async function persistTodos(
  companyId: string,
  userId: string,
  recordingId: string,
  todos: ExtractedTodo[],
  recordingName?: string
): Promise<Array<{ id: string; title: string }>> {
  const created: Array<{ id: string; title: string }> = [];

  for (const t of todos) {
    if (!t.title) continue;

    let customerId: string | null = null;
    if (t.customerName && t.customerName.trim()) {
      const c = await query<{ id: string }>(
        "SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1",
        [companyId, t.customerName.trim()]
      );
      if (c.rows.length > 0) customerId = c.rows[0].id;
    }

    let dueAt: string | null = t.dueAt || null;
    if (!dueAt) {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      dueAt = d.toISOString();
    }

    const title = t.title.length > 200 ? t.title.slice(0, 197) + "..." : t.title;

    const id = (await query<{ id: string }>("SELECT uuid_generate_v4() AS id")).rows[0].id;
    await query(
      `INSERT INTO todo
        (id, company_id, owner_user_id, assigned_to, title, description, category,
         source, source_ref, recording_id, due_at, status, priority, customer_id, tags, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 'yoooclaw_recording',
               $8, $9, $10::timestamptz, 'pending', $11, $12::uuid,
               to_jsonb(string_to_array($13, ',')),
               $14::jsonb)`,
      [
        id, companyId, userId, userId, title,
        t.description ? `[录音] ${t.description}` : `[自动提取自录音 ${recordingName || recordingId.slice(0, 8)}]`,
        t.category || "follow_up",
        recordingId,  // source_ref
        recordingId,  // recording_id
        dueAt,
        t.priority || "normal",
        customerId,
        // tags: 用 PostgreSQL 数组字面量 {a,b,c}，PG 会自动转 jsonb
        `{yoooclaw,auto_extracted,${recordingId.replace(/[,{}]/g, '_')}}`,
        JSON.stringify({
          source: "yoooclaw_recording",
          recordingId,
          recordingName,
          extractedAt: new Date().toISOString(),
          priority: t.priority,
          customerName: t.customerName
        }) as any
      ]
    );
    created.push({ id, title });
  }

  return created;
}

/**
 * 主入口：完整流程（转写文本 → 提取 → 持久化 todo / follow_up / knowledge）
 */
export async function processRecordingEndToEnd(params: {
  companyId: string;
  userId: string;
  recordingId: string;
  recordingName: string;
  transcript: string;
  durationSec?: number | null;
}): Promise<{
  todos: Array<{ id: string; title: string }>;
  followUps: Array<{ id: string; customer: string }>;
  knowledge: string;
  extractionFailed?: boolean;
}> {
  const { companyId, userId, recordingId, recordingName, transcript } = params;

  // 检查重复
  const exists = await query<{ id: string }>(
    "SELECT id FROM yoooclaw_recording_import WHERE company_id = $1 AND recording_id = $2 AND status = 'processed'",
    [companyId, recordingId]
  );
  if (exists.rows.length > 0) {
    return {
      todos: [],
      followUps: [],
      knowledge: "已处理过",
      extractionFailed: false
    };
  }

  // 1. LLM 提取
  const extracted = await extractFromTranscript(transcript, recordingName);
  const extractionFailed = extracted.todos.length === 0 && extracted.followUps.length === 0 && !extracted.knowledge;

  // 2. 持久化 todo
  const createdTodos = await persistTodos(companyId, userId, recordingId, extracted.todos, recordingName);

  // 3. 持久化 follow_up
  const createdFollowUps: Array<{ id: string; customer: string }> = [];
  for (const f of extracted.followUps) {
    if (!f.customerName) continue;
    let customerId: string | null = null;
    const c = await query<{ id: string }>(
      "SELECT id FROM customer WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1",
      [companyId, f.customerName.trim()]
    );
    if (c.rows.length > 0) customerId = c.rows[0].id;
    else {
      const newId = (await query<{ id: string }>("SELECT uuid_generate_v4() AS id")).rows[0].id;
      const codeRes = await query<{ max_code: number }>(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 2) AS INTEGER)), 0) AS max_code FROM customer WHERE company_id = $1 AND customer_code ~ '^C[0-9]+$'",
        [companyId]
      );
      const newCode = `C${String((codeRes.rows[0].max_code || 0) + 1).padStart(5, "0")}`;
      await query(
        `INSERT INTO customer (id, company_id, customer_code, name, region, status, service_stage, contact_phone, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '宁夏', 'active', 'potential', $5, $6, NOW(), NOW())`,
        [newId, companyId, newCode, f.customerName, f.customerPhone || null,
         `从录音自动提取 ${recordingId}: ${f.summary || ""}`]
      );
      customerId = newId;
    }

    const year = f.year || new Date().getFullYear();
    const existing = await query<{ id: string }>(
      `SELECT id FROM customer_follow_up
       WHERE company_id = $1 AND customer_id = $2
         AND year = $3 AND certification_type IS NOT DISTINCT FROM $4
         AND issuing_body = $5 AND deleted_at IS NULL LIMIT 1`,
      [companyId, customerId, year, f.certificationType || null, f.issuingBody || "zhongren"]
    );
    let fuId: string;
    if (existing.rows.length > 0) {
      fuId = existing.rows[0].id;
      await query(
        `UPDATE customer_follow_up
         SET notes = COALESCE(notes || ' / ', '') || $1,
             expected_date = COALESCE($2::date, expected_date),
             contract_amount = COALESCE($3::numeric, contract_amount),
             updated_at = NOW()
         WHERE id = $4`,
        [`[录音提取] ${f.summary || ""}`, f.expectedDate || null, f.contractAmount ?? null, fuId]
      );
    } else {
      const fuRes = await query<{ id: string }>(
        `INSERT INTO customer_follow_up
          (id, company_id, customer_id, certification_type, issuing_body,
           stage, year, expected_date, contract_amount, notes, created_at, updated_at)
         VALUES (uuid_generate_v4(), $1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::numeric, $9, NOW(), NOW())
         RETURNING id`,
        [companyId, customerId, f.certificationType || null, f.issuingBody || "zhongren",
         f.stage || "expired", year, f.expectedDate || null, f.contractAmount ?? null,
         `[录音自动提取 ${recordingId}]: ${f.summary || ""}`]
      );
      fuId = fuRes.rows[0].id;
    }
    createdFollowUps.push({ id: fuId, customer: f.customerName });
  }

  // 4. 写入知识库
  if (extracted.knowledge && extracted.knowledge.length > 5) {
    const knowledgeTitle = `录音提取: ${recordingName} (${recordingId.slice(0, 8)})`;
    try {
      const codeRes = await query<{ max_code: number }>(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(doc_code FROM 4) AS INTEGER)), 0) AS max_code FROM knowledge_document WHERE doc_code LIKE 'KN-%'"
      );
      const code = `KN-${String((codeRes.rows[0].max_code || 0) + 1).padStart(5, "0")}`;
      const kId = (await query<{ id: string }>("SELECT uuid_generate_v4() AS id")).rows[0].id;
      await query(
        `INSERT INTO knowledge_document
          (id, company_id, doc_code, title, category, subcategory, file_path, file_type, file_size,
           content_text, confidentiality, business_value, source, status, current_version, tags, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'yoooclaw_recording', $5, $6, 'md', $7,
                 $8, 'internal', 'medium', 'yoooclaw', 'active', 1, $9, NOW(), NOW())
         ON CONFLICT (company_id, doc_code) DO UPDATE SET
           content_text = EXCLUDED.content_text,
           title = EXCLUDED.title,
           updated_at = NOW(),
           deleted_at = NULL`,
        [
          kId, companyId, code, knowledgeTitle, recordingName,
          `yoooclaw://${recordingId}`, extracted.knowledge.length,
          extracted.knowledge.slice(0, 5000),
          ["yoooclaw", "auto_extracted", recordingId]
        ]
      );
    } catch (e: any) {
      console.warn("[yoooclaw-extract] knowledge 写入失败", e.message);
    }
  }

  // 5. 记录导入历史
  try {
    await query(
      `INSERT INTO yoooclaw_recording_import
        (company_id, recording_id, recording_name, transcript, summary, duration_sec, routes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processed')
       ON CONFLICT (company_id, recording_id) DO UPDATE SET
         routes = EXCLUDED.routes,
         status = 'processed',
         imported_at = NOW()`,
      [
        companyId, recordingId, recordingName, transcript, extracted.knowledge,
        params.durationSec || null,
        JSON.stringify({
          todos: createdTodos,
          follow_ups: createdFollowUps,
          knowledge: extracted.knowledge ? "saved" : "empty"
        })
      ]
    );
  } catch (e: any) {
    console.warn("[yoooclaw-extract] yoooclaw_recording_import 写入失败", e.message);
  }

  return {
    todos: createdTodos,
    followUps: createdFollowUps,
    knowledge: extracted.knowledge,
    extractionFailed
  };
}