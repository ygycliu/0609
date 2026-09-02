/**
 * V2.3 4 份合同模板入库脚本
 * 用法：npx tsx src/scripts/seed-templates.ts
 */
import { TemplateRepository } from "../templates/template.repository.js";
import { extractSchemaFromDocx } from "../templates/template.extractor.js";
import { query } from "../db/pool.js";

async function main() {
  console.log("🌱 开始入库 4 份合同模板...\n");

  const repo = new TemplateRepository();
  const companyId = "00000000-0000-0000-0000-000000000001";
  const TEMPLATES_DIR = "/opt/ai-consulting-center/data/templates";

  // 取签约主体
  const entities = await query<any>(
    `SELECT id, name, entity_code FROM signing_entity
     WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  const entityMap: Record<string, string> = {};
  for (const e of entities.rows) {
    entityMap[e.entity_code] = e.id;
    console.log(`  签约主体: ${e.entity_code} = ${e.id}`);
  }
  console.log("");

  const templates = [
    {
      file: `${TEMPLATES_DIR}/HZCX-01-3-D2.docx`,
      code: "HZCX-01-3-D2",
      name: "华中管理体系、服务认证认证合同书",
      description: "华中集团主合同：20 章详细条款，含建工/能源体系特殊要求",
      signingEntityCode: "A",
      templateCategory: "main",
      contractType: "HZCX"
    },
    {
      file: `${TEMPLATES_DIR}/ZRC-B104-D.docx`,
      code: "ZRC-B104-D",
      name: "中认认证服务合同书（监督+CNAS）",
      description: "中认认证监督审核合同：9 章简化，可带 CNAS 认可标志",
      signingEntityCode: "B",
      templateCategory: "supervision",
      contractType: "ZRC"
    },
    {
      file: `${TEMPLATES_DIR}/ZRC-B104-F.docx`,
      code: "ZRC-B104-F",
      name: "中认认证服务合同书（综合）",
      description: "中认认证综合合同：9 章简化，无认可标志",
      signingEntityCode: "B",
      templateCategory: "main",
      contractType: "ZRC"
    },
    {
      file: `${TEMPLATES_DIR}/ZRC-B104-DI.docx`,
      code: "ZRC-B104-DI",
      name: "中认认证服务合同书（监督+IAS）",
      description: "中认认证监督审核合同：9 章简化，可带 IAS 认可标志",
      signingEntityCode: "B",
      templateCategory: "supervision",
      contractType: "ZRC"
    }
  ];

  for (const t of templates) {
    console.log(`\n📄 ${t.code}: ${t.name}`);
    console.log(`   文件: ${t.file}`);

    // 检查文件
    const fs = await import("node:fs/promises");
    try {
      await fs.access(t.file);
    } catch {
      console.log(`   ❌ 文件不存在: ${t.file}`);
      continue;
    }

    // 检查是否已存在
    const existing = await repo.getByCode(companyId, t.code);
    if (existing) {
      console.log(`   ⚠️ 已存在 (id=${existing.id})，跳过`);
      continue;
    }

    // AI 抽取 schema
    console.log(`   ⏳ AI 抽取中...`);
    const { text, schema } = await extractSchemaFromDocx(t.file);
    console.log(`   📝 文本长度: ${text.length}`);
    console.log(`   📋 合同类型: ${schema.contract_type}`);
    console.log(`   📑 章节数: ${schema.chapter_count}`);
    console.log(`   🎯 置信度: ${(schema.confidence * 100).toFixed(0)}%`);

    // 入库
    const signingEntityId = entityMap[t.signingEntityCode];
    if (!signingEntityId) {
      console.log(`   ❌ 签约主体 ${t.signingEntityCode} 不存在`);
      continue;
    }

    const created = await repo.create(companyId, {
      code: t.code,
      name: t.name,
      description: t.description,
      signingEntityId,
      templateCategory: t.templateCategory as any,
      contractType: t.contractType as any,
      chapterCount: schema.chapter_count,
      fileFormat: "docx",
      templatePath: t.file,
      fieldSchema: schema.field_mapping,
      chapterSchema: { chapters: schema.chapters },
      status: "active",
      version: 1,
      createdBy: null
    });

    if (created) {
      console.log(`   ✅ 入库成功 (id=${created.id})`);

      await repo.createVersion(companyId, created.id, {
        filePath: t.file,
        fieldSchema: schema.field_mapping,
        chapterSchema: { chapters: schema.chapters },
        changeNote: "V2.3 初始入库（逆向抽取）",
        extractedFromContractId: null,
        extractionConfidence: schema.confidence
      });
      console.log(`   ✅ 版本 1 记录完成`);
    }
  }

  console.log("\n✅ 入库完成！");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ 入库失败:", err);
  process.exit(1);
});