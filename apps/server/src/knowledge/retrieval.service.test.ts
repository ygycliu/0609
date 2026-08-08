import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "../shared/types.js";
import { searchKnowledge } from "./retrieval.service.js";

const items: KnowledgeItem[] = [
  {
    id: "ai",
    title: "企业 AI 应用建设原则",
    category: "02-AI能力",
    content: "知识密集型场景优先采用 RAG，并建设模型评估和安全治理体系。",
    sourceName: "test",
    fileType: "md",
    createdAt: "2026-07-27T00:00:00.000Z",
    tags: ["AI", "RAG"]
  },
  {
    id: "twin",
    title: "数字孪生实施框架",
    category: "04-数字孪生",
    content: "分层建设数据接入、对象模型、空间模型和业务应用。",
    sourceName: "test",
    fileType: "md",
    createdAt: "2026-07-27T00:00:00.000Z",
    tags: ["数字孪生"]
  }
];

describe("searchKnowledge", () => {
  it("优先返回标题和内容更匹配的条目", () => {
    const result = searchKnowledge("如何建设企业 AI RAG 知识库", items);
    expect(result[0]?.id).toBe("ai");
  });

  it("无匹配词时不返回无关知识", () => {
    expect(searchKnowledge("财务报销流程", items)).toEqual([]);
  });
});
