import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPage } from "./OverviewPage";

describe("OverviewPage", () => {
  it("展示咨询中心定位和核心指标", () => {
    render(
      <OverviewPage
        employees={[
          {
            id: "trainer",
            name: "培训讲师",
            title: "课程与案例生成",
            description: "生成课程结构",
            capabilities: ["课堂设计"],
            deliverables: ["培训大纲"],
            navigateTo: "consult"
          }
        ]}
        knowledge={[]}
        consultations={[]}
        models={[
          {
            id: "demo",
            name: "演示模型",
            available: true,
            description: "测试"
          }
        ]}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "从业务问题到可实施方案" })).toBeInTheDocument();
    expect(screen.getByText("培训讲师")).toBeInTheDocument();
    expect(screen.getByText("AI 咨询角色")).toBeInTheDocument();
  });
});
