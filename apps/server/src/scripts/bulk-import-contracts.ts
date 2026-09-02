/**
 * V2.2 完整模式批量导入：1061 个历史合同
 *
 * 流程：
 *  1. 扫描 /mnt/renz/19.认证合同/ 全部 PDF/DOC/DOCX
 *  2. 并行处理（默认 3 个 worker）：
 *     - 计算文件 hash，跳过已入库
 *     - OCR 提取文本（前 2 页，节省时间）
 *     - AI 抽取（qwen2.5:7b）：编号/客户名/金额/乙方主体
 *     - 客户智能匹配（DB 已有 + 别名）
 *     - 入库 contract + contract_file
 *  3. 进度报告（每 10 条输出一次）
 *  4. 错误记录到 /tmp/bulk-import-errors.log
 *
 * 性能估算：
 *  - 1061 文件 × 5 秒/文件 = 88 分钟（单线程）
 *  - 3 并行 ≈ 30 分钟
 *
 * 用法：
 *  - 跑全部：npx tsx src/scripts/bulk-import-contracts.ts
 *  - 限制数量：npx tsx src/scripts/bulk-import-contracts.ts 100
 *  - 设置并行：WORKERS=5 npx tsx src/scripts/bulk-import-contracts.ts
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { ContractRepository } from "../contracts/contract.repository.js";
import { extractContractFields, extractFromFile, getFileType, extractText as extractTextFromFile } from "../contracts/contract.extractor.js";
import { findCustomerByName } from "../contracts/customer.matcher.js";
import { query } from "../db/pool.js";

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await query<any>(sql, params);
  return r.rows[0] || null;
}

const execAsync = promisify(execFile);

const BASE_DIR = "/mnt/renz/19.认证合同/";
const REPORT_FILE = "/tmp/bulk-import-report.json";
const ERROR_LOG = "/tmp/bulk-import-errors.log";

interface FileStats {
  total: number;
  byYear: Record<string, number>;
  byType: Record<string, number>;
  processed: number;
  skipped: number;
  errors: number;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

/** 解析文件名 → 年份 + 编号 + 客户名 */
function parseFilename(filename: string) {
  const yearMatch = filename.match(/^(20\d{2})/);
  const year = yearMatch ? yearMatch[1] : null;

  const numMatch = filename.match(/^(20\d{2})[-_]([\d-]+)/);
  let number = null;
  if (numMatch) {
    number = numMatch[2].replace(/^[-]+|[-]+$/g, "");
    if (!/^\d+$/.test(number)) number = null;
  }

  const types: string[] = [];
  if (/QES|三体系/.test(filename)) types.push("QES");
  if (/QJES/.test(filename)) types.push("QJES");
  if (/Q初审|初次/.test(filename)) types.push("first_audit");
  if (/监督|监审|年检/.test(filename)) types.push("supervision");
  if (/再认证|再认/.test(filename)) types.push("recertification");
  if (/补充协议|补充合同|更改/.test(filename)) types.push("supplement");
  if (/外协/.test(filename)) types.push("external");
  if (/协议/.test(filename) && types.length === 0) types.push("agreement");

  let customerGuess = filename.replace(/\.[^.]+$/, "");
  customerGuess = customerGuess.replace(/^20\d{2}[-_]?\d*[-_]*/, "");
  customerGuess = customerGuess.replace(/(QES|QJES|Q初审|初次|监督|监审|年检|再认证|再认|补充协议|补充合同|更改|外协|协议|认证合同书|合同书|合同)/g, "");
  customerGuess = customerGuess.replace(/[-_、，,。\s]+/g, " ").trim();
  customerGuess = customerGuess.replace(/^[\d\s-]+/, "").trim();

  return { year, number, types, customerGuess };
}

/** 计算文件 hash（用于去重） */
async function fileHash(filepath: string): Promise<string> {
  const buffer = await fs.readFile(filepath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** OCR/DOC 提取文本（限制页数，节省时间） */
async function extractText(filepath: string, maxPages = 2): Promise<string> {
  const ext = path.extname(filepath).toLowerCase();
  try {
    if (ext === ".pdf") {
      const { stdout } = await execAsync("pdftotext", [
        "-l", String(maxPages),
        filepath, "-"
      ], { maxBuffer: 5 * 1024 * 1024 });
      return stdout;
    } else if (ext === ".doc") {
      const { stdout } = await execAsync("antiword", [filepath], { maxBuffer: 5 * 1024 * 1024 });
      return stdout;
    } else if (ext === ".docx") {
      const { stdout } = await execAsync("python3", [
        "-c", `import sys; from docx import Document; print('\\n'.join(p.text for p in Document('${filepath}').paragraphs))`
      ], { maxBuffer: 5 * 1024 * 1024 });
      return stdout;
    }
  } catch (e) {
    // fallback
  }
  return "";
}

interface ProcessResult {
  file: string;
  relPath: string;
  year: string | null;
  number: string | null;
  types: string[];
  customerGuess: string;
  customerMatched: string | null;
  matchedCustomerId: string | null;
  matchConfidence: number;
  contractNo: string | null;
  totalAmount: number | null;
  signingEntity: string | null;
  status: "imported" | "skipped_duplicate" | "error" | "skipped_existing";
  contractId?: string;
  error?: string;
  durationMs: number;
}

/** 处理单个文件 */
async function processFile(
  filepath: string,
  repo: ContractRepository,
  stats: FileStats
): Promise<ProcessResult> {
  const t0 = Date.now();
  const filename = path.basename(filepath);
  const relPath = filepath.replace(BASE_DIR, "");

  try {
    // 1. 解析文件名
    const parsed = parseFilename(filename);

    // 2. 计算 hash
    const hash = await fileHash(filepath);

    // 2.5 预解析 companyId（重复检测也要用）
    const companyId = (await queryOne<any>(
      `SELECT id FROM company WHERE name = '华中国际认证检验集团有限公司' OR name LIKE '%华中%' LIMIT 1`
    ))?.id || (await queryOne<any>(`SELECT id FROM company LIMIT 1`))?.id || "00000000-0000-0000-0000-000000000001";

    // 3. 检查是否已存在（按 hash 或 contract_no）
    const existing = await queryOne<any>(
      `SELECT cf.contract_id, c.id, c.contract_no FROM contract_file cf
       JOIN contract c ON cf.contract_id = c.id
       WHERE cf.sha256 = $1 LIMIT 1`,
      [hash]
    );
    if (existing) {
      return {
        file: filename, relPath,
        ...parsed,
        customerMatched: null, matchedCustomerId: null, matchConfidence: 0,
        contractNo: existing.contract_no, totalAmount: null, signingEntity: null,
        status: "skipped_existing",
        contractId: existing.id,
        durationMs: Date.now() - t0
      };
    }

    // 3.5 检查合同号 + 客户是否已存在（防止重复）
    if (parsed.number && parsed.year) {
      const dupContract = await queryOne<any>(
        `SELECT id, created_at FROM contract
         WHERE company_id = $1 AND contract_no = $2 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [companyId, `${parsed.year}-${parsed.number}`]
      );
      if (dupContract) {
        // 按"最后时间为准"保留最新 - 软删旧的
        await query(
          `UPDATE contract SET deleted_at = NOW(),
             notes = COALESCE(notes,'') || E'\n[自动清理 ' || NOW()::text || '] 重复合同号被新版本替代'
           WHERE contract_no = $1 AND company_id = $2 AND deleted_at IS NULL
             AND id != $3`,
          [`${parsed.year}-${parsed.number}`, companyId, dupContract.id]
        );
      }
    }

    // 4. OCR 提取文本（仅前 2 页）
    const text = await extractText(filepath, 2);

    // 6. 客户匹配（先用文件名猜，再 AI）
    let customerMatched = null;
    let matchedCustomerId = null;
    let matchConfidence = 0;

    if (parsed.customerGuess && parsed.customerGuess.length >= 4) {
      const m = await findCustomerByName(companyId, parsed.customerGuess);
      if (m && m.customer) {
        customerMatched = m.customer.name;
        matchedCustomerId = m.customer.id;
        matchConfidence = m.confidence || 0;
      }
    }

    // 7. AI 抽取（使用简化的 prompt 加快速度）
    let aiResult: any = null;
    if (text && text.length > 100) {
      try {
        // 用已经 OCR 出的 text 直接给 AI
        aiResult = await extractContractFields(text);
      } catch (e) {
        // AI 失败也继续，文件名解析可能够用
      }
    }

    // 8. 客户匹配（AI 抽取后，再试一次）
    if (!matchedCustomerId && aiResult?.customer_name && aiResult.customer_name.length >= 4) {
      const m = await findCustomerByName(companyId, aiResult.customer_name);
      if (m && m.customer) {
        customerMatched = m.customer.name;
        matchedCustomerId = m.customer.id;
        matchConfidence = Math.max(matchConfidence, m.confidence || 0);
      }
    }

    // 8. 文件保存到 uploads 目录
    const uploadsDir = process.env.UPLOADS_DIR || "/opt/ai-consulting-center/data/uploads";
    const uploadDir = path.join(uploadsDir, "contracts", "historical", parsed.year || "unknown");
    await fs.mkdir(uploadDir, { recursive: true });
    const newFilename = `${hash.slice(0, 16)}_${filename}`;
    const destPath = path.join(uploadDir, newFilename);
    await fs.copyFile(filepath, destPath);

    // 9. 入库 contract
    const contractNo = aiResult?.contract_no ||
      (parsed.year && parsed.number ? `${parsed.year}-${parsed.number}` :
       parsed.year ? `HIST-${parsed.year}-${Date.now()}` :
       `HIST-UNKNOWN-${Date.now()}`);

    // 推断乙方主体
    let signingEntityId = null;
    if (/华中|集团|总部/.test(relPath) || /华中/.test(text.slice(0, 1000))) {
      const e = await queryOne<any>(`SELECT id FROM signing_entity WHERE entity_code = 'A' LIMIT 1`);
      signingEntityId = e?.id;
    } else if (/中认/.test(relPath) || /中认/.test(text.slice(0, 1000))) {
      const e = await queryOne<any>(`SELECT id FROM signing_entity WHERE entity_code = 'B' LIMIT 1`);
      signingEntityId = e?.id;
    } else if (/外协|认证中心|认证有限公司$/.test(text.slice(0, 1000))) {
      const e = await queryOne<any>(`SELECT id FROM signing_entity WHERE entity_code = 'C' LIMIT 1`);
      signingEntityId = e?.id;
    }
    if (!signingEntityId) {
      // 默认华中集团（历史合同主要签约方）
      const e = await queryOne<any>(`SELECT id FROM signing_entity WHERE entity_code = 'A' LIMIT 1`);
      signingEntityId = e?.id;
    }

    // 推断合同类型
    let contractType = "main";
    if (parsed.types.includes("supplement")) contractType = "supplement";
    else if (parsed.types.includes("external")) contractType = "external";
    else if (parsed.types.includes("supervision")) contractType = "supervision";
    else if (parsed.types.includes("recertification")) contractType = "recertification";

    // 兜底：如果客户未匹配，用占位客户"待匹配客户"
    let finalCustomerId = matchedCustomerId;
    if (!finalCustomerId) {
      const placeholder = await queryOne<any>(
        `SELECT id FROM customer WHERE customer_code = 'PLACEHOLDER' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (placeholder) {
        finalCustomerId = placeholder.id;
      } else {
        // 创建占位客户
        const newPlaceholder = await queryOne<any>(
          `INSERT INTO customer (company_id, customer_code, name, status, notes)
           VALUES ($1, 'PLACEHOLDER', '待匹配客户', 'archived', '批量导入时未匹配到实际客户')
           RETURNING id`,
          [companyId]
        );
        finalCustomerId = newPlaceholder?.id;
      }
    }

    // 推断签订日期
    let signingDate = null;
    if (aiResult?.signed_at) {
      signingDate = aiResult.signed_at;
    } else if (parsed.year) {
      signingDate = `${parsed.year}-01-01`;
    }

    const newContractId = await queryOne<any>(
      `INSERT INTO contract (
        company_id, contract_no, contract_type, status,
        customer_id, signing_entity_id,
        contract_amount, signed_at,
        source, notes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, 'pdf_import', $8, NOW(), NOW())
      RETURNING id`,
      [
        companyId,
        contractNo,
        contractType,
        finalCustomerId,
        signingEntityId,
        aiResult?.total_amount || 0,
        signingDate,
        `从 /mnt/renz/19.认证合同/ 批量导入\n原文件名: ${filename}\n年份: ${parsed.year || "?"}\n编号: ${parsed.number || "?"}\nAI 抽取客户: ${aiResult?.customer_name || "无"}`
      ]
    );

    // 10. 记录 contract_file + 获取 id 回写到 contract.file_id
    const newFile = await queryOne<any>(
      `INSERT INTO contract_file (
        company_id, contract_id, file_name, file_type,
        storage_path, file_size, sha256, ocr_text, ocr_extracted,
        ocr_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed')
      RETURNING id`,
      [
        companyId,
        newContractId.id,
        filename,
        path.extname(filepath).slice(1),
        destPath,
        (await fs.stat(filepath)).size,
        hash,
        text.slice(0, 5000),
        aiResult ? JSON.stringify(aiResult) : null
      ]
    );

    // 10.5 回写 file_id 到 contract（这样列表页能显示预览链接）
    if (newFile?.id) {
      await query(
        `UPDATE contract SET file_id = $1, updated_at = NOW() WHERE id = $2`,
        [newFile.id, newContractId.id]
      );
    }

    // 10.6 把 AI 抽取结果也存到 contract.raw_extracted（统一来源）
    if (aiResult && typeof aiResult === "object") {
      await query(
        `UPDATE contract SET raw_extracted = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(aiResult), newContractId.id]
      );
    }

    // 11. 记录别名
    if (matchedCustomerId && aiResult?.customer_name && aiResult.customer_name !== customerMatched) {
      try {
        await query(
          `INSERT INTO customer_alias (company_id, customer_id, alias_name, source, match_count)
           VALUES ($1, $2, $3, 'bulk_import', 1)
           ON CONFLICT (customer_id, alias_name) DO NOTHING`,
          [companyId, matchedCustomerId, aiResult.customer_name]
        );
      } catch (e) {/* 重复也没关系 */}
    }

    return {
      file: filename, relPath,
      ...parsed,
      customerMatched, matchedCustomerId, matchConfidence,
      contractNo,
      totalAmount: aiResult?.total_amount || null,
      signingEntity: aiResult?.signing_entity || null,
      status: "imported",
      contractId: newContractId.id,
      durationMs: Date.now() - t0
    };

  } catch (e: any) {
    return {
      file: filename, relPath,
      year: null, number: null, types: [], customerGuess: "",
      customerMatched: null, matchedCustomerId: null, matchConfidence: 0,
      contractNo: null, totalAmount: null, signingEntity: null,
      status: "error",
      error: e.message,
      durationMs: Date.now() - t0
    };
  }
}

/** 主函数 */
async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : null;
  const workers = parseInt(process.env.WORKERS || "3");

  console.log("🚀 启动批量导入（完整模式）");
  console.log(`📂 扫描目录: ${BASE_DIR}`);
  console.log(`🧵 并行 worker: ${workers}`);
  if (limit) console.log(`⏱️  限制数量: ${limit}`);
  console.log("");

  const repo = new ContractRepository();

  // 收集所有文件
  const allFiles: string[] = [];
  for (const ext of ["*.pdf", "*.doc", "*.docx"]) {
    const process = await import("node:child_process");
    const { exec } = process;
    const { stdout } = await promisify(exec)(
      `find "${BASE_DIR}" -type f \\( -name "*.pdf" -o -name "*.doc" -o -name "*.docx" \\) -size +0c`
    );
    for (const line of stdout.trim().split("\n")) {
      if (line) allFiles.push(line);
    }
    break; // find 已经处理所有扩展名
  }

  console.log(`📊 找到 ${allFiles.length} 个文件`);
  const targetFiles = limit ? allFiles.slice(0, limit) : allFiles;
  console.log(`📦 即将处理: ${targetFiles.length} 个`);
  console.log("");

  const stats: FileStats = {
    total: targetFiles.length,
    byYear: {},
    byType: { pdf: 0, doc: 0, docx: 0 },
    processed: 0,
    skipped: 0,
    errors: 0,
    startedAt: Date.now()
  };

  const results: ProcessResult[] = [];

  // 并行处理
  const queue = [...targetFiles];
  const inProgress = new Set<Promise<void>>();

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < workers && queue.length > 0) {
      const file = queue.shift()!;
      const promise = (async () => {
        const r = await processFile(file, repo, stats);
        results.push(r);
        stats.processed++;

        if (r.status === "imported") {
          const ext = path.extname(file).slice(1).toLowerCase();
          stats.byType[ext] = (stats.byType[ext] || 0) + 1;
          if (r.year) stats.byYear[r.year] = (stats.byYear[r.year] || 0) + 1;
        } else if (r.status === "skipped_existing" || r.status === "skipped_duplicate") {
          stats.skipped++;
        } else if (r.status === "error") {
          stats.errors++;
          await fs.appendFile(ERROR_LOG, `${file}\n  ERROR: ${r.error}\n`);
        }

        // 进度报告（每 10 条）
        if (stats.processed % 10 === 0) {
          const elapsed = (Date.now() - stats.startedAt) / 1000;
          const speed = stats.processed / elapsed;
          const remaining = (stats.total - stats.processed) / speed;
          console.log(`📊 [${stats.processed}/${stats.total}] 速度 ${speed.toFixed(2)}/秒, 剩余 ${remaining.toFixed(0)}秒 (${(remaining/60).toFixed(1)}分钟)`);
          console.log(`    成功: ${stats.processed - stats.skipped - stats.errors} | 跳过: ${stats.skipped} | 错误: ${stats.errors}`);
        }
      })();
      inProgress.add(promise);
      promise.finally(() => inProgress.delete(promise));
    }
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }

  stats.finishedAt = Date.now();
  stats.durationMs = stats.finishedAt - stats.startedAt;

  // 保存报告
  await fs.writeFile(REPORT_FILE, JSON.stringify({ stats, results }, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("✅ 批量导入完成");
  console.log("=".repeat(60));
  console.log(`📊 总数: ${stats.total}`);
  console.log(`✅ 成功: ${stats.processed - stats.skipped - stats.errors}`);
  console.log(`⏭️  跳过: ${stats.skipped}`);
  console.log(`❌ 错误: ${stats.errors}`);
  console.log(`⏱️  总耗时: ${(stats.durationMs / 1000).toFixed(1)}秒 (${(stats.durationMs / 60000).toFixed(1)}分钟)`);
  console.log(`📈 平均: ${(stats.durationMs / stats.processed).toFixed(0)}ms/文件`);
  console.log("\n📊 按年份分布:");
  for (const [year, n] of Object.entries(stats.byYear).sort()) {
    console.log(`  ${year}: ${n}`);
  }
  console.log("\n📊 按文件类型:");
  for (const [ext, n] of Object.entries(stats.byType)) {
    console.log(`  .${ext}: ${n}`);
  }
  console.log(`\n📄 报告文件: ${REPORT_FILE}`);
  console.log(`📋 错误日志: ${ERROR_LOG}`);
}

main().catch(e => {
  console.error("❌ 失败:", e);
  process.exit(1);
});