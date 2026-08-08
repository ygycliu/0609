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
            id: "consultant",
            name: "数字化咨询顾问",
            title: "规划建设路径",
            description: "诊断企业现状",
            capabilities: ["数字化诊断"],
            deliverables: ["咨询报告"]
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
    expect(screen.getByText("数字化咨询顾问")).toBeInTheDocument();
    expect(screen.getByText("AI 专业角色")).toBeInTheDocument();
  });
});
