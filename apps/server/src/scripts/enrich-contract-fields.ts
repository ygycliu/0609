/**
 * V2.3.3 补充合同字段：乙方主体、银行、合同类型
 */
import { query } from "../db/pool.js";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

async function enrichContractFields() {
  console.log("🔧 补充合同字段");
  console.log("");

  // 1. 收集所有 AI 抽取的乙方主体
  const aiEntities = await query<any>(
    `SELECT DISTINCT raw_extracted->'extracted'->>'乙方主体' AS name
     FROM contract
     WHERE deleted_at IS NULL
       AND raw_extracted->'extracted'->>'乙方主体' IS NOT NULL
       AND raw_extracted->'extracted'->>'乙方主体' != ''
       AND raw_extracted->'extracted'->>'乙方主体' != 'null'
    `
  );

  const existing = await query<any>(`SELECT id, name FROM signing_entity`);

  const entityMap = new Map<string, string>();
  for (const e of existing.rows) entityMap.set(e.name.trim(), e.id);

  // 创建新主体
  let newEntityCount = 0;
  for (const row of aiEntities.rows) {
    const name = row.name?.trim();
    if (!name) continue;
    if (!entityMap.has(name)) {
      // 用 entity_code = 'EXT'（外部主体）
      const r = await queryOne<any>(
        `INSERT INTO signing_entity (company_id, entity_code, name, status, notes)
         VALUES ($1, 'EXT', $2, 'active', '从合同批量导入自动识别')
         ON CONFLICT (company_id, entity_code) DO NOTHING
         RETURNING id`,
        [COMPANY_ID, name]
      );
      if (r?.id) {
        entityMap.set(name, r.id);
        newEntityCount++;
      } else {
        // ON CONFLICT 触发 - 取已有 ID
        const existing = await queryOne<any>(
          `SELECT id FROM signing_entity WHERE company_id = $1 AND entity_code = 'EXT' AND name = $2 LIMIT 1`,
          [COMPANY_ID, name]
        );
        if (existing) entityMap.set(name, existing.id);
      }
    }
  }
  console.log(`📊 签约主体: ${entityMap.size} 个 (新增 ${newEntityCount})`);

  // 2. 更新合同的乙方主体（按名称匹配）
  const contractsToUpdate = await query<any>(
    `SELECT id, raw_extracted->'extracted'->>'乙方主体' AS ai_entity
     FROM contract
     WHERE deleted_at IS NULL
       AND raw_extracted->'extracted'->>'乙方主体' IS NOT NULL
       AND raw_extracted->'extracted'->>'乙方主体' != ''
       AND raw_extracted->'extracted'->>'乙方主体' != 'null'
       AND (signing_entity_id IN (
         '2bec0214-9cf5-4164-bc3a-03209fa8b5ce',  -- 默认 A
         '358af185-e954-4853-8a22-b3d1ea406155',  -- 默认 C
         '8803c1ee-05ea-45ee-ac6b-fb29a6a28ad2'   -- test
       ) OR signing_entity_id IS NULL)
    `
  );

  let updatedEntity = 0;
  for (const c of contractsToUpdate.rows) {
    const newId = entityMap.get(c.ai_entity.trim());
    if (newId) {
      await query(
        `UPDATE contract SET signing_entity_id = $1, updated_at = NOW() WHERE id = $2`,
        [newId, c.id]
      );
      updatedEntity++;
    }
  }
  console.log(`✅ 乙方主体更新: ${updatedEntity} 条`);

  // 3. 回填银行信息（截断到字段长度）
  const bankUpdates = await query(
    `UPDATE contract SET
       bank_name = LEFT(COALESCE(NULLIF(raw_extracted->'extracted'->>'开户行', ''), bank_name), 100),
       bank_holder = LEFT(COALESCE(NULLIF(raw_extracted->'extracted'->>'户名', ''), bank_holder), 100),
       bank_account = LEFT(COALESCE(NULLIF(raw_extracted->'extracted'->>'账号', ''), bank_account), 50),
       updated_at = NOW()
     WHERE deleted_at IS NULL
       AND raw_extracted->'extracted' ? '开户行'
       AND (bank_name IS NULL OR bank_holder IS NULL OR bank_account IS NULL)
    `
  );
  console.log(`✅ 银行信息回填: ${bankUpdates.rowCount || 0} 条`);

  // 4. 回填合同类型
  const typeUpdates = await query(
    `UPDATE contract
     SET contract_type = CASE
       WHEN raw_extracted->'extracted'->>'合同类型' LIKE 'main%' THEN 'main'
       WHEN raw_extracted->'extracted'->>'合同类型' LIKE 'supplement%' THEN 'supplement'
       WHEN raw_extracted->'extracted'->>'合同类型' LIKE 'recertification%' THEN 'recertification'
       WHEN raw_extracted->'extracted'->>'合同类型' LIKE 'supervision%' THEN 'supervision'
       ELSE contract_type
     END,
     updated_at = NOW()
     WHERE deleted_at IS NULL
       AND raw_extracted->'extracted' ? '合同类型'
       AND contract_type = 'main'
     `
  );
  console.log(`✅ 合同类型更新: ${typeUpdates.rowCount || 0} 条`);

  // 5. 回填签订日期（如果原 signed_at 为 NULL）
  // 用 LIKE 代替 regex（更简单可靠）
  const dateUpdates = await query(
    `UPDATE contract SET
       signed_at = COALESCE(
         signed_at,
         CASE WHEN raw_extracted->'extracted'->>'签订日期' LIKE '____-__-__'
              THEN to_date(raw_extracted->'extracted'->>'签订日期', 'YYYY-MM-DD')
              ELSE NULL END,
         CASE WHEN raw_extracted->'extracted'->>'生效日期' LIKE '____-__-__'
              THEN to_date(raw_extracted->'extracted'->>'生效日期', 'YYYY-MM-DD')
              ELSE NULL END
       ),
       updated_at = NOW()
     WHERE deleted_at IS NULL
       AND signed_at IS NULL
       AND raw_extracted IS NOT NULL
       AND (
         (raw_extracted->'extracted'->>'签订日期' LIKE '____-__-__')
         OR (raw_extracted->'extracted'->>'生效日期' LIKE '____-__-__')
       )
    `
  );
  console.log(`✅ 签订日期回填: ${dateUpdates.rowCount || 0} 条`);

  console.log("\n✅ 完成");
}

enrichContractFields()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("❌ 失败:", e);
    process.exit(1);
  });