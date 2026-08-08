/**
 * 把现有 knowledge.json 迁移到 PostgreSQL
 * - 一次性脚本
 * - 已有数据跳过（按 doc_code UNIQUE）
 */
import path from "path";
import fs from "fs/promises";
import { query } from "../db/pool.js";
import { config } from "../config.js";

interface LegacyItem {
  id: string;
  title: string;
  category: string;
  sourceName?: string;
  fileType?: string;
  createdAt: string;
  tags?: string[];
  content: string;
}

const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

async function loadLegacy(): Promise<LegacyItem[]> {
  const p = path.join(config.dataDir, "knowledge.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as LegacyItem[];
  } catch (e) {
    console.warn("No legacy knowledge.json found, nothing to migrate.");
    return [];
  }
}

export async function migrateKnowledgeToDb(): Promise<{ inserted: number; skipped: number }> {
  const items = await loadLegacy();
  let inserted = 0;
  let skipped = 0;

  for (const it of items) {
    try {
      await query(
        `INSERT INTO knowledge_document
          (company_id, doc_code, title, category, subcategory, file_type,
           content_text, source, status, tags, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (company_id, doc_code) DO NOTHING`,
        [
          DEFAULT_COMPANY_ID,
          it.id,
          it.title,
          it.category ?? "未分类",
          null,
          it.fileType ?? "markdown",
          it.content,
          it.sourceName ?? "导入数据",
          "active",
          it.tags ?? [],
          it.createdAt ? new Date(it.createdAt) : new Date(),
          new Date(),
        ]
      );
      inserted += 1;
    } catch (err) {
      console.warn(`Skip ${it.id}: ${(err as Error).message}`);
      skipped += 1;
    }
  }

  return { inserted, skipped };
}

// CLI 入口（独立运行）
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const r = await migrateKnowledgeToDb();
    console.log(`Migrated: ${r.inserted} inserted, ${r.skipped} skipped`);
    process.exit(0);
  })();
}
