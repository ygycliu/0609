/**
 * 修补未抽取成功的模板（HZCX-01-3-D2 和 ZRC-B104-D）
 * 使用更简单的 prompt 重新抽取
 */
import { TemplateRepository } from "../templates/template.repository.js";
import { extractSchemaFromDocx } from "../templates/template.extractor.js";
import { query } from "../db/pool.js";

async function main() {
  const repo = new TemplateRepository();
  const companyId = "00000000-0000-0000-0000-000000000001";

  const targets = [
    {
      code: "HZCX-01-3-D2",
      file: "/opt/ai-consulting-center/data/templates/HZCX-01-3-D2.docx"
    },
    {
      code: "ZRC-B104-D",
      file: "/opt/ai-consulting-center/data/templates/ZRC-B104-D.docx"
    }
  ];

  for (const t of targets) {
    console.log(`\n🔧 修补: ${t.code}`);

    // 取现有
    const existing = await repo.getByCode(companyId, t.code);
    if (!existing) {
      console.log(`   ⚠️ 不存在`);
      continue;
    }

    // 重新抽取
    console.log(`   ⏳ AI 抽取...`);
    const { text, schema } = await extractSchemaFromDocx(t.file);
    console.log(`   📝 文本长度: ${text.length}`);
    console.log(`   📋 类型: ${schema.contract_type}`);
    console.log(`   📑 章节: ${schema.chapter_count}`);

    if (schema.chapter_count === 0) {
      console.log(`   ⚠️ 仍未抽取到章节，跳过`);
      continue;
    }

    // 更新
    const updated = await repo.update(companyId, existing.id, {
      chapterCount: schema.chapter_count,
      fieldSchema: schema.field_mapping,
      chapterSchema: { chapters: schema.chapters }
    });
    if (updated) {
      console.log(`   ✅ 更新成功`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error("❌ 失败:", err);
  process.exit(1);
});