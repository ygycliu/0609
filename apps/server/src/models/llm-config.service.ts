/**
 * AI 中心大模型配置 Service（V2.3.3）
 *
 * 单条全局默认配置 + API key AES-256-GCM 加密存储
 * 业务规则：
 *   - 单条记录（id=1）
 *   - 启用后，所有 AI 调用点统一读这份配置
 *   - 未启用或缺失时回退到 .env 默认值
 *   - 每次变更写入 app_llm_config_log 审计
 */

import { query, withTransaction } from "../db/pool.js";
import { encryptApiKey, decryptApiKey } from "./llm-crypto.js";
import type { ModelProvider } from "../shared/types.js";

export interface LlmConfigRow {
  id: number;
  provider: string;
  model_name: string;
  base_url: string;
  api_key_enc: string;        // 仅内部用
  api_key_iv: string;
  api_key_tag: string;
  num_ctx: number;
  temperature: number;
  timeout_ms: number;
  max_tokens: number;
  is_enabled: boolean;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 给前端的安全版本（不含任何密文，api_key 以掩码展示） */
export interface LlmConfigPublic {
  source: "db" | "env";    // "db" = 数据库配置；"env" = .env 回退
  provider: string;
  model_name: string;
  base_url: string;
  api_key_masked: string;     // sk-***-***-last4
  api_key_set: boolean;       // 是否已设置（用于判断"是否已配置"）
  num_ctx: number;
  temperature: number;
  timeout_ms: number;
  max_tokens: number;
  is_enabled: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

function rowToPublic(row: LlmConfigRow, decryptedKey: string | null): LlmConfigPublic {
  return {
    source: "db" as const,
    provider: row.provider,
    model_name: row.model_name,
    base_url: row.base_url,
    api_key_masked: decryptedKey ? maskApiKey(decryptedKey) : "",
    api_key_set: !!decryptedKey,
    num_ctx: row.num_ctx,
    temperature: Number(row.temperature),
    timeout_ms: row.timeout_ms,
    max_tokens: row.max_tokens,
    is_enabled: row.is_enabled,
    note: row.note,
    updated_at: row.updated_at,
    updated_by: row.updated_by
  };
}

/** 读取当前配置（返回密文，用于内部解密；前端用 getPublicConfig） */
export async function getConfigRow(): Promise<LlmConfigRow | null> {
  const r = await query<LlmConfigRow>(
    `SELECT * FROM app_llm_config WHERE id = 1 LIMIT 1`
  );
  return r.rows[0] || null;
}

/** 读脱敏后的配置（给前端用）；DB 没存时回退到 .env 默认值 */
export async function getPublicConfig(): Promise<LlmConfigPublic | null> {
  const row = await getConfigRow();
  if (!row) {
    // DB 没存 → 返回 .env 回退值（前端可看到当前生效配置）
    return {
      source: "env" as const,
      provider: (process.env.DEFAULT_MODEL ?? "openai") === "ollama" ? "ollama" : "openai",
      model_name: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      base_url: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      api_key_masked: process.env.OPENAI_API_KEY ? `***-env` : "",
      api_key_set: !!process.env.OPENAI_API_KEY,
      num_ctx: 4096,
      temperature: 0.3,
      timeout_ms: 60000,
      max_tokens: 4096,
      is_enabled: true,
      note: "当前使用 .env 默认值（数据库无配置）",
      updated_at: new Date().toISOString(),
      updated_by: "system"
    };
  }
  let decrypted: string | null = null;
  try {
    decrypted = decryptApiKey({
      ciphertext: row.api_key_enc,
      iv: row.api_key_iv,
      tag: row.api_key_tag
    });
  } catch (e) {
    console.warn("[llm-config] 解密失败（密钥可能变更过）:", (e as Error).message);
  }
  return rowToPublic(row, decrypted);
}

/** 完整读取（含明文 key，仅 service 内部使用） */
export async function getResolvedConfig(): Promise<{
  provider: ModelProvider;
  modelName: string;
  baseUrl: string;
  apiKey: string | null;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
  maxTokens: number;
  isEnabled: boolean;
} | null> {
  const row = await getConfigRow();
  if (!row || !row.is_enabled) return null;
  const apiKey = decryptApiKey({
    ciphertext: row.api_key_enc,
    iv: row.api_key_iv,
    tag: row.api_key_tag
  });
  return {
    provider: row.provider as ModelProvider,
    modelName: row.model_name,
    baseUrl: row.base_url,
    apiKey,
    numCtx: row.num_ctx,
    temperature: Number(row.temperature),
    timeoutMs: row.timeout_ms,
    maxTokens: row.max_tokens,
    isEnabled: row.is_enabled
  };
}

export interface UpsertConfigInput {
  provider: string;
  model_name: string;
  base_url: string;
  api_key?: string;            // 仅在更新时传；前端如"保持原值"则不传
  num_ctx: number;
  temperature: number;
  timeout_ms: number;
  max_tokens: number;
  is_enabled: boolean;
  note?: string | null;
  operator: string;            // user id
  reason?: string | null;
}

/** 创建或更新单条配置（UPSERT） */
export async function upsertConfig(input: UpsertConfigInput): Promise<LlmConfigPublic> {
  // 校验
  if (!input.provider) throw new Error("provider 必填");
  if (!input.model_name) throw new Error("model_name 必填");
  if (!input.base_url) throw new Error("base_url 必填");
  if (input.num_ctx < 512 || input.num_ctx > 200000) {
    throw new Error("num_ctx 必须在 512-200000 之间");
  }
  if (input.temperature < 0 || input.temperature > 2) {
    throw new Error("temperature 必须在 0-2 之间");
  }

  // 读现有（决定是 INSERT 还是 UPDATE，是否复用旧 key）
  const existing = await getConfigRow();
  let enc;
  if (input.api_key && input.api_key.trim()) {
    // 用户输入了新 key（即使保留也得重新加密以匹配当前 master key）
    enc = encryptApiKey(input.api_key.trim());
  } else if (existing) {
    // 复用现有密文（前端没传 key）
    enc = {
      ciphertext: existing.api_key_enc,
      iv: existing.api_key_iv,
      tag: existing.api_key_tag
    };
  } else {
    throw new Error("首次配置必须提供 API key");
  }

  return withTransaction(async (client) => {
    let row: LlmConfigRow;
    if (existing) {
      const r = await client.query<LlmConfigRow>(
        `UPDATE app_llm_config SET
           provider = $1, model_name = $2, base_url = $3,
           api_key_enc = $4, api_key_iv = $5, api_key_tag = $6,
           num_ctx = $7, temperature = $8, timeout_ms = $9, max_tokens = $10,
           is_enabled = $11, note = $12, updated_by = $13
         WHERE id = 1
         RETURNING *`,
        [
          input.provider, input.model_name, input.base_url,
          enc.ciphertext, enc.iv, enc.tag,
          input.num_ctx, input.temperature, input.timeout_ms, input.max_tokens,
          input.is_enabled, input.note || null, input.operator
        ]
      );
      row = r.rows[0];
    } else {
      const r = await client.query<LlmConfigRow>(
        `INSERT INTO app_llm_config (
           id, provider, model_name, base_url,
           api_key_enc, api_key_iv, api_key_tag,
           num_ctx, temperature, timeout_ms, max_tokens,
           is_enabled, note, created_by, updated_by
         ) VALUES (
           1, $1, $2, $3,
           $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $13
         ) RETURNING *`,
        [
          input.provider, input.model_name, input.base_url,
          enc.ciphertext, enc.iv, enc.tag,
          input.num_ctx, input.temperature, input.timeout_ms, input.max_tokens,
          input.is_enabled, input.note || null, input.operator
        ]
      );
      row = r.rows[0];
    }

    // 写审计日志（不存明文 key，只存 ciphertext+iv+tag 摘要）
    const decryptedKey = decryptApiKey(enc);
    await client.query(
      `INSERT INTO app_llm_config_log
        (config_id, action, snapshot, operator, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        row.id,
        existing ? "UPDATE" : "INSERT",
        {
          provider: row.provider,
          model_name: row.model_name,
          base_url: row.base_url,
          api_key_set: !!decryptedKey,
          api_key_masked: maskApiKey(decryptedKey),
          num_ctx: row.num_ctx,
          temperature: Number(row.temperature),
          timeout_ms: row.timeout_ms,
          max_tokens: row.max_tokens,
          is_enabled: row.is_enabled,
          note: row.note
        },
        input.operator,
        input.reason || null
      ]
    );

    return rowToPublic(row, decryptedKey);
  });
}

/** 删除配置（回退到 .env 默认） */
export async function deleteConfig(operator: string, reason?: string): Promise<void> {
  const existing = await getConfigRow();
  if (!existing) return;
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM app_llm_config WHERE id = 1`);
    await client.query(
      `INSERT INTO app_llm_config_log
        (config_id, action, snapshot, operator, reason)
       VALUES ($1, 'DELETE', $2, $3, $4)`,
      [
        existing.id,
        {
          provider: existing.provider,
          model_name: existing.model_name,
          base_url: existing.base_url,
          api_key_set: true,
          api_key_masked: "(已删除)",
          num_ctx: existing.num_ctx,
          temperature: Number(existing.temperature),
          timeout_ms: existing.timeout_ms,
          max_tokens: existing.max_tokens,
          is_enabled: false
        },
        operator,
        reason || null
      ]
    );
  });
}

/** 读最近变更日志（前端"变更记录"面板用） */
export async function listConfigLog(limit = 20): Promise<Array<{
  id: number;
  action: string;
  snapshot: any;
  operator: string | null;
  reason: string | null;
  created_at: string;
}>> {
  const r = await query<any>(
    `SELECT id, action, snapshot, operator, reason, created_at
     FROM app_llm_config_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}