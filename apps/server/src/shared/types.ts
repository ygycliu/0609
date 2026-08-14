export type EmployeeRole =
  | "consultant"
  | "solution-engineer"
  | "trainer"
  | "knowledge-assistant"
  | "certification-expert"
  | "certification-auditor";

export type ModelProvider = "demo" | "openai" | "ollama";

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

export interface ConsultationInput {
  role: EmployeeRole;
  industry: string;
  companyContext: string;
  request: string;
  deliverable: string;
  model: ModelProvider;
}

export interface ConsultationRecord extends ConsultationInput {
  id: string;
  createdAt: string;
  result: string;
  references: Array<Pick<KnowledgeItem, "id" | "title" | "category">>;
}
