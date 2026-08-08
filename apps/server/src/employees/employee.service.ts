import type { EmployeeRole } from "../shared/types.js";

export interface EmployeeDefinition {
  id: EmployeeRole;
  name: string;
  title: string;
  description: string;
  capabilities: string[];
  deliverables: string[];
  /**
   * 限定该员工可访问的知识库分类（按 knowledge.json 的 category 字段过滤）
   * - undefined 或 "all"：可访问全部知识（默认）
   * - string[]：仅检索列出的 category
   */
  knowledgeCategories?: string[] | "all";
}

export const employees: EmployeeDefinition[] = [
  {
    id: "consultant",
    name: "数字化咨询顾问",
    title: "诊断现状，规划数字化与 AI 建设路径",
    description: "面向企业管理者梳理业务问题、能力差距、优先级和分阶段路线。",
    capabilities: ["数字化诊断", "AI 建设建议", "技术路线规划"],
    deliverables: ["咨询建议", "诊断报告", "实施路线图"],
    knowledgeCategories: "all"
  },
  {
    id: "solution-engineer",
    name: "方案工程师",
    title: "把咨询结论转化为可实施方案",
    description: "形成技术架构、建设内容、实施计划、投资边界和验收指标。",
    capabilities: ["技术方案", "建设方案", "项目建议书"],
    deliverables: ["数字化建设方案", "AI 应用方案", "数字孪生方案"],
    knowledgeCategories: "all"
  },
  {
    id: "trainer",
    name: "培训讲师",
    title: "将知识组织成课程、案例与实训",
    description: "根据对象、时长和目标生成课程结构、讲稿、案例及练习。",
    capabilities: ["课程设计", "培训内容", "案例生成"],
    deliverables: ["培训大纲", "培训讲稿", "教学案例"],
    knowledgeCategories: "all"
  },
  {
    id: "knowledge-assistant",
    name: "知识助手",
    title: "检索知识，解读政策与分析文档",
    description: "从企业知识库中寻找依据，回答行业、政策和技术问题。",
    capabilities: ["行业问答", "政策解读", "文档分析"],
    deliverables: ["问答结论", "文档摘要", "依据清单"],
    knowledgeCategories: "all"
  },
  {
    id: "certification-expert",
    name: "认证专家",
    title: "认证体系咨询与方案设计",
    description: "针对 ISO 9001/14001/45001/27001/HACCP 等认证体系，提供选型建议、体系诊断、审核准备和多体系套报方案。基于中认认证宁夏分公司 15 年认证咨询实战经验。",
    capabilities: ["认证体系选型", "体系诊断", "审核准备", "多体系套报", "证书续约规划", "审核员配置"],
    deliverables: ["认证方案", "体系诊断报告", "审核准备清单", "续约规划", "报价建议"],
    /**
     * 认证专家专用知识库：
     * - 01-认证体系（认证机构与标准）
     * - 02-客户合同（认证客户档案）
     * - 04-认证标准（认证体系知识/法规）
     */
    knowledgeCategories: ["01-认证体系", "02-客户合同", "04-认证标准"]
  }
];

export function getEmployee(role: EmployeeRole): EmployeeDefinition {
  return employees.find((employee) => employee.id === role)!;
}
