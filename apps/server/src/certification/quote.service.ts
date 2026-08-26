import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";

export interface CertificationItem {
  id: string;
  name: string;
  category: string;
  base: number;
  industryFactor: Record<string, number>;
}

export interface QuoteInput {
  companyName: string;
  industry: string;
  employeeCount: number;
  certifications: string[];
  /** 风险级别：'medium' 用中级审核员，'high' 用高级 */
  riskLevel: "medium" | "high";
  /** 申请认证范围（手动输入或从客户历史拉取） */
  certificationScope?: string;
  /** 专家人数（手动输入） */
  expertCount?: number;
}

export interface QuoteItem {
  certId: string;
  certName: string;
  basePrice: number;
  industryFactor: number;
  adjustedBase: number;
  initialAuditDays: number;
  supervisionAuditDays: number;
  recertificationAuditDays: number;
  auditorLevel: "中级" | "高级";
}

export interface QuoteResult {
  companyName: string;
  industry: string;
  employeeCount: number;
  sizeFactor: number;
  sizeTier: string;
  certifications: QuoteItem[];
  subtotal: number;
  afterSizeFactor: number;
  bundleDiscount: number;
  bundleTier: string;
  initialPrice: number;
  supervisionPrice: number;
  /** 专家评审费：人日 × ¥500/天 */
  expertReviewFee: number;
  /** 三体系组长费（仅 QES 收取） */
  groupLeaderFee: number;
  /** 专业补贴（预估人日 / 专家人数 × ¥200） */
  professionalSubsidy: number;
  /** 专家人数（专业补贴计算因子） */
  expertCount: number;
  /** 管理注册年金（每体系 ¥1,100） */
  managementAnnualFee: number;
  /** 基础价（不含税/不含经营管理 = 6部分之和） */
  basePrice: number;
  /** 税费 = basePrice / 0.92 × 0.08（即 8.7% 税点） */
  taxFee: number;
  /** 企业经营管理费 = basePrice × 18% */
  businessManagementFee: number;
  /** 最终客户报价（含税 + 经营管理） */
  finalPrice: number;
  /** 估算总人日 */
  totalAuditDays: number;
  /** 体系数（管理注册年金计算用） */
  standardCount: number;
  priceIncludes: string[];
  priceExcludes: string[];
  estimatedAuditDays: number;
  generatedAt: string;
}

const PRICE_MODEL_FILE = path.join(config.dataDir, "certification-quote-model.json");

/** 内置默认报价模型（与 DLE 同步） */
const DEFAULT_MODEL: { pricing: Record<string, { base: number; industry_factor: Record<string, number> }> } = {
  pricing: {
    "QES": { base: 12000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.9, "化工": 1.2 } },
    "Q": { base: 5000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.9, "化工": 1.1 } },
    "QJES": { base: 17000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 0.9, "物业": 1.0, "化工": 1.1 } },
    "QE": { base: 8000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.9, "化工": 1.1 } },
    "ES": { base: 9000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.9, "化工": 1.2 } },
    "27001": { base: 13000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 0.85, "物业": 1.0, "化工": 1.0 } },
    "20000": { base: 10000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 0.85, "物业": 1.0, "化工": 1.0 } },
    "双信息": { base: 21500, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 0.8, "物业": 1.0, "化工": 1.0 } },
    "HACCP": { base: 8500, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 1.0, "化工": 1.0 } },
    "食品安全管理": { base: 8000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 1.0, "化工": 1.0 } },
    "GAP": { base: 10000, industry_factor: { "制造业": 1.0, "食品": 0.9, "IT": 1.0, "物业": 1.0, "化工": 1.0 } },
    "商品售后服务": { base: 7000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.85, "化工": 1.0 } },
    "餐饮服务": { base: 6000, industry_factor: { "制造业": 1.0, "食品": 0.8, "IT": 1.0, "物业": 0.85, "化工": 1.0 } },
    "社会责任": { base: 13000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 0.95, "化工": 1.0 } },
    "能源": { base: 12000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 1.0, "化工": 0.9 } },
    "碳管理": { base: 10000, industry_factor: { "制造业": 1.0, "食品": 1.0, "IT": 1.0, "物业": 1.0, "化工": 1.0 } },
    "绿色供应链": { base: 6500, industry_factor: { "制造业": 0.9, "食品": 1.0, "IT": 1.0, "物业": 1.0, "化工": 1.0 } }
  }
};

/** 证书中文名 */
const CERT_NAMES: Record<string, string> = {
  "QES": "ISO 9001+14001+45001 三体系",
  "Q": "ISO 9001 质量管理体系",
  "QE": "ISO 9001+14001 质量+环境",
  "ES": "ISO 14001+45001 环境+职业健康",
  "QJES": "Q + 27001 信息安全",
  "27001": "ISO 27001 信息安全管理体系",
  "20000": "ISO 20000 IT 服务管理",
  "双信息": "ISO 27001+20000 双信息",
  "HACCP": "HACCP 食品安全",
  "食品安全管理": "ISO 22000 食品安全管理",
  "GAP": "GAP 良好农业规范",
  "商品售后服务": "商品售后服务认证",
  "餐饮服务": "餐饮服务认证",
  "社会责任": "SA 8000 社会责任",
  "能源": "ISO 50001 能源管理",
  "碳管理": "ISO 14068 碳管理体系",
  "绿色供应链": "绿色供应链管理体系"
};

/** 证书类别（用于审计人日估算） */
const CERT_CATEGORIES: Record<string, string> = {
  "QES": "通用", "Q": "通用", "QE": "通用", "ES": "通用", "QJES": "通用",
  "27001": "信息安全", "20000": "信息安全", "双信息": "信息安全",
  "HACCP": "食品", "食品安全管理": "食品", "GAP": "农业",
  "商品售后服务": "服务", "餐饮服务": "服务",
  "社会责任": "社会责任", "能源": "能源", "碳管理": "碳", "绿色供应链": "供应链"
};

function sizeFactor(size: number): { factor: number; tier: string } {
  if (size <= 30) return { factor: 0.85, tier: "≤30 人" };
  if (size <= 100) return { factor: 1.0, tier: "31-100 人" };
  if (size <= 300) return { factor: 1.15, tier: "101-300 人" };
  if (size <= 500) return { factor: 1.3, tier: "301-500 人" };
  if (size <= 1000) return { factor: 1.5, tier: "501-1000 人" };
  return { factor: 1.8, tier: ">1000 人" };
}

function bundleDiscount(count: number): { factor: number; tier: string } {
  if (count === 0) return { factor: 1.0, tier: "无证书" };
  if (count === 1) return { factor: 1.0, tier: "1 项无折扣" };
  if (count === 2) return { factor: 0.95, tier: "2 项 95%" };
  if (count === 3) return { factor: 0.9, tier: "3 项 90%" };
  return { factor: 0.85, tier: `${count} 项 85%` };
}

async function loadModel() {
  try {
    const raw = await fs.readFile(PRICE_MODEL_FILE, "utf8");
    const data = JSON.parse(raw);
    // cert-quote-model.json 只包含 pricing
    return data.pricing ?? data;
  } catch {
    return DEFAULT_MODEL;
  }
}

export async function generateQuote(input: QuoteInput): Promise<QuoteResult> {
  const model = await loadModel();
  const pricing = model.pricing || model || DEFAULT_MODEL.pricing;

  // 加载审核人日表（如果有 pricing 字段，先剥离）
  const auditTablePath = path.join(config.dataDir, "audit-days.json");
  let auditTable: any = null;
  try {
    const raw = await fs.readFile(auditTablePath, "utf8");
    auditTable = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  const bracket = sizeBracket(input.employeeCount);
  const levelKey = input.riskLevel === "high" ? "高级" : "中级";
  const auditorLabel: "中级" | "高级" = input.riskLevel === "high" ? "高级" : "中级";

  // 1) 计算每个证书的调整后基价 + 审核人日
  const items: QuoteItem[] = [];
  for (const certId of input.certifications) {
    const rule = pricing[certId];
    if (!rule) continue;
    const indFactor = rule.industry_factor[input.industry] ?? 1.0;
    const adjusted = Math.round(rule.base * indFactor);

    // 查审核人日（多标准叠加）
    let initialDays = 0;
    let supervisionDays = 0;
    let recertDays = 0;
    const standards = CERT_TO_STANDARDS[certId] || [];
    if (auditTable && standards.length > 0) {
      for (const std of standards) {
        const tableKey = `${std}_${levelKey}`;
        const row = auditTable[tableKey]?.[bracket];
        if (row) {
          initialDays += row["初审"] ?? 0;
          supervisionDays += row["监督"] ?? 0;
          recertDays += row["再认证"] ?? 0;
        }
      }
    }

    items.push({
      certId,
      certName: CERT_NAMES[certId] ?? certId,
      basePrice: rule.base,
      industryFactor: indFactor,
      adjustedBase: adjusted,
      initialAuditDays: initialDays,
      supervisionAuditDays: supervisionDays,
      recertificationAuditDays: recertDays,
      auditorLevel: auditorLabel
    });
  }

  // 2) 小计
  const subtotal = items.reduce((sum, item) => sum + item.adjustedBase, 0);

  // 3) 人数系数
  const size = sizeFactor(input.employeeCount);
  const afterSize = Math.round(subtotal * size.factor);

  // 4) 多证书折扣
  const bundle = bundleDiscount(items.length);
  const initialPrice = Math.round(afterSize * bundle.factor);

  // 5) 监督审核 = 初审 × 80%
  const supervisionPrice = Math.round(initialPrice * 0.8);

  // 6) 审核人日（按查表实际值求和）
  const totalAuditDays = items.reduce((sum, item) => sum + item.initialAuditDays, 0);
  const supervisionDays = items.reduce((sum, item) => sum + item.supervisionAuditDays, 0);

  // ============== 💰 新版报价构成（6部分） ==============

  // 1) 专家评审费：人日 × ¥500/天
  const expertReviewFee = Math.round(totalAuditDays * 500);

  // 2) 三体系组长费：仅 QES 三体系 +¥280
  const hasQES = input.certifications.includes("QES");
  const groupLeaderFee = hasQES ? 280 : 0;

  // 3) 专业补贴：预估人日 / 专家人数 × ¥200
  //     每个项目独立计算（高风险项目专家人数翻倍 → 补贴减半）
  //     公式：专业补贴 = 预估人日 / 专家人数 × 200
  //     例如：17 人日 / 2 专家 = 8.5 × 200 = ¥1,700
  //           27 人日 / 3 专家 = 9 × 200 = ¥1,800
  //           5 人日 / 1 专家 = 5 × 200 = ¥1,000
  let expertCount = 1;  // 默认 1 个专家
  const highSubsidyIndustries = ["化工", "石油", "医药", "矿业", "危化", "食品"];
  if (highSubsidyIndustries.includes(input.industry)) {
    expertCount = 3;  // 高风险行业需要 3 个专家
  } else if (input.industry === "制造业" || input.industry === "建筑" || input.industry === "施工") {
    expertCount = 2;  // 中风险行业需要 2 个专家
  }
  if (input.riskLevel === "high" && expertCount < 3) {
    expertCount = 3;  // 高风险等级也至少 3 个专家
  }
  // 手动输入优先（用户自定义专家数）
  if (input.expertCount && input.expertCount >= 1) {
    expertCount = input.expertCount;
  }
  const professionalSubsidy = Math.round((totalAuditDays / expertCount) * 200);

  // 4) 专家差旅费 + 5) 审核员住宿费 → 不含在报价内（实报实销另行结算）

  // 6) 管理注册年金：每体系 ¥1,100
  //     QES 三体系 = 3 体系 = ¥3,300
  //     Q 单体系 = 1 体系 = ¥1,100
  //     双信息（27001+20000）= 2 体系 = ¥2,200
  //     按 CERT_TO_STANDARDS 展开后的总体系数计算
  let standardCount = 0;
  for (const item of items) {
    const stds = CERT_TO_STANDARDS[item.certId] || [];
    standardCount += stds.length;
  }
  const managementAnnualFee = standardCount * 1100;

  // 🎯 基础价（不含差旅/住宿，实报实销）
  //   = 人日 × 500 + 体系数 × 1100 + 280 (QES时) + 补贴
  const basePrice = expertReviewFee + managementAnnualFee + groupLeaderFee +
                     professionalSubsidy;

  // 🧮 税费：basePrice / 0.92 × 0.08 ≈ basePrice × 8.7%
  //     计算逻辑：含税 = basePrice / 0.92，所以税 = basePrice / 0.92 - basePrice
  const taxFee = Math.round((basePrice / 0.92 - basePrice) * 100) / 100;

  // 🏢 企业经营管理费：basePrice × 18%
  const businessManagementFee = Math.round(basePrice * 0.18);

  // 🎯 最终客户报价 = 基础价 + 税费 + 经营管理费
  const finalPrice = Math.round((basePrice + taxFee + businessManagementFee) * 100) / 100;

  return {
    companyName: input.companyName,
    industry: input.industry,
    employeeCount: input.employeeCount,
    sizeFactor: size.factor,
    sizeTier: size.tier,
    certifications: items,
    subtotal,
    afterSizeFactor: afterSize,
    bundleDiscount: bundle.factor,
    bundleTier: bundle.tier,
    initialPrice,
    supervisionPrice,
    expertReviewFee,
    groupLeaderFee,
    professionalSubsidy,
    expertCount,
    managementAnnualFee,
    basePrice,
    taxFee,
    businessManagementFee,
    finalPrice,
    totalAuditDays,
    standardCount,
    priceIncludes: [
      "1. 专家评审费：人日 × ¥500/天",
      "2. 三体系组长费：QES 收取 ¥280",
      "3. 专业补贴：预估人日 / 专家人数 × ¥200",
      "4. 管理注册年金：每体系 ¥1,100（首年）",
      "5. 税费：基础价 × 8.7%（含税公式：基础价/0.92）",
      "6. 企业经营管理费：基础价 × 18%",
      "7. 最终客户报价 = 基础价 + 税费 + 经营管理费"
    ],
    priceExcludes: [
      "专家差旅费（实报实销，另行结算）",
      "审核员住宿费（异地，实报实销）",
      "特殊行业附加审核（医疗/危化等）",
      "证书副本加印（¥100/套）",
      "加急审核（双倍审核费）",
      "管理咨询/辅导培训服务"
    ],
    estimatedAuditDays: totalAuditDays,
    generatedAt: new Date().toISOString()
  };
}

export function getAvailableCertifications(): Array<{ id: string; name: string; category: string }> {
  return Object.entries(CERT_NAMES).map(([id, name]) => ({
    id,
    name,
    category: CERT_CATEGORIES[id] ?? "其他"
  }));
}

export const INDUSTRY_OPTIONS = [
  "制造业", "食品", "IT", "物业", "化工",
  "石油", "矿业", "医药", "建筑", "施工",
  "销售", "科技", "服务", "其他"
];
export const RISK_LEVEL_OPTIONS = [
  { value: "medium", label: "中级审核员（常规）" },
  { value: "high", label: "高级审核员（高风险行业）" }
];

/** 证书 → 标准类型数组（用于查审核人日表） */
const CERT_TO_STANDARDS: Record<string, Array<"Q" | "R" | "OHS">> = {
  // QES 三体系 = Q + R + OHS 三项叠加
  "QES": ["Q", "R", "OHS"],
  "Q": ["Q"],
  "QE": ["Q", "R"],
  "ES": ["R", "OHS"],
  "QJES": ["Q", "OHS"],
  "27001": ["OHS"],
  "20000": ["OHS"],
  "双信息": ["OHS", "OHS"],  // 27001+20000，两个 OHS
  "HACCP": ["OHS"],
  "食品安全管理": ["OHS"],
  "GAP": ["OHS"],
  "商品售后服务": ["Q"],
  "餐饮服务": ["Q"],
  "社会责任": ["OHS"],
  "能源": ["R"],
  "碳管理": ["R"],
  "绿色供应链": ["R"]
};

const SIZE_BRACKETS = [
  [1, 5], [6, 10], [11, 15], [16, 25], [26, 45], [46, 65], [66, 85],
  [86, 125], [126, 175], [176, 275], [276, 425], [426, 625], [626, 875],
  [876, 1175], [1176, 1550], [1551, 2025], [2026, 2675], [2676, 3450],
  [3451, 4350], [4351, 5450], [5451, 6800], [6801, 8500], [8501, 10700],
  [10701, 999999]
];

function sizeBracket(count: number): string {
  for (const [lo, hi] of SIZE_BRACKETS) {
    if (count >= lo && count <= hi) {
      return lo === 10701 ? "10700以上" : `${lo}-${hi}`;
    }
  }
  return "10700以上";
}
