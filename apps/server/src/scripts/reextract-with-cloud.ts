/**
 * V2.3.4 用云端模型重新抽取所有历史合同
 *
 * 原因：之前 bulk-import 用本地 qwen2.5:7b，抽取准确率低
 *      现在改用云端 MiniMax-M3 重新抽取所有 851 条
 *
 * 流程：
 *   1. 删除现有 contract_file.ocr_extracted
 *   2. 对每条 contract_file 取 ocr_text
 *   3. 调用云端 AI 重新抽取
 *   4. 写回 ocr_extracted + 同步到 contract.raw_extracted
 *   5. 回填 certification_types / contract_amount / 等字段
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { query } from "../db/pool.js";
import { extractContractFields } from "../contracts/contract.extractor.js";

const BASE_DIR = "/mnt/renz/19.认证合同/";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

async function reExtractAll() {
  console.log("🔄 用云端模型重新抽取所有历史合同");
  console.log("");

  // 1. 拿所有 contract_file（按合同）
  const files = await query<any>(`
    SELECT
      cf.id AS file_id,
      cf.contract_id,
      cf.ocr_text,
      cf.sha256,
      cf.file_name,
      c.contract_no
    FROM contract_file cf
    JOIN contract c ON cf.contract_id = c.id
    WHERE cf.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND cf.ocr_text IS NOT NULL
      AND LENGTH(cf.ocr_text) > 100
    ORDER BY c.created_at
  `);

  console.log(`📊 待重新抽取: ${files.rows.length} 个文件`);

  const stats = {
    total: files.rows.length,
    success: 0,
    failed: 0,
    updated: 0,
    skipped: 0,
    startedAt: Date.now()
  };

  const CONCURRENCY = 3;
  const queue = [...files.rows];
  const inProgress = new Set<Promise<void>>();

  async function processFile(f: any) {
    try {
      // 重新 AI 抽取
      const result = await extractContractFields(f.ocr_text);

      if (!result.extracted) {
        stats.skipped++;
        return;
      }

      // 更新 ocr_extracted
      await query(
        `UPDATE contract_file SET ocr_extracted = $1 WHERE id = $2`,
        [JSON.stringify(result.extracted), f.file_id]
      );

      // 同步到 contract 表
      const ai = result.extracted;
      const updateFields: string[] = ['updated_at = NOW()'];
      const updateParams: any[] = [];

      // 合同金额
      let idx = 1;
      if (ai['合同金额'] != null) {
        updateFields.push(`contract_amount = $${idx++}`);
        updateParams.push(Number(ai['合同金额']));
      }
      // 乙方主体
      if (ai['乙方主体']) {
        updateFields.push(`notes = COALESCE(notes, '') || $${idx++}`);
        updateParams.push(`\n[AI 重抽 ${new Date().toISOString().slice(0, 10)}] 乙方主体: ${ai['乙方主体']}`);
      }
      // 合同类型
      let contractType: string | null = null;
      if (ai['合同类型']) {
        if (ai['合同类型'].includes('main')) contractType = 'main';
        else if (ai['合同类型'].includes('supplement')) contractType = 'supplement';
        else if (ai['合同类型'].includes('recertification')) contractType = 'recertification';
        else if (ai['合同类型'].includes('supervision')) contractType = 'supervision';
        if (contractType) {
          updateFields.push(`contract_type = $${idx++}`);
          updateParams.push(contractType);
        }
      }
      // 签订日期
      if (ai['签订日期'] && /^\d{4}-\d{2}-\d{2}$/.test(ai['签订日期'])) {
        updateFields.push(`signed_at = COALESCE(signed_at, $${idx++}::date)`);
        updateParams.push(ai['签订日期']);
      }

      // 写入 raw_extracted
      updateFields.push(`raw_extracted = $${idx++}`);
      updateParams.push(JSON.stringify({ extracted: ai, confidence: result.confidence }));

      // extraction_confidence
      if (result.confidence != null) {
        updateFields.push(`extraction_confidence = $${idx++}`);
        updateParams.push(result.confidence);
      }

      updateParams.push(f.contract_id);
      await query(
        `UPDATE contract SET ${updateFields.join(', ')} WHERE id = $${idx}`,
        updateParams
      );

      // 认证体系（数组）
      if (Array.isArray(ai['认证体系']) && ai['认证体系'].length > 0) {
        await query(
          `UPDATE contract SET certification_types = $1, updated_at = NOW() WHERE id = $2`,
          [ai['认证体系'], f.contract_id]
        );
      }

      // 银行信息（截断）
      const bankUpdates: string[] = [];
      const bankParams: any[] = [];
      let bidx = 1;
      if (ai['开户行']) {
        bankUpdates.push(`bank_name = LEFT($${bidx++}, 100)`);
        bankParams.push(ai['开户行']);
      }
      if (ai['户名']) {
        bankUpdates.push(`bank_holder = LEFT($${bidx++}, 100)`);
        bankParams.push(ai['户名']);
      }
      if (ai['账号']) {
        bankUpdates.push(`bank_account = LEFT($${bidx++}, 50)`);
        bankParams.push(ai['账号']);
      }
      if (bankUpdates.length > 0) {
        bankParams.push(f.contract_id);
        await query(
          `UPDATE contract SET ${bankUpdates.join(', ')}, updated_at = NOW() WHERE id = $${bidx}`,
          bankParams
        );
      }

      // 客户匹配（如果 AI 抽到了甲方客户名）
      if (ai['甲方客户名'] && ai['甲方客户名'].length >= 4) {
        // 用 findCustomerByName 匹配
        const { findCustomerByName } = await import("../contracts/customer.matcher.js");
        const m = await findCustomerByName("00000000-0000-0000-0000-000000000001", ai['甲方客户名']);
        if (m && m.customer && m.confidence >= 0.5) {
          await query(
            `UPDATE contract SET customer_id = $1, updated_at = NOW()
             WHERE id = $2 AND customer_id = 'ffe494e3-7456-4974-8b3e-1f4baf5ef05c'`,
            [m.customer.id, f.contract_id]
          );
          // 记录别名（unique 约束是 company_id + alias_name）
          if (ai['甲方客户名'] !== m.customer.name) {
            await query(
              `INSERT INTO customer_alias (company_id, customer_id, alias_name, source, match_count)
               VALUES ($1, $2, $3, 're-extract', 1)
               ON CONFLICT (company_id, alias_name) DO NOTHING`,
              ["00000000-0000-0000-0000-000000000001", m.customer.id, ai['甲方客户名']]
            );
          }
        }
      }

      stats.success++;
      stats.updated++;
    } catch (e: any) {
      stats.failed++;
      console.error(`  ❌ ${f.contract_no}: ${e.message.slice(0, 100)}`);
    }
  }

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < CONCURRENCY && queue.length > 0) {
      const f = queue.shift()!;
      const p = (async () => {
        await processFile(f);
        stats.total--;
        if (stats.total % 20 === 0) {
          const elapsed = (Date.now() - stats.startedAt) / 1000;
          console.log(`📊 [${stats.success + stats.failed}/${files.rows.length}] 速度 ${(stats.success+stats.failed)/elapsed}/秒, 错误 ${stats.failed}`);
        }
      })();
      inProgress.add(p);
      p.finally(() => inProgress.delete(p));
    }
    if (inProgress.size > 0) await Promise.race(inProgress);
  }

  const elapsed = (Date.now() - stats.startedAt) / 1000;
  console.log("\n" + "=".repeat(60));
  console.log("✅ 完成");
  console.log("=".repeat(60));
  console.log(`📊 总数: ${files.rows.length}`);
  console.log(`✅ 成功: ${stats.success}`);
  console.log(`❌ 失败: ${stats.failed}`);
  console.log(`⏱️  耗时: ${elapsed.toFixed(1)}秒 (${(elapsed/60).toFixed(1)}分钟)`);
  console.log(`📈 平均: ${(elapsed*1000/files.rows.length).toFixed(0)}ms/文件`);
}

reExtractAll()
  .then(() => process.exit(0))
  .catch(e => { console.error("❌ 失败:", e); process.exit(1); });