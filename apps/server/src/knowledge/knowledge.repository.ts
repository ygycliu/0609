import path from "path";
import { config } from "../config.js";
import { JsonStore } from "../shared/json-store.js";
import { query, pingDatabase } from "../db/pool.js";
import type { KnowledgeItem } from "../shared/types.js";

const seedKnowledge: KnowledgeItem[] = [
  {
    id: "kb-digital-roadmap",
    title: "企业数字化转型路线设计要点",
    category: "03-数字化咨询",
    sourceName: "内置方法论",
    fileType: "markdown",
    createdAt: "2026-07-27T00:00:00.000Z",
    tags: ["数字化转型", "路线图", "诊断"],
    content:
      "数字化建设应从业务目标出发，依次完成现状诊断、场景识别、价值排序、总体架构、试点验证和规模推广。优先选择价值明确、数据可得、流程稳定的场景，并为每个阶段设置业务指标、交付物和退出条件。"
  },
  {
    id: "kb-ai-governance",
    title: "企业 AI 应用建设原则",
    category: "02-AI能力",
    sourceName: "内置方法论",
    fileType: "markdown",
    createdAt: "2026-07-27T00:00:00.000Z",
    tags: ["AI", "治理", "RAG"],
    content:
      "企业 AI 应用需要同时建设模型服务、知识库、工作流、安全治理和评估体系。知识密集型场景优先采用 RAG，关键结论必须提供来源，涉及敏感数据时采用权限隔离、脱敏、审计和人工复核。"
  },
  {
    id: "kb-twin-method",
    title: "数字孪生项目实施框架",
    category: "04-数字孪生",
    sourceName: "内置方法论",
    fileType: "markdown",
    createdAt: "2026-07-27T00:00:00.000Z",
    tags: ["数字孪生", "实施", "数据"],
    content:
      "数字孪生项目应明确对象、业务闭环和实时性要求，分层建设数据接入、对象模型、空间模型、规则算法和应用交互。MVP 应优先打通一个可验证的业务闭环，避免只建设三维展示。"
  }
];

interface DbRow {
  doc_code: string;
  title: string;
  category: string;
  source: string | null;
  file_type: string;
  content_text: string;
  tags: string[] | null;
  created_at: Date;
}

function rowToItem(r: DbRow): KnowledgeItem {
  return {
    id: r.doc_code,
    title: r.title,
    category: r.category,
    sourceName: r.source ?? "数据库",
    fileType: r.file_type,
    createdAt: r.created_at.toISOString(),
    tags: r.tags ?? [],
    content: r.content_text
  };
}

export class KnowledgeRepository {
  private readonly store = new JsonStore(
    path.join(config.dataDir, "knowledge.json"),
    seedKnowledge
  );
  private useDb = false;

  /** 初始化：探测 DB 可用性 */
  async init(): Promise<void> {
    this.useDb = await pingDatabase();
    if (this.useDb) {
      console.log("✓ KnowledgeRepository: using PostgreSQL");
    } else {
      console.warn("⚠ KnowledgeRepository: DB unreachable, fallback to JSON");
    }
  }

  async list(companyId: string): Promise<KnowledgeItem[]> {
    if (this.useDb) {
      try {
        const r = await query<DbRow>(
          `SELECT doc_code, title, category, source, file_type, content_text, tags, created_at
           FROM knowledge_document
           WHERE company_id = $1 AND deleted_at IS NULL AND status = 'active'
           ORDER BY created_at DESC`,
          [companyId]
        );
        return r.rows.map(rowToItem);
      } catch (err) {
        console.warn("DB list failed, fallback to JSON:", (err as Error).message);
      }
    }
    return this.store.read();
  }

  async add(companyId: string, item: KnowledgeItem) {
    if (this.useDb) {
      try {
        const r = await query<{ created_at: Date }>(
          `INSERT INTO knowledge_document
            (company_id, doc_code, title, category, subcategory, file_type,
             content_text, source, status, tags, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
           ON CONFLICT (company_id, doc_code) DO UPDATE
             SET title = EXCLUDED.title,
                 category = EXCLUDED.category,
                 content_text = EXCLUDED.content_text,
                 tags = EXCLUDED.tags,
                 updated_at = NOW()
           RETURNING created_at`,
          [
            companyId,
            item.id,
            item.title,
            item.category ?? "未分类",
            null,
            item.fileType ?? "markdown",
            item.content,
            item.sourceName ?? "用户添加",
            "active",
            item.tags ?? [],
          ]
        );
        return {
          ...item,
          createdAt: r.rows[0]?.created_at?.toISOString() ?? item.createdAt
        };
      } catch (err) {
        console.warn("DB add failed, fallback to JSON:", (err as Error).message);
      }
    }
    const items = await this.store.read();
    items.unshift(item);
    await this.store.write(items);
    return item;
  }

  async remove(companyId: string, id: string) {
    if (this.useDb) {
      try {
        const r = await query<{ id: string }>(
          `UPDATE knowledge_document
             SET deleted_at = NOW(), status = 'archived'
           WHERE company_id = $1 AND doc_code = $2 AND deleted_at IS NULL
           RETURNING id`,
          [companyId, id]
        );
        return r.rowCount !== null && r.rowCount > 0;
      } catch (err) {
        console.warn("DB remove failed, fallback to JSON:", (err as Error).message);
      }
    }
    const items = await this.store.read();
    const nextItems = items.filter((item) => item.id !== id);
    await this.store.write(nextItems);
    return nextItems.length !== items.length;
  }

  /** 更新（partial）*/
  async update(companyId: string, id: string, patch: Partial<KnowledgeItem>) {
    if (this.useDb) {
      try {
        const set: string[] = [];
        const params: unknown[] = [companyId, id];
        let idx = 3;
        if (patch.title !== undefined) { set.push(`title = $${idx++}`); params.push(patch.title); }
        if (patch.category !== undefined) { set.push(`category = $${idx++}`); params.push(patch.category); }
        if (patch.content !== undefined) { set.push(`content_text = $${idx++}`); params.push(patch.content); }
        if (patch.tags !== undefined) { set.push(`tags = $${idx++}`); params.push(patch.tags); }
        if (patch.sourceName !== undefined) { set.push(`source = $${idx++}`); params.push(patch.sourceName); }
        if (patch.fileType !== undefined) { set.push(`file_type = $${idx++}`); params.push(patch.fileType); }
        if (!set.length) return false;
        set.push(`updated_at = NOW()`);
        const r = await query<{ id: string }>(
          `UPDATE knowledge_document SET ${set.join(", ")}
           WHERE company_id = $1 AND doc_code = $2 AND deleted_at IS NULL
           RETURNING id`,
          params
        );
        return r.rowCount !== null && r.rowCount > 0;
      } catch (err) {
        console.warn("DB update failed, fallback to JSON:", (err as Error).message);
      }
    }
    // 文件 fallback：改文件
    const items = await this.store.read();
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    items[idx] = { ...items[idx], ...patch };
    await this.store.write(items);
    return true;
  }
}
