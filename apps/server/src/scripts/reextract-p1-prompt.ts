/**
 * V2.3.5 P1: 用新 prompt 重抽全部已 OCR 成功的 contract_file
 *
 * 策略：
 *  - ocr_text IS NOT NULL（已经 OCR 过的）
 *  - ocr_extracted IS NULL（未抽过 AI 的 661）OR 字段空（早期抽的 301 字段不全）
 *  - 用新 prompt 重抽
 *  - 写回 ocr_extracted + 同步 contract 关键字段（COALESCE 不覆盖已有）
 *
 * P1 改进点：
 *  - prompt 改 P1（认证服务行业 / 强规则 / 日期严格 / 联系人位置）
 *  - 文本从 8000 → 16000 字符（覆盖末页）
 *  - 乙主体增加 "银川博文荣达"
 */

import path from "node:path";
import { query } from "../db/pool.js";
import { extractContractFields, extractText as extractTextService } from "../contracts/contract.extractor.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 1000000;
const CONCURRENCY = 2;  // 云端 API 限速

async function main() {
  console.log("🔄 V2.3.5 P1: 用新 prompt 重抽全部已 OCR 的 contract_file");
  console.log(`🏃 模式: ${DRY_RUN ? "DRY_RUN（仅统计）" : "实跑（写 DB）"}`);

  // 全部已 OCR 的 contract_file（包括 P0 抽过的 631 + 之前 301 中 ocr_text > 50 chars 的）
  const files = await query<any>(`
    SELECT
      cf.id AS file_id,
      cf.contract_id,
      cf.storage_path AS file_path,
      cf.file_name,
      c.title AS contract_name,
      c.customer_id,
      LENGTH(cf.ocr_text) AS ocr_len,
      cf.ocr_extracted IS NOT NULL AS was_ai_extracted
    FROM contract_file cf
    JOIN contract c ON cf.contract_id = c.id
    WHERE cf.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND cf.ocr_text IS NOT NULL
      AND LENGTH(cf.ocr_text) > 100  -- 文本够长才有意义
    ORDER BY
      cf.ocr_extracted IS NULL DESC,  -- 优先 P0 抽的 631
      c.created_at DESC
    LIMIT ${LIMIT}
  `);
  console.log(`📊 待重抽: ${files.rows.length} 个文件`);
  console.log(`   ├─ P0 未抽 AI: ${files.rows.filter((r: any) => !r.was_ai_extracted).length}`);
  console.log(`   ├─ 之前抽过 AI 字段不全: ${files.rows.filter((r: any) => r.was_ai_extracted).length}`);
  console.log("");

  let success = 0;
  let failAI = 0;
  let failParse = 0;
  let synced = 0;
  let skipped = 0;
  const samples: any[] = [];
  const total = files.rows.length;
  let processed = 0;

  const queue = [...files.rows];
  await Promise.all(
    Array.from({ length: CONCURRENCY }).map(async () => {
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f) break;
        try {
          const text = (await query("SELECT ocr_text FROM contract_file WHERE id=$1", [f.file_id])).rows[0].ocr_text;
          if (!text || text.length < 100) {
            skipped++;
            continue;
          }
          let aiResult: any = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              aiResult = await extractContractFields(text, "openai");  // 走云端 MiniMax-M3 (V2.3.3)
              break;
            } catch (e: any) {
              if (attempt === 1) throw e;
              console.warn(`  [${f.file_name}] 重试 (attempt ${attempt+1}): ${e.message?.slice(0, 60)}`);
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          if (!aiResult) { failAI++; continue; }
          const ai = aiResult.extracted;
          const confidence = aiResult.confidence;

          if (DRY_RUN) {
            const filled = Object.values(ai).filter((v: any) => v != null && v !== "").length;
            samples.push({
              name: f.file_name,
              ocr_len: f.ocr_len,
              filled,
              total: 16,
              confidence,
              合同编号: ai.合同编号,
              联系人: ai.联系人,
              联系电话: ai.联系电话,
              签订日期: ai.签订日期,
              合同金额: ai.合同金额,
              认证体系: ai.认证体系,
            });
            success++;
            if (samples.length <= 3) {
              console.log(`  [${f.file_name}] DRY: ocr=${f.ocr_len} chars, 填${filled}字段 conf=${(confidence*100).toFixed(0)}%`);
              console.log(`    编号=${ai.合同编号} 联系人=${ai.联系人} 电话=${ai.联系电话} 金额=${ai.合同金额} 体系=${JSON.stringify(ai.认证体系)}`);
            }
          } else {
            const filled = Object.values(ai).filter((v: any) => v != null && v !== "").length;
            console.log(`  [${f.file_name}] ocr=${f.ocr_len}c 填${filled}/16 编号=${ai.合同编号||'null'} 联系人=${ai.联系人||'null'} 电话=${ai.联系电话||'null'} 金额=${ai.合同金额||'null'} 体系=${JSON.stringify(ai.认证体系)}`);
            // 写 ocr_extracted（DB schema 无 ocr_confidence / extracted_at 列，只写 ocr_extracted）
            await query(
              `UPDATE contract_file SET ocr_extracted = $1::jsonb WHERE id = $2`,
              [JSON.stringify(ai), f.file_id]
            );
            success++;
            // 同步关键字段到 contract
            const updates: string[] = [];
            const vals: any[] = [];
            let idx = 1;
            if (ai.合同编号) { updates.push(`contract_no = COALESCE(contract_no, $${idx++})`); vals.push(ai.合同编号); }
            if (ai.合同金额 != null) { updates.push(`contract_amount = COALESCE(contract_amount, $${idx++})`); vals.push(ai.合同金额); }
            if (ai.签订日期) { updates.push(`signed_at = COALESCE(signed_at, $${idx++}::date)`); vals.push(ai.签订日期); }
            if (ai.生效日期) { updates.push(`effective_at = COALESCE(effective_at, $${idx++}::date)`); vals.push(ai.生效日期); }
            if (ai.到期日期) { updates.push(`expire_at = COALESCE(expire_at, $${idx++}::date)`); vals.push(ai.到期日期); }
            if (ai.联系人) { updates.push(`contact_person = COALESCE(contact_person, $${idx++})`); vals.push(ai.联系人); }
            if (ai.联系电话) { updates.push(`contact_phone = COALESCE(contact_phone, $${idx++})`); vals.push(ai.联系电话); }
            if (ai.认证体系 && Array.isArray(ai.认证体系) && ai.认证体系.length > 0) {
              updates.push(`certification_types = COALESCE(certification_types, $${idx++}::text[])`);
              vals.push(ai.认证体系);
            }
            if (updates.length > 0) {
              vals.push(f.contract_id);
              await query(`UPDATE contract SET ${updates.join(", ")} WHERE id = $${idx}`, vals);
              synced++;
            }

            // V2.3.5 P1 增量：联系人/电话反哺给 customer（按合同 customer_id）
            // 仅当 customer 字段为空时回填，避免覆盖用户已录入的数据
            if (f.customer_id && (ai.联系人 || ai.联系电话)) {
              const custUpdates: string[] = [];
              const custVals: any[] = [];
              let cidx = 1;
              if (ai.联系人) { custUpdates.push(`contact_person = COALESCE(contact_person, $${cidx++})`); custVals.push(ai.联系人); }
              if (ai.联系电话) { custUpdates.push(`contact_phone = COALESCE(contact_phone, $${cidx++})`); custVals.push(ai.联系电话); }
              if (custUpdates.length > 0) {
                custVals.push(f.customer_id);
                await query(`UPDATE customer SET ${custUpdates.join(", ")} WHERE id = $${cidx} AND deleted_at IS NULL`, custVals);
              }
            }
          }
        } catch (e: any) {
          if (e.message?.includes("invalid input syntax for type date")) {
            failParse++;
            console.warn(`  [${f.file_name}] ⚠️ 日期格式错`);
          } else if (e.message?.includes("no JSON")) {
            failAI++;
          } else {
            console.error(`  [${f.file_name}] ❌ ${e.message?.slice(0, 100)}`);
            failAI++;
          }
        }
        processed++;
        if (processed % 20 === 0) {
          const pct = (processed/total*100).toFixed(1);
          console.log(`📈 进度 ${processed}/${total} (${pct}%) | ok=${success} fail=${failAI} date=${failParse} sync=${synced}`);
        }
      }
    })
  );

  console.log("\n" + "=".repeat(60));
  console.log("✅ P1 完成");
  console.log("=".repeat(60));
  console.log(`AI 抽取成功: ${success} | 失败: ${failAI} | 日期错: ${failParse} | 跳过: ${skipped}`);
  if (!DRY_RUN) console.log(`contract 同步: ${synced} 条`);

  if (DRY_RUN && samples.length > 0) {
    console.log("\n=== 抽样前 3 条 ===");
    samples.slice(0, 3).forEach((s, i) => {
      console.log(`\n[${i+1}] ${s.name} (ocr=${s.ocr_len} chars)`);
      console.log(`   填 ${s.filled}/${s.total} 字段 置信度 ${(s.confidence*100).toFixed(0)}%`);
      console.log(`   编号: ${s.合同编号 || '❌ null'}`);
      console.log(`   联系人: ${s.联系人 || '❌ null'} | 电话: ${s.联系电话 || '❌ null'}`);
      console.log(`   金额: ${s.合同金额 || '❌ null'} | 签订: ${s.签订日期 || '❌ null'}`);
      console.log(`   体系: ${JSON.stringify(s.认证体系)}`);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
