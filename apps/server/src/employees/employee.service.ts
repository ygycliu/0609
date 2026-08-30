/**
 * AI 专业员工定义（V2.0 业务主线下调整）
 *
 * 角色定位（用户确认）：
 * 1. 数字审核员：原"数字化咨询顾问"，点击跳 /auditor
 * 2. 报价员：原"方案工程师"，点击跳 /certification-quote
 * 3. 培训讲师：保留（保留角色，点击跳 /consult）
 * 4. 知识助手：保留（保留角色，点击跳 /consult）
 * 5. 认证专家：保留（保留角色，点击跳 /consult）
 *
 * 已删除：原"数字审核员"（重复）
 *
 * 跳转逻辑：见 frontend OverviewPage 的 employee-grid 渲染
 */

export type EmployeeRole =
  | "trainer"
  | "knowledge-assistant"
  | "certification-expert";

export interface EmployeeDefinition {
  id: EmployeeRole;
  /** 员工角色名称（中文） */
  name: string;
  /** 简短描述（页面卡片显示） */
  title: string;
  /** 详细描述 */
  description?: string;
  /** 能力清单 */
  capabilities: string[];
  /** 交付物清单 */
  deliverables?: string[];
  /**
   * 限定该员工可访问的知识库分类（按 knowledge.json 的 category 字段过滤）
   * - undefined 或 "all"：可访问全部知识（默认）
   */
  knowledgeCategories?: string[] | "all";
  /**
   * 点击该员工卡片跳转的页面（业务功能入口）
   * - undefined：跳转到咨询页（通用）
   */
  navigateTo?:
    | "auditor"
    | "certification-quote"
    | "consult"
    | "knowledge"
    | "files";
}

export const employees: EmployeeDefinition[] = [
  // V2.0 简化：只保留 3 个 AI 咨询角色
  {
    id: "trainer",
    name: "培训讲师",
    title: "将知识组织成课程、案例与实训",
    description: "根据对象、时长和目标生成课程结构、讲稿、案例及练习。",
    capabilities: ["课程设计", "培训内容", "案例生成"],
    deliverables: ["培训大纲", "培训讲稿", "教学案例"],
    knowledgeCategories: "all",
    navigateTo: "consult"
  },
  {
    id: "knowledge-assistant",
    name: "知识助手",
    title: "检索知识，解读政策与分析文档",
    description: "从企业知识库中寻找依据，回答行业、政策和技术问题。",
    capabilities: ["行业问答", "政策解读", "文档分析"],
    deliverables: ["问答结论", "文档摘要", "依据清单"],
    knowledgeCategories: "all",
    navigateTo: "consult"
  },
  {
    id: "certification-expert",
    name: "认证专家",
    title: "认证体系咨询与方案设计",
    description: "针对 ISO 9001/14001/45001/27001/HACCP 等认证体系，提供选型建议、体系诊断、审核准备和多体系套报方案。基于中认认证宁夏分公司 15 年认证咨询实战经验。",
    capabilities: [
      "认证体系选型",
      "体系诊断",
      "审核准备",
      "多体系套报",
      "证书续约规划",
      "审核员配置"
    ],
    deliverables: [
      "认证方案",
      "体系诊断报告",
      "审核准备清单",
      "续约规划",
      "报价建议"
    ],
    /**
     * 认证专家专用知识库：
     * - 01-认证体系（认证机构与标准）
     * - 02-客户合同（认证客户档案）
     * - 04-认证标准（认证体系知识/法规）
     */
    knowledgeCategories: [
      "01-认证体系",
      "02-客户合同",
      "04-认证标准"
    ],
    navigateTo: "certification-quote"  // 认证专家直达认证报价（认证方案 + 报价建议）
  }
];

export function getEmployee(role: EmployeeRole): EmployeeDefinition {
  return employees.find((employee) => employee.id === role)!;
}
