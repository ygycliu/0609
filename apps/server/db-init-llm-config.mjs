// ad-hoc: 在后端 dist 里跑，加密列用 pgcrypto
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) 启用 pgcrypto（pgcrypto 用于 digest 校验；加密用 AES 自己写）
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // 2) 建表
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_llm_config (
        id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 单条配置
        provider     VARCHAR(32) NOT NULL,        -- openai / ollama / demo
        model_name   VARCHAR(128) NOT NULL,
        base_url     VARCHAR(512) NOT NULL,
        api_key_enc  TEXT NOT NULL,               -- 加密后的 api_key (AES-256-GCM base64)
        api_key_iv   VARCHAR(64) NOT NULL,        -- 初始化向量
        api_key_tag  VARCHAR(64) NOT NULL,        -- GCM auth tag
        num_ctx      INTEGER NOT NULL DEFAULT 4096,
        temperature  NUMERIC(3,2) NOT NULL DEFAULT 0.30,
        timeout_ms   INTEGER NOT NULL DEFAULT 60000,
        max_tokens   INTEGER NOT NULL DEFAULT 4096,
        is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
        note         TEXT,
        created_by   VARCHAR(64),
        updated_by   VARCHAR(64),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3) 索引（updated_at 最近查询）
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_llm_config_updated_at
      ON app_llm_config(updated_at DESC);
    `);

    // 4) 触发器：自动更新 updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION trg_app_llm_config_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`DROP TRIGGER IF EXISTS tg_app_llm_config_updated_at ON app_llm_config;`);
    await client.query(`
      CREATE TRIGGER tg_app_llm_config_updated_at
      BEFORE UPDATE ON app_llm_config
      FOR EACH ROW EXECUTE FUNCTION trg_app_llm_config_updated_at();
    `);

    // 5) 审计表：记录每次配置变更
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_llm_config_log (
        id           BIGSERIAL PRIMARY KEY,
        config_id    SMALLINT NOT NULL,
        action       VARCHAR(16) NOT NULL,        -- INSERT / UPDATE / DELETE
        snapshot     JSONB NOT NULL,             -- 变更后完整快照（api_key_enc 不存明文）
        operator     VARCHAR(64),
        reason       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_llm_config_log_created_at
      ON app_llm_config_log(created_at DESC);
    `);

    await client.query("COMMIT");

    // 验证表结构
    const r = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'app_llm_config'
      ORDER BY ordinal_position;
    `);
    console.log("\n=== app_llm_config 表结构 ===");
    for (const row of r.rows) {
      console.log(`  ${row.column_name.padEnd(16)} ${row.data_type.padEnd(20)} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${row.column_default || ''}`);
    }

    const r2 = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'app_llm_config_log'
      ORDER BY ordinal_position;
    `);
    console.log("\n=== app_llm_config_log 表结构 ===");
    for (const row of r2.rows) {
      console.log(`  ${row.column_name.padEnd(16)} ${row.data_type}`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERROR:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });