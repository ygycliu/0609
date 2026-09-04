/**
 * V2.3.5 对未抽取的 661 条合同：重跑全文 OCR + AI 结构化抽取
 *
 * 改版原因：
 *  - 老 bulk-import 用 maxPages=2，联系人/电话/合同编号在末页的全部丢失
 *  - 改 maxPages=9999 全文抽取，再调云端 AI 抽取
 *
 * 与 reextract-with-cloud.ts 的区别：
 *  - reextract-with-cloud.ts 只对已有 ocr_text 重抽 AI（ocr_text 还是前 2 页）
 *  - 本脚本先重跑 pdftotext 全文 + OCR，再用云端 AI 重抽
 *
 * 用法：
 *   npx tsx src/scripts/reextract-unfull-ocr.ts
 *   DRY_RUN=1 npx tsx ...   （只看统计，不动 DB）
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "../db/pool.js";
import { extractContractFields, extractText as extractTextService } from "../contracts/contract.extractor.js";

const execAsync = promisify(execFile);
const DRY_RUN = process.env.DRY_RUN === "1";

/** V2.3.5: 全文抽取（自动 fallback OCR），复用 service 中的逻辑 */
async function extractFullText(filepath: string): Promise<string> {
  const ext = path.extname(filepath).toLowerCase();
  let fileType: "pdf" | "doc" | "docx" | "image";
  if (ext === ".pdf") fileType = "pdf";
  else if (ext === ".doc") fileType = "doc";
  else if (ext === ".docx") fileType = "docx";
  else if ([".jpg", ".jpeg", ".png"].includes(ext)) fileType = "image";
  else return "";

  try {
    const result = await extractTextService(filepath, fileType);
    return result.text;
  } catch (e: any) {
    console.warn(`  ⚠️ extract failed: ${e.message}`);
    return "";
  }
}

async function main() {
  console.log("🔄 V2.3.5 重跑全文 OCR + AI 抽取");
  console.log("📁 模式: 对 contract_file 表 ocr_extracted IS NULL 的 661 个文件重抽");
  console.log(`🏃 模式: ${DRY_RUN ? "DRY_RUN（仅统计）" : "实跑（写 DB）"}`);
  console.log("");

  // 1. 拿未抽取的合同文件
  const files = await query<any>(`
    SELECT
      cf.id AS file_id,
      cf.contract_id,
      cf.storage_path AS file_path,
      cf.file_name,
      c.title AS contract_name,
      c.customer_id,
      LENGTH(cf.ocr_text) AS ocr_len_old
    FROM contract_file cf
    JOIN contract c ON cf.contract_id = c.id
    WHERE cf.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND cf.ocr_extracted IS NULL  -- 未抽取的
      AND cf.storage_path IS NOT NULL
    ORDER BY c.created_at
    LIMIT ${process.env.LIMIT ? parseInt(process.env.LIMIT) : 1000000}
  `);
  console.log(`📊 待重抽: ${files.rows.length} 个文件`);
  console.log("");

  if (files.rows.length === 0) {
    console.log("✅ 没有待抽取的合同，任务结束");
    return;
  }

  const stats = {
    total: files.rows.length,
    ocrOk: 0,
    ocrFail: 0,
    aiOk: 0,
    aiFail: 0,
    contractUpdated: 0,
    skippedNoText: 0,
    startedAt: Date.now()
  };

  // 抽样 5 条看效果
  const CONCURRENCY = 4;  // OCR 全文慢（PDF 转 PNG + tesseract），并发 4
  const queue = [...files.rows];
  const samples: Array<{name: string; oldLen: number; newLen: number; extracted: any}> = [];

  async function processFile(f: any) {
    const logPrefix = `[${f.contract_name || f.file_name}]`;
    try {
      // 1. 全文 OCR
      let fullText = "";
      try {
        await fs.access(f.file_path);
        fullText = await extractFullText(f.file_path);
      } catch (e: any) {
        if (e.code === "ENOENT") {
          console.warn(`  ${logPrefix} ⚠️ 文件不存在: ${f.file_path}`);
          stats.ocrFail++;
          return;
        }
        throw e;
      }

      if (fullText.length < 50) {
        console.warn(`  ${logPrefix} ⚠️ OCR 文本过短 (${fullText.length} chars)，跳过`);
        stats.skippedNoText++;
        return;
      }
      stats.ocrOk++;

      // 2. AI 抽取
      const aiResult = await extractContractFields(fullText);
      if (!aiResult.extracted) {
        console.warn(`  ${logPrefix} ⚠️ AI 抽取失败`);
        stats.aiFail++;
        return;
      }
      stats.aiOk++;

      // 抽样记录
      if (samples.length < 5) {
        samples.push({
          name: f.contract_name,
          oldLen: f.ocr_len_old || 0,
          newLen: fullText.length,
          extracted: aiResult.extracted
        });
      }

      if (DRY_RUN) {
        console.log(`  ${logPrefix} 🔍 DRY: ocr_text ${fullText.length} chars, ai 抽取 ok, no=${aiResult.extracted.合同编号}`);
        return;
      }

      // 3. 写回 ocr_text + ocr_extracted
      await query(
        `UPDATE contract_file SET ocr_text = $1, ocr_extracted = $2 WHERE id = $3`,
        [fullText, JSON.stringify({ extracted: aiResult.extracted, confidence: aiResult.confidence }), f.file_id]
      );

      // 4. 同步关键字段到 contract 表
      const ai = aiResult.extracted;
      const updates: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      if (ai.合同编号) { updates.push(`contract_no = COALESCE(contract_no, $${idx++})`); vals.push(ai.合同编号); }
      if (ai.合同金额 != null) { updates.push(`contract_amount = $${idx++}`); vals.push(Number(ai.合同金额)); }
      if (ai.签订日期) { updates.push(`signed_at = $${idx++}`); vals.push(ai.签订日期); }
      if (ai.生效日期) { updates.push(`effective_at = $${idx++}`); vals.push(ai.生效日期); }
      if (ai.到期日期) { updates.push(`expire_at = $${idx++}`); vals.push(ai.到期日期); }
      if (ai.联系人) { updates.push(`contact_person = $${idx++}`); vals.push(ai.联系人); }
      if (ai.联系电话) { updates.push(`contact_phone = $${idx++}`); vals.push(ai.联系电话); }
      if (ai.认证体系) { updates.push(`certification_types = $${idx++}`); vals.push(ai.认证体系); }
      if (ai.合同类型) { updates.push(`contract_type = $${idx++}`); vals.push(ai.合同类型); }
      updates.push(`raw_extracted = $${idx++}`); vals.push(JSON.stringify(ai));
      updates.push(`extraction_confidence = $${idx++}`); vals.push(aiResult.confidence);
      vals.push(f.contract_id);
      await query(`UPDATE contract SET ${updates.join(", ")} WHERE id = $${idx}`, vals);
      stats.contractUpdated++;

      console.log(`  ${logPrefix} ✅ ocr=${fullText.length} chars, ai抽取ok, 同步 ${updates.length} 字段`);
    } catch (e: any) {
      console.error(`  ${logPrefix} ❌ 失败: ${e.message}`);
      stats.aiFail++;
    }
  }

  // 并发执行 + 进度报告
  const inProgress = new Set<Promise<void>>();
  let done = 0;
  const startedAt = Date.now();

  while (queue.length > 0 || inProgress.size > 0) {
    while (queue.length > 0 && inProgress.size < CONCURRENCY) {
      const f = queue.shift();
      const p = processFile(f).finally(() => {
        inProgress.delete(p);
        done++;
        if (done % 10 === 0) {
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = done / elapsed;
          const remain = (stats.total - done) / rate;
          console.log(`\n📈 进度 ${done}/${stats.total} (${(done * 100 / stats.total).toFixed(1)}%) | ${rate.toFixed(2)}/s | 剩余 ~${Math.round(remain)}s\n`);
        }
      });
      inProgress.add(p);
    }
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }

  const totalSec = (Date.now() - stats.startedAt) / 1000;

  console.log("\n============================================================");
  console.log("✅ 完成");
  console.log("============================================================");
  console.log(`总文件: ${stats.total}`);
  console.log(`OCR 成功: ${stats.ocrOk} | OCR 失败: ${stats.ocrFail} | 跳过（无文本）: ${stats.skippedNoText}`);
  console.log(`AI 抽取成功: ${stats.aiOk} | AI 抽取失败: ${stats.aiFail}`);
  console.log(`contract 同步: ${stats.contractUpdated} 条`);
  console.log(`总耗时: ${totalSec.toFixed(0)}s`);

  console.log("\n=== 抽样对比（前 5 条） ===");
  for (const s of samples) {
    console.log(`\n📋 ${s.name}`);
    console.log(`   OCR 长度: ${s.oldLen} → ${s.newLen} (+${s.newLen - s.oldLen})`);
    console.log(`   合同编号: ${s.extracted.合同编号 || "(null)"}`);
    console.log(`   联系人: ${s.extracted.联系人 || "(null)"} | 电话: ${s.extracted.联系电话 || "(null)"}`);
    console.log(`   签订日期: ${s.extracted.签订日期 || "(null)"} | 金额: ${s.extracted.合同金额 || "(null)"}`);
  }
}

main().catch(e => {
  console.error("💥 崩溃:", e);
  process.exit(1);
});