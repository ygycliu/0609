import type {
  CertificationOption,
  CertificationOptionsResponse,
  CertificationQuote,
  ConsultationRecord,
  Employee,
  EmployeeRole,
  KnowledgeItem,
  ModelOption,
  ModelProvider,
  RiskLevelOption,
  ReviewItem
} from "../types";

// 自动根据挂载点决定 API 前缀：
// - 在 /ai/ 下打开（Apache 反代）→ 走 /ai/api
// - 直接打开（localhost:3001 或 LAN IP）→ 走 /api
// 也可以用 VITE_API_BASE_URL 强制指定覆盖默认值
const AUTO_BASE =
  typeof window !== "undefined" && window.location.pathname.startsWith("/ai/")
    ? "/ai/api"
    : "/api";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? AUTO_BASE;

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isForm = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isForm ? { "Content-Type": "application/json" } : {}),
    ...((options?.headers as Record<string, string>) ?? {})
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "same-origin"
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? "请求失败，请稍后重试", response.status);
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as { data: T };
  return body.data;
}

async function requestBlob(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "same-origin"
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? "文件生成失败，请稍后重试", response.status);
  }
  return response.blob();
}




export const api = {
  login: (username: string, password: string) =>
    request<{ mfaRequired?: boolean; expiresAt?: number; user: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  verifyMfa: (code: string) =>
    request<{ expiresAt: number; user: any }>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ code })
    }),
  employees: () => request<Employee[]>("/employees"),
  models: () => request<ModelOption[]>("/models"),
  knowledge: () => request<KnowledgeItem[]>("/knowledge"),
  consultations: () => request<ConsultationRecord[]>("/consultations"),
  me: () => request<{user: any; company: any}>("/auth/me"),
  logout: () => request<{ok: boolean}>("/auth/logout", {method: "POST"}),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; reloginRequired: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }),
  createConsultation: (input: {
    role: EmployeeRole;
    industry: string;
    companyContext: string;
    request: string;
    deliverable: string;
    model: ModelProvider;
  }) =>
    request<ConsultationRecord>("/consultations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  uploadKnowledge: (form: FormData) =>
    request<KnowledgeItem>("/knowledge", { method: "POST", body: form }),
  deleteKnowledge: (id: string) =>
    request<void>(`/knowledge/${id}`, { method: "DELETE" }),
  certificationOptions: () =>
    request<CertificationOptionsResponse>("/certification/options"),
  certificationQuote: (input: {
    companyName: string;
    industry: string;
    employeeCount: number;
    certifications: string[];
    riskLevel: "medium" | "high";
  }) =>
    request<CertificationQuote>("/certification/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  exportQuoteDocx: (input: { companyName: string; quote: unknown }) =>
    requestBlob("/certification/quote/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  analyzeDocument: (form: FormData) =>
    request<{
      fileName: string;
      characters: number;
      result: string;
      references: Array<Pick<KnowledgeItem, "id" | "title" | "category">>;
    }>("/documents/analyze", { method: "POST", body: form }),
  exportConsultationDocx: (
    id: string,
    input: {
      companyName: string;
      clientName: string;
      projectName: string;
      documentTitle: string;
      version: string;
      preparedBy: string;
      confidentiality: string;
      includeToc: boolean;
      includeReferences: boolean;
    }
  ) =>
    requestBlob(`/consultations/${id}/export/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  enterpriseSolutionTemplate: () =>
    requestBlob("/templates/enterprise-solution.docx"),
  exportConsultationPptx: (
    id: string,
    input: {
      companyName: string;
      clientName: string;
      projectName: string;
      presentationTitle: string;
      version: string;
      presenter: string;
      confidentiality: string;
      includeReferences: boolean;
    }
  ) =>
    requestBlob(`/consultations/${id}/export/pptx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  digitalTransformationPresentationTemplate: () =>
    requestBlob("/templates/digital-transformation-solution.pptx"),
  qualityReviews: (status: "pending" | "applied" | "rejected" | "all" = "pending") =>
    request<ReviewItem[]>(`/quality/reviews?status=${status}`),
  reviewDecision: (id: string, input: { action: "approve" | "reject"; note?: string }) =>
    request<{ ok: boolean; action: string; newVersion?: number; applied?: boolean }>(
      `/quality/reviews/${id}/decision`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
    ),
  knowledgeVersions: (docCode: string) =>
    request<Array<{ id: string; version: number; change_summary: string; creator: string | null; created_at: string }>>(
      `/knowledge/${docCode}/versions`
    ),
  expiringKnowledge: (days = 30) =>
    request<Array<{ doc_code: string; title: string; category: string; effective_to: string; days_remaining: number }>>(
      `/quality/expiring?days=${days}`
    )
};
