export type Page =
  | "overview"
  | "consult"
  | "knowledge"
  | "documents"
  | "results"
  | "certification-quote"
  | "knowledge-review"
  | "auditor"
  | "files"
  | "pdf-to-word"
  | "customer-list"
  | "customer-detail"
  | "finance-dashboard"
  | "follow-up"
  | "todo"
  | "project-workspace"
  | "project-detail"
  | "project-new"
  | "base-data";

export interface ReviewItem {
  id: string;
  document_id: string;
  document_title: string;
  doc_code: string;
  review_type: string;
  proposed_content: string;
  reason: string;
  status: string;
  submitter_display: string | null;
  reviewer_display: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  new_version: number | null;
  created_at: string;
}

export type EmployeeRole =
  | "consultant"
  | "solution-engineer"
  | "trainer"
  | "knowledge-assistant"
  | "certification-expert";

export type ModelProvider = "demo" | "openai" | "ollama";

export interface Employee {
  id: EmployeeRole;
  name: string;
  title: string;
  description: string;
  capabilities: string[];
  deliverables: string[];
}

export interface CertificationOption {
  id: string;
  name: string;
  category: string;
}

export interface CertificationQuoteItem {
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

export interface RiskLevelOption {
  value: "medium" | "high";
  label: string;
}

export interface CertificationQuote {
  companyName: string;
  industry: string;
  employeeCount: number;
  sizeFactor: number;
  sizeTier: string;
  certificationScope?: string;
  certifications: CertificationQuoteItem[];
  subtotal: number;
  afterSizeFactor: number;
  bundleDiscount: number;
  bundleTier: string;
  initialPrice: number;
  supervisionPrice: number;
  expertReviewFee: number;
  groupLeaderFee: number;
  professionalSubsidy: number;
  expertCount: number;
  managementAnnualFee: number;
  basePrice: number;
  taxFee: number;
  businessManagementFee: number;
  finalPrice: number;
  totalAuditDays: number;
  standardCount: number;
  priceIncludes: string[];
  priceExcludes: string[];
  estimatedAuditDays: number;
  generatedAt: string;
}

export interface ModelOption {
  id: ModelProvider;
  name: string;
  available: boolean;
  description: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceName: string;
  fileType: string;
  createdAt: string;
  tags: string[];
}

export interface ConsultationRecord {
  id: string;
  role: EmployeeRole;
  industry: string;
  companyContext: string;
  request: string;
  deliverable: string;
  model: ModelProvider;
  createdAt: string;
  result: string;
  references: Array<Pick<KnowledgeItem, "id" | "title" | "category">>;
}

export interface RiskLevelOption {
  value: "medium" | "high";
  label: string;
}

export interface CertificationOptionsResponse {
  industries: string[];
  riskLevels: RiskLevelOption[];
  certifications: CertificationOption[];
}

// ===== 2.0-MVP 认证项目中心 =====
export type ProjectStatus =
  | "lead" | "communicating" | "quoted" | "contract_pending"
  | "contract_signed" | "contract_archived" | "first_pay_pending" | "first_paid"
  | "delivery_prep" | "doc_collecting" | "contract_review" | "expert_review_pending"
  | "expert_reviewing" | "correcting" | "final_pay_pending" | "invoice_pending"
  | "cert_pending" | "certified" | "shipment_pending" | "completed"
  | "suspended" | "at_risk" | "cancelled";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  lead: "线索", communicating: "沟通中", quoted: "已报价",
  contract_pending: "待签合同", contract_signed: "合同已签",
  contract_archived: "合同已归档", first_pay_pending: "待首付款",
  first_paid: "已收首付款", delivery_prep: "交付准备",
  doc_collecting: "资料收集中", contract_review: "合同评审中",
  expert_review_pending: "待专家评审", expert_reviewing: "现场/远程评审中",
  correcting: "整改中", final_pay_pending: "待尾款",
  invoice_pending: "待开票", cert_pending: "待出证",
  certified: "已出证", shipment_pending: "待邮寄", completed: "已完成",
  suspended: "暂停", at_risk: "风险/待处理", cancelled: "取消",
};

export interface Signatory {
  id: string;
  entity_code?: string;
  code?: string;
  name: string; shortName?: string;
  contactPerson?: string; contactPhone?: string; address?: string;
  status: string; notes?: string;
}
export interface ServiceType {
  id: string; code: string; name: string; description?: string;
  config: any; status: string; sortOrder: number;
}
export interface PartnerOrg {
  id: string; name: string; contactName?: string; contactPerson?: string; contactPhone?: string;
  address?: string; cooperationStatus: string; status?: string; notes?: string; remark?: string;
}
export interface Project {
  id: string; projectCode: string;
  customerId: string; customerName: string;
  contactPerson?: string; contactPhone?: string;
  serviceTypeId: string; serviceTypeCode: string; serviceTypeName: string;
  signatoryId: string; signatoryName: string;
  partnerOrgId?: string; partnerOrgName?: string;
  industry?: string; certificationScope?: string; certificationStandards?: string;
  riskLevel?: string; salesSource?: string;
  contractAmount?: number; paidAmount: number; invoiceAmount: number;
  status: ProjectStatus;
  isSuspended: boolean; isCancelled: boolean; cancelReason?: string;
  expectedCertDate?: string; actualCertDate?: string;
  firstPayDate?: string; finalPayDate?: string;
  nextFollowupDate?: string; lastFollowupDate?: string;
  groupName?: string;
  salesName?: string; projectOwnerName?: string; consultantName?: string; reviewerName?: string;
  notes?: string; createdAt: string; updatedAt: string;
}
export interface ProjectTimelineEvent {
  at: string; type: "status" | "log";
  action?: string; fromStatus?: string; toStatus?: string;
  reason?: string; note?: any; operatorName?: string;
}
