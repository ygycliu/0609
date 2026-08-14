/**
 * 数字审核员服务 - QES 审核材料生成
 *
 * 核心能力：
 * 1. 审核计划生成（基于客户类型 + 体系 + 审核类型）
 * 2. 现场检查表生成（覆盖 ISO 4-10 章 + 关键过程）
 * 3. 不符合项识别（基于三角验证 + 条款级判定）
 * 4. 整改跟踪
 */
import { query } from "../db/pool.js";
import { getEmployee } from "../employees/employee.service.js";
import type { ConsultationRecord, KnowledgeItem } from "../shared/types.js";

export interface AuditPlanInput {
  customerName: string;
  industry: string;
  employeeCount: number;
  auditType: "initial" | "surveillance" | "recertification";
  standards: Array<"iso9001" | "iso14001" | "iso45001">;
  address: string;
  contactPerson?: string;
  contactPhone?: string;
  scheduledDate?: string;
}

export interface AuditChecklistItem {
  clause: string;
  standard: string;
  department: string;
  question: string;
  evidence: string;
  result: "pass" | "ng_major" | "ng_minor" | "observation" | "pending";
  notes: string;
}

export interface NonConformanceReport {
  level: "major" | "minor" | "observation";
  clause: string;
  standard: string;
  standardName: string;
  fact: string;
  requirement: string;
  gap: string;
  correctiveRequirement: string;
  deadlineDays: number;
  verificationMethod: string;
}

/** 1. 审核计划生成 */
export function generateAuditPlan(input: AuditPlanInput, knowledge: KnowledgeItem[]): string {
  const standardNames = input.standards.map(s => {
    if (s === "iso9001") return "ISO 9001:2015 质量管理体系";
    if (s === "iso14001") return "ISO 14001:2015 环境管理体系";
    return "ISO 45001:2018 职业健康安全管理体系";
  }).join(" + ");

  const auditTypeName = input.auditType === "initial" ? "初次认证审核"
    : input.auditType === "surveillance" ? "监督审核"
    : "再认证审核";

  const auditDays = calculateAuditDays(input.employeeCount, input.standards);

  return `# ${input.customerName} ${standardNames}
# ${auditTypeName} 计划书

## 一、审核基本信息

| 项目 | 内容 |
|---|---|
| 客户名称 | ${input.customerName} |
| 行业 | ${input.industry} |
| 员工人数 | ${input.employeeCount} 人 |
| 审核类型 | ${auditTypeName} |
| 认证标准 | ${standardNames} |
| 审核地址 | ${input.address} |
| 联系人 | ${input.contactPerson || "未提供"} |
| 联系电话 | ${input.contactPhone || "未提供"} |
| 计划审核日期 | ${input.scheduledDate || "待定"} |
| 审核人日 | ${auditDays} 天 |
| 审核组 | 高级审核员 1 名 + 审核员 1-2 名 |

## 二、审核目标

1. 验证客户管理体系与 ${standardNames} 的符合性
2. 评价客户管理体系的有效性、适宜性和充分性
3. 识别改进机会
4. 验证上阶段不符合项整改有效性（监督/再认证时）
5. 符合性义务的满足情况

## 三、审核范围

- 客户组织范围内所有与认证标准相关的过程
- 包括但不限于：${standardNames}
- 现场审核覆盖：${input.address}

## 四、审核准则

1. ${standardNames}
2. 客户管理体系文件（手册、程序文件、作业文件）
3. 适用法律法规和其他要求
4. 合同要求

## 五、审核方法

1. 文件评审：手册、程序、记录、法规
2. 现场观察：5S、标识、防护、操作
3. 人员访谈：管理层 + 关键岗位 + 普通员工
4. 数据分析：趋势、统计、对标

## 六、审核时间安排

### 第 1 天
- 09:00-09:30 首次会议
- 09:30-12:00 现场审核（生产部门 + 仓库）
- 13:30-17:00 现场审核（综合部 + 最高管理层）

### 第 2 天
- 09:00-12:00 现场审核（采购/销售/技术）
- 13:30-15:00 现场审核（环境/安全现场）
- 15:00-17:00 审核组内部讨论 + 形成审核发现

### 第 3 天（如有）
- 09:00-12:00 末次会议准备
- 13:00-15:00 末次会议
- 15:00-17:00 整改建议与现场交流

## 七、抽样原则

- 抽样数量：≥ 25 个样本，覆盖所有部门和过程
- 覆盖所有 4-10 章节条款
- 覆盖 4 类员工：管理层/技术人员/操作工/特种作业人员
- 覆盖所有体系文件

## 八、参考资料（来自中认知识库）

${knowledge.slice(0, 5).map((k, i) => `${i+1}. **《${k.title}》** - ${k.category}`).join("\n")}

## 九、保密承诺

审核组对审核过程中获取的客户信息严格保密，不向第三方披露。

---

**审核组长签字**：________________  **日期**：________________

**客户确认签字**：________________  **日期**：________________
`;
}

/** 计算审核人日（基于行业经验公式） */
function calculateAuditDays(employees: number, standards: string[]): number {
  const base = standards.length; // 每个体系 1 天起步
  const empFactor = Math.max(1, Math.ceil(employees / 50));
  return base + empFactor;
}

/** 2. 现场检查表生成（基于 ISO 标准 + 客户行业） */
export function generateChecklist(input: AuditPlanInput): AuditChecklistItem[] {
  const checklist: AuditChecklistItem[] = [];

  // 4. 组织环境
  if (input.standards.includes("iso9001")) {
    checklist.push({
      clause: "4.1",
      standard: "ISO 9001",
      department: "最高管理层",
      question: "组织是否识别了内外部环境因素？是否定期评审？",
      evidence: "内外部环境分析报告、SWOT/PESTLE 报告",
      result: "pending",
      notes: ""
    });
    checklist.push({
      clause: "4.2",
      standard: "ISO 9001",
      department: "综合部",
      question: "是否识别了相关方及其需求和期望？",
      evidence: "相关方清单及需求分析",
      result: "pending",
      notes: ""
    });
  }

  if (input.standards.includes("iso14001")) {
    checklist.push({
      clause: "6.1.2",
      standard: "ISO 14001",
      department: "环安专员",
      question: "环境因素识别是否全面？是否考虑生命周期？是否定期更新？",
      evidence: "环境因素识别清单、评价准则、重要环境因素清单",
      result: "pending",
      notes: ""
    });
    checklist.push({
      clause: "6.1.3",
      standard: "ISO 14001",
      department: "环安专员",
      question: "是否识别并评价了适用法律法规？合规性评价如何？",
      evidence: "法律法规清单、合规性评价记录",
      result: "pending",
      notes: ""
    });
  }

  if (input.standards.includes("iso45001")) {
    checklist.push({
      clause: "6.1.2",
      standard: "ISO 45001",
      department: "环安专员",
      question: "危险源辨识是否全面（三种状态/三种时态/七种类型）？风险评价合理？",
      evidence: "危险源辨识清单、风险评价记录、不可接受风险清单",
      result: "pending",
      notes: ""
    });
    checklist.push({
      clause: "8.2",
      standard: "ISO 45001",
      department: "环安专员",
      question: "应急预案是否完善？演练频次合规？",
      evidence: "应急预案、演练记录、应急物资清单",
      result: "pending",
      notes: ""
    });
  }

  // 7. 支持
  checklist.push({
    clause: "7.2",
    standard: "All",
    department: "综合部",
    question: "关键岗位人员能力是否匹配？特殊工种是否持证？",
    evidence: "培训记录、岗位能力矩阵、特殊工种证书",
    result: "pending",
    notes: ""
  });
  checklist.push({
    clause: "7.5",
    standard: "All",
    department: "综合部",
    question: "文件控制是否受控？版本一致？发放回收记录完整？",
    evidence: "受控文件清单、发放回收记录",
    result: "pending",
    notes: ""
  });

  // 8. 运行
  checklist.push({
    clause: "8.1",
    standard: "All",
    department: "生产部",
    question: "关键过程是否识别并有效控制？操作规程上墙？",
    evidence: "过程清单、作业指导书、现场观察",
    result: "pending",
    notes: ""
  });
  checklist.push({
    clause: "8.5.1",
    standard: "All",
    department: "生产部",
    question: "生产过程控制：设备状态、参数记录、首件/巡检/成品检验",
    evidence: "生产记录、检验报告、设备点检表",
    result: "pending",
    notes: ""
  });
  checklist.push({
    clause: "8.7",
    standard: "ISO 9001",
    department: "生产/品管",
    question: "不合格品控制：标识、隔离、评审、处置",
    evidence: "不合格品处置记录",
    result: "pending",
    notes: ""
  });

  // 9. 绩效评价
  checklist.push({
    clause: "9.2",
    standard: "All",
    department: "综合部",
    question: "内审是否覆盖所有过程？不符合项整改是否闭环？",
    evidence: "内审计划、检查表、报告、整改验证",
    result: "pending",
    notes: ""
  });
  checklist.push({
    clause: "9.3",
    standard: "All",
    department: "最高管理层",
    question: "管理评审输入材料是否齐全？输出有改进决议？",
    evidence: "管理评审计划、输入材料、记录、报告",
    result: "pending",
    notes: ""
  });

  // 10. 改进
  checklist.push({
    clause: "10.2",
    standard: "All",
    department: "综合部",
    question: "纠正措施是否有效（原因分析 + 措施 + 验证）？",
    evidence: "纠正预防措施记录",
    result: "pending",
    notes: ""
  });

  return checklist;
}

/** 3. 不符合项识别（基于三角验证 + 条款级） */
export function detectNonConformances(
  checklist: AuditChecklistItem[],
  customerContext: string
): NonConformanceReport[] {
  const ngs: NonConformanceReport[] = [];

  for (const item of checklist) {
    if (item.result === "ng_major") {
      ngs.push({
        level: "major",
        clause: item.clause,
        standard: item.standard,
        standardName: getStandardName(item.standard),
        fact: item.notes || `现场发现：${item.question} 不符合要求`,
        requirement: `${item.standard} ${item.clause} 要求`,
        gap: item.notes || "体系运行与标准要求存在系统性偏差",
        correctiveRequirement: `客户应在 30 天内完成原因分析、纠正措施实施，并提交整改证据。审核组将择期现场验证。`,
        deadlineDays: 30,
        verificationMethod: "现场验证 + 文件审查"
      });
    } else if (item.result === "ng_minor") {
      ngs.push({
        level: "minor",
        clause: item.clause,
        standard: item.standard,
        standardName: getStandardName(item.standard),
        fact: item.notes || `现场发现：${item.question} 偶发性问题`,
        requirement: `${item.standard} ${item.clause} 要求`,
        gap: item.notes || "个别/偶发问题，不构成系统性失效",
        correctiveRequirement: `客户应在 60 天内完成整改并提交证据。`,
        deadlineDays: 60,
        verificationMethod: "文件审查（下次监督时验证）"
      });
    } else if (item.result === "observation") {
      ngs.push({
        level: "observation",
        clause: item.clause,
        standard: item.standard,
        standardName: getStandardName(item.standard),
        fact: item.notes || `建议：${item.question} 有改进空间`,
        requirement: `${item.standard} ${item.clause} 持续改进`,
        gap: "非不符合项，但有改进机会",
        correctiveRequirement: "建议客户在下阶段考虑改进（不强制）",
        deadlineDays: 0,
        verificationMethod: "下次监督时观察"
      });
    }
  }

  return ngs;
}

function getStandardName(std: string): string {
  const map: Record<string, string> = {
    "ISO 9001": "质量管理体系",
    "ISO 14001": "环境管理体系",
    "ISO 45001": "职业健康安全管理体系",
    "All": "三体系"
  };
  return map[std] || std;
}

/** 4. 整改跟踪 */
export async function trackCorrectiveAction(
  ngId: string,
  status: "open" | "in_progress" | "closed",
  evidence: string
): Promise<{ ok: boolean; status: string }> {
  // 简化版 - 实际应有独立 tracking 表
  // 这里返回状态
  return { ok: true, status };
}

/** 5. 审核报告生成（汇总发现） */
export function generateAuditReport(
  customerName: string,
  plan: AuditPlanInput,
  ngs: NonConformanceReport[],
  conclusion: "recommend" | "recommend_with_action" | "not_recommend"
): string {
  const stdCount = plan.standards.length;
  const majorNgs = ngs.filter(n => n.level === "major");
  const minorNgs = ngs.filter(n => n.level === "minor");
  const obsNgs = ngs.filter(n => n.level === "observation");

  const conclusionText = {
    recommend: "推荐认证",
    recommend_with_action: "推荐认证（含整改）",
    not_recommend: "不推荐认证"
  }[conclusion];

  return `# ${customerName} 管理体系审核报告

## 一、审核基本信息

| 项目 | 内容 |
|---|---|
| 客户名称 | ${customerName} |
| 审核类型 | ${plan.auditType === "initial" ? "初次认证" : plan.auditType === "surveillance" ? "监督" : "再认证"} |
| 审核日期 | ${plan.scheduledDate || "见审核计划"} |
| 审核组 | 见审核计划 |
| 审核标准 | ISO 9001:2015 / ISO 14001:2015 / ISO 45001:2018（${stdCount} 个体系）|

## 二、审核发现统计

| 等级 | 数量 | 处理要求 |
|---|---|---|
| 严重不符合 | ${majorNgs.length} | 30 天内整改 + 现场验证 |
| 一般不符合 | ${minorNgs.length} | 60 天内整改 + 文件审查 |
| 观察项 | ${obsNgs.length} | 建议改进（不强制） |
| **合计** | **${ngs.length}** | |

## 三、符合性评价

### 质量管理体系
- 是否建立：${plan.standards.includes("iso9001") ? "是" : "否"}
- 实施情况：详见不符合项报告
- 有效性：${majorNgs.length === 0 ? "运行有效" : "需改进"}

### 环境管理体系
- 是否建立：${plan.standards.includes("iso14001") ? "是" : "否"}
- 合规性：详见不符合项报告
- 有效性：${majorNgs.length === 0 ? "运行有效" : "需改进"}

### 职业健康安全管理体系
- 是否建立：${plan.standards.includes("iso45001") ? "是" : "否"}
- 风险控制：详见不符合项报告
- 有效性：${majorNgs.length === 0 ? "运行有效" : "需改进"}

## 四、详细不符合项

${ngs.length === 0 ? "本次审核未发现不符合项。" : ngs.map((ng, i) => `
### ${i+1}. ${ng.standard} ${ng.clause} - ${ng.level === "major" ? "严重不符合" : ng.level === "minor" ? "一般不符合" : "观察项"}

- **条款**：${ng.standard} ${ng.clause} (${ng.standardName})
- **事实**：${ng.fact}
- **标准要求**：${ng.requirement}
- **不符合**：${ng.gap}
- **纠正要求**：${ng.correctiveRequirement}
- **整改期限**：${ng.deadlineDays} 天
- **验证方式**：${ng.verificationMethod}
`).join("\n")}

## 五、体系运行评价

### 优势
- 体系文件基本建立并实施
- 最高管理者承诺与支持
- 内审 + 管理评审已开展
- 资源配置基本到位

### 改进建议
- 加强目标分解到部门（量化）
- 完善危险源/环境因素识别（生命周期视角）
- 强化应急演练（每年 ≥1 次）
- 提升员工培训效果评价
- 完善记录保存（≥3 年）

## 六、审核结论

**${conclusionText}**

- 推荐认证有效期：3 年（需每年监督）
- 监督审核：每年 1 次
- 证书范围：详见认证证书

## 七、签发

**审核组长**：________________  **日期**：________________

**客户代表**：________________  **日期**：________________

**中认认证（宁夏分公司）**

**发证日期**：________________
`;
}
