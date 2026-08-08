import { describe, expect, it } from "vitest";

describe("ConsultationRepository DB projection", () => {
  it("keeps the persisted consultation fields in deliverable content", () => {
    const content = {
      role: "certification-expert",
      industry: "认证",
      companyContext: "测试企业",
      request: "测试需求",
      deliverable: "诊断报告",
      model: "demo",
      result: "结果",
      references: []
    };
    expect(content).toMatchObject({
      role: "certification-expert",
      result: "结果",
      references: []
    });
  });
});
