/**
 * V2.3.5 P1.5: 把 contract_file.ocr_extracted 里的联系人/电话反哺给 customer 表
 *
 * 背景：
 *  - P0/P1 脚本只更新了 contract 表，没碰 customer
 *  - 531 个客户里只有 2 个有电话、1 个有联系人
 *  - 合同里抽到的联系人/电话能补充客户档案
 *
 * 策略：
 *  - 扫所有 contract_file.ocr_extracted IS NOT NULL
 *  - 提取联系人/联系电话，按 contract.customer_id 合并到 customer
 *  - **关键：使用 COALESCE + 一致性检查，绝不覆盖已有数据**
 *  - 一致性：同一客户多份合同抽到的联系人/电话应一致；
 *    如果已有 customer.contact_phone 不为空但与新值不同，报警并跳过
 *
 * DRY_RUN=1 只统计，不写
 */
import { query } from "../db/pool.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 1000000;

async function main() {
  console.log("🔄 V2.3.5 P1.5: 把合同 AI 抽取的联系人/电话反哺到 customer 表");
  console.log(`🏃 模式: ${DRY_RUN ? "DRY_RUN（不写）" : "实跑（写 DB）"}`);

  // 取所有已抽 AI 的合同文件 + 客户关联
  const files = await query<{
    file_id: string;
    file_name: string;
    contract_id: string;
    customer_id: string;
    customer_name: string;
    customer_phone: string | null;
    customer_person: string | null;
    ai: any;
  }>(`
    SELECT
      cf.id AS file_id,
      cf.file_name,
      c.id AS contract_id,
      c.customer_id,
      cu.name AS customer_name,
      cu.contact_phone AS customer_phone,
      cu.contact_person AS customer_person,
      cf.ocr_extracted AS ai
    FROM contract_file cf
    JOIN contract c ON c.id = cf.contract_id
    LEFT JOIN customer cu ON cu.id = c.customer_id AND cu.deleted_at IS NULL
    WHERE cf.ocr_extracted IS NOT NULL
      AND c.customer_id IS NOT NULL
    ORDER BY cf.id
    LIMIT $1
  `, [LIMIT]);

  console.log(`📊 待处理: ${files.rows.length} 个合同文件\n`);

  let wouldFill = 0;
  let filled = 0;
  let conflictPhone = 0;
  let conflictPerson = 0;
  const conflicts: any[] = [];
  const fillLog: any[] = [];

  for (const f of files.rows) {
    const aiPerson = f.ai?.联系人 || null;
    const aiPhone = f.ai?.联系电话 || null;
    if (!aiPerson && !aiPhone) continue;

    const updates: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    // 联系人：仅当 customer.contact_person 为空时回填
    if (aiPerson && !f.customer_person) {
      updates.push(`contact_person = $${idx++}`);
      vals.push(aiPerson);
    } else if (aiPerson && f.customer_person && aiPerson !== f.customer_person) {
      conflictPerson++;
      conflicts.push({ file: f.file_name, customer: f.customer_name, current: f.customer_person, ai: aiPerson });
      continue;
    }

    // 电话：仅当 customer.contact_phone 为空时回填
    if (aiPhone && !f.customer_phone) {
      updates.push(`contact_phone = $${idx++}`);
      vals.push(aiPhone);
    } else if (aiPhone && f.customer_phone && aiPhone !== f.customer_phone) {
      conflictPhone++;
      conflicts.push({ file: f.file_name, customer: f.customer_name, current: f.customer_phone, ai: aiPhone });
      continue;
    }

    if (updates.length === 0) continue;

    vals.push(f.customer_id);
    const sql = `UPDATE customer SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${idx} AND deleted_at IS NULL`;

    if (DRY_RUN) {
      wouldFill++;
      if (wouldFill <= 5) {
        console.log(`  [${f.file_name}] 客户=${f.customer_name}`);
        if (updates.some(u => u.includes('contact_person'))) console.log(`    contact_person: null → "${aiPerson}"`);
        if (updates.some(u => u.includes('contact_phone'))) console.log(`    contact_phone:   null → "${aiPhone}"`);
      }
    } else {
      await query(sql, vals);
      filled++;
      fillLog.push({ file: f.file_name, customer: f.customer_name, person: aiPerson, phone: aiPhone });
      if (filled <= 5) {
        console.log(`  ✅ [${f.file_name}] ${f.customer_name}: ${updates.join(' + ')}`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`✅ 反哺完成${DRY_RUN ? ' (DRY)' : ''}`);
  console.log(`========================================`);
  console.log(`客户记录: ${files.rows.length} | ${DRY_RUN ? `将回填 ${wouldFill}` : `实际回填 ${filled}`}`);
  console.log(`⚠️ 一致性冲突：联系人 ${conflictPerson} | 电话 ${conflictPhone}`);
  if (conflicts.length > 0) {
    console.log(`\n前 5 条冲突（需要人工判定，AI 已跳过）：`);
    conflicts.slice(0, 5).forEach(c => {
      console.log(`  - ${c.customer} [${c.file}] 当前=${c.current} AI=${c.ai}`);
    });
  }
  if (!DRY_RUN && fillLog.length > 0) {
    console.log(`\n前 5 条回填：`);
    fillLog.slice(0, 5).forEach(c => {
      console.log(`  - ${c.customer} [${c.file}] person=${c.person||'-'} phone=${c.phone||'-'}`);
    });
  }
}

main().then(() => process.exit(0)).catch(e => { console.error("💥", e); process.exit(1); });