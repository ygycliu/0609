export type EmployeeRole =
  | "trainer"
  | "knowledge-assistant"
  | "certification-expert";

export type ModelProvider = string;  // V2.1：支持动态 provider（如 "ollama:qwen2.5:7b"）

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
