import path from "path";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { getEmployee } from "../employees/employee.service.js";
import { KnowledgeRepository } from "../knowledge/knowledge.repository.js";
import { searchKnowledge } from "../knowledge/retrieval.service.js";
import { generateWithModel } from "../models/model.gateway.js";
import { JsonStore } from "../shared/json-store.js";
import { NotFoundError } from "../shared/errors.js";
import { ConsultationRepository } from "./consultation.repository.js";
import type {
  ConsultationInput,
  ConsultationRecord
} from "../shared/types.js";

export class ConsultationService {
  // 保留文件 fallback（仅在 DB 不可用时）
  private readonly fileStore = new JsonStore<ConsultationRecord[]>(
    path.join(config.dataDir, "consultations.json"),
    []
  );

  constructor(
    private readonly knowledgeRepository: KnowledgeRepository,
    private readonly consultationRepository: ConsultationRepository
  ) {}

  /** 列出历史咨询 */
  async list(companyId: string): Promise<ConsultationRecord[]> {
    if (this.consultationRepository["useDb"]) {
      return await this.consultationRepository.list(companyId);
    }
    return await this.fileStore.read();
  }

  async getById(companyId: string, id: string): Promise<ConsultationRecord> {
    const record = this.consultationRepository["useDb"]
      ? await this.consultationRepository.getById(companyId, id)
      : (await this.fileStore.read()).find((r) => r.id === id) ?? null;
    if (!record) throw new NotFoundError("咨询记录");
    return record;
  }

  async create(companyId: string, userId: string, input: ConsultationInput) {
    const employee = getEmployee(input.role);
    const knowledgeCategories =
      employee.knowledgeCategories && employee.knowledgeCategories !== "all"
        ? employee.knowledgeCategories
        : undefined;
    const knowledge = searchKnowledge(
      `${input.industry} ${input.companyContext} ${input.request}`,
      await this.knowledgeRepository.list(companyId),
      { categories: knowledgeCategories }
    );
    const result = await generateWithModel(input.model, { input, knowledge });
    const record: ConsultationRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      result,
      references: knowledge.map(({ id, title, category }) => ({ id, title, category }))
    };

    // 优先写 DB
    if (this.consultationRepository["useDb"]) {
      try {
        await this.consultationRepository.create(companyId, userId, {
          ...input,
          id: record.id,
          createdAt: record.createdAt,
          result: record.result,
          references: record.references
        });
        return record;
      } catch (err) {
        console.warn("DB write failed, fallback to JSON:", err);
      }
    }

    // 文件 fallback
    const records = await this.fileStore.read();
    records.unshift(record);
    await this.fileStore.write(records.slice(0, 100));
    return record;
  }
}
