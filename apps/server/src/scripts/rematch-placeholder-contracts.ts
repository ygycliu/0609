/**
 * V2.3.3 占位客户智能重新匹配
 *
 * 数据：449 条合同挂占位客户"待匹配客户"
 *      其中 137 条 AI 抽取了甲方客户名
 *
 * 流程：
 *   1. 取每条合同的 AI 客户名（甲方客户名）
 *   2. 在 customer 表里模糊匹配
 *   3. 匹配成功 → 更新 customer_id + 记录别名
 *   4. 没匹配 → 报告待人工处理
 */
import { query } from "../db/pool.js";
import { findCustomerByName } from "../contracts/customer.matcher.js";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

const PLACEHOLDER_ID = "ffe494e3-7456-4974-8b3e-1f4baf5ef05c";
const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

async function rematchPlaceholderContracts() {
  console.log("🔍 开始重新匹配占位客户合同");
  console.log("");

  // 1. 拿所有有 AI 客户名的占位合同
  const placeholderContracts = await query<any>(
    `SELECT id, contract_no, customer_id,
            raw_extracted->'extracted'->>'甲方客户名' AS ai_customer,
            raw_extracted->'extracted'->>'客户名称' AS ai_customer2,
            notes
     FROM contract
     WHERE customer_id = $1
       AND deleted_at IS NULL
       AND raw_extracted->'extracted'->>'甲方客户名' IS NOT NULL
       AND raw_extracted->'extracted'->>'甲方客户名' != ''
     ORDER BY created_at`,
    [PLACEHOLDER_ID]
  );

  console.log(`📊 待匹配合同: ${placeholderContracts.rows.length} 条`);

  const stats = {
    total: placeholderContracts.rows.length,
    matched_exact: 0,
    matched_fuzzy: 0,
    matched_alias: 0,
    unmatched: 0,
    errors: 0
  };

  const unmatched = [];
  const matched = [];

  for (const contract of placeholderContracts.rows) {
    const aiName = contract.ai_customer;
    if (!aiName || aiName.trim() === "") continue;

    try {
      // 用模糊匹配器找真实客户
      const m = await findCustomerByName(COMPANY_ID, aiName);

      if (m && m.customer && m.confidence >= 0.5) {
        // 匹配成功 - 更新 contract.customer_id
        await query(
          `UPDATE contract SET customer_id = $1, updated_at = NOW() WHERE id = $2`,
          [m.customer.id, contract.id]
        );

        // 记录别名（如果 AI 抽取的名称和 DB 不完全一样）
        if (aiName !== m.customer.name) {
          try {
            await query(
              `INSERT INTO customer_alias (company_id, customer_id, alias_name, source, match_count)
               VALUES ($1, $2, $3, 'rematch', 1)
               ON CONFLICT (company_id, alias_name) DO NOTHING`,
              [COMPANY_ID, m.customer.id, aiName]
            );
          } catch (e) {/* ignore */}
        }

        if (m.matchType === "exact") stats.matched_exact++;
        else if (m.matchType === "alias") stats.matched_alias++;
        else stats.matched_fuzzy++;

        matched.push({
          contract_no: contract.contract_no,
          ai_name: aiName,
          matched_to: m.customer.name,
          customer_id: m.customer.id,
          confidence: m.confidence,
          match_type: m.matchType
        });
      } else {
        // 没匹配上
        stats.unmatched++;
        unmatched.push({
          contract_no: contract.contract_no,
          ai_name: aiName,
          best_candidate: m?.customer?.name || null,
          best_confidence: m?.confidence || 0
        });
      }
    } catch (e: any) {
      stats.errors++;
      console.error(`  ❌ ${contract.contract_no}: ${e.message}`);
    }
  }

  // 输出结果
  console.log("\n" + "=".repeat(60));
  console.log("✅ 重新匹配完成");
  console.log("=".repeat(60));
  console.log(`📊 总数: ${stats.total}`);
  console.log(`✅ 精确匹配: ${stats.matched_exact}`);
  console.log(`🔍 别名匹配: ${stats.matched_alias}`);
  console.log(`🔎 模糊匹配: ${stats.matched_fuzzy}`);
  console.log(`❌ 未匹配: ${stats.unmatched}`);
  console.log(`⚠️  错误: ${stats.errors}`);
  console.log(`📈 成功率: ${((stats.matched_exact + stats.matched_fuzzy + stats.matched_alias) / stats.total * 100).toFixed(1)}%`);

  // 列出未匹配的（供人工处理）
  if (unmatched.length > 0) {
    console.log(`\n❌ 未匹配 (前 20):`);
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  ${u.contract_no}: "${u.ai_name}" → 最佳候选: ${u.best_candidate || "无"} (${(u.best_confidence * 100).toFixed(0)}%)`);
    }
  }

  // 保存报告
  const report = { stats, matched: matched.slice(0, 100), unmatched: unmatched.slice(0, 100), generated_at: new Date().toISOString() };
  const fs = await import("node:fs/promises");
  await fs.writeFile("/tmp/rematch-placeholder-report.json", JSON.stringify(report, null, 2));
  console.log(`\n📄 报告: /tmp/rematch-placeholder-report.json`);
}

rematchPlaceholderContracts()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("❌ 失败:", e);
    process.exit(1);
  });