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
  | "auditor-digital"
  | "quote-specialist"
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
  {
    id: "auditor-digital",
    name: "数字审核员",
    title: "QES 三体系现场审核 + 资料审核 + 材料生成",
    description: "中认认证宁夏分公司数字审核员。基于 ISO 9001:2015/14001:2015/45001:2018 全文 + ISO 19011 审核指南 + 中认内部审核作业指导书 + 20+ 客户 QES 监督完整案例。具备 QMS 主任审核员资质。能力：资料审核 → 三角验证 → 不符合项识别 → 出具 7 类认证材料（合同/计划/检查表/不符合项报告/审核报告/整改跟踪/会议议程）。",
    capabilities: [
      "QES 现场审核",
      "资料审核与三角验证",
      "不符合项识别（严重/一般/观察项）",
      "审核计划生成",
      "现场检查表生成",
      "不符合项报告生成",
      "审核报告生成",
      "首次/末次会议议程生成",
      "整改跟踪与验证",
      "ISO 9001/14001/45001 条款级判定",
      "法律法规合规性评价"
    ],
    deliverables: [
      "审核计划",
      "首次会议议程",
      "末次会议议程",
      "现场检查表（覆盖 4-10 章）",
      "不符合项报告",
      "审核报告",
      "整改跟踪表",
      "认证合同"
    ],
    knowledgeCategories: [
      "ISO标准审核要点",
      "中认内部审核资料",
      "QES案例研究"
    ],
    navigateTo: "auditor"
  },
  {
    id: "quote-specialist",
    name: "报价员",
    title: "QES 三体系认证报价 + 客户需求匹配",
    description: "基于 V2.0-MVP 公式（人日×500 + 体系×1100 + QES 280 + 补贴；税费/0.92；经营费×18%）自动计算 QES 三体系认证报价，输出含税最终客户报价。匹配认证标准、行业、规模，识别需求差异。",
    capabilities: [
      "QES 三体系报价",
      "1/2/3 体系组合报价",
      "基础价 + 税费 + 经营管理费分解",
      "人日估算（基于员工数/行业）",
      "外协/外审场景识别",
      "客户需求匹配",
      "认证体系选型建议"
    ],
    deliverables: [
      "认证报价单",
      "报价明细表",
      "认证方案推荐",
      "客户需求匹配报告",
      "外协场景说明"
    ],
    knowledgeCategories: [
      "认证报价规则",
      "认证体系知识",
      "客户档案"
    ],
    navigateTo: "certification-quote"
  },
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
    navigateTo: "consult"
  }
];

export function getEmployee(role: EmployeeRole): EmployeeDefinition {
  return employees.find((employee) => employee.id === role)!;
}
