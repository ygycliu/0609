export type Page =
  | "overview"
  | "consult"
  | "knowledge"
  | "documents"
  | "results"
  | "certification-quote"
  | "knowledge-review";

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
  certifications: CertificationQuoteItem[];
  subtotal: number;
  afterSizeFactor: number;
  bundleDiscount: number;
  bundleTier: string;
  initialPrice: number;
  supervisionPrice: number;
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
