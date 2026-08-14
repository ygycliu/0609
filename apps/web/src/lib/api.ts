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

// 报告级附件类型
export interface ReportAttachment {
  id: string;
  original_name: string;
  file_type: string;
  mime_type: string;
  size_bytes: number;
  category: "photo" | "recording" | "document" | "video" | "other";
  source: "manual_upload" | "yoooclaw_recording" | "yoooclaw_image";
  yoooclaw_recording_id: string | null;
  duration_seconds: number | null;
  caption: string | null;
  created_at: string;
  url: string;
}

export interface ReportAttachmentSummary {
  total: number;
  photo: number;
  recording: number;
  document: number;
  video: number;
  other: number;
  yoooclaw: number;
}

const AUTO_BASE =
  typeof window !== "undefined" && window.location.pathname.startsWith("/ai/")
    ? "/ai/api"
    : "/api";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? AUTO_BASE;

class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...(init.headers ?? {}) }
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...(init.headers ?? {}) }
  });
  if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);
  return response.blob();
}

export const api = {
  // ===== Auth =====
  login: (username: string, password: string, mfaToken?: string, mfaCode?: string) =>
    request<{ user: any; company: any; expiresAt: number; mfaRequired?: boolean }>("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, mfaToken, mfaCode })
    }),
  verifyMfa: (mfaCode: string) =>
    request<{ user: any; company: any; expiresAt: number }>("/auth/mfa/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: localStorage.getItem("pendingMfaToken") || "", mfaCode })
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: any; company: any; permissions: string[] }>("/auth/me"),
  refresh: () => request<{ ok: true; expiresAt: number }>("/auth/refresh", { method: "POST" }),
  mfaEnable: () =>
    request<{ secret: string; otpauthUrl: string; backupCodes: string[] }>("/auth/mfa/enable", { method: "POST" }),
  mfaConfirm: (code: string) =>
    request<{ ok: true }>("/auth/mfa/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
    }),
  mfaDisable: (code: string) =>
    request<{ ok: true }>("/auth/mfa/disable", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
    }),
  mfaRegenerateBackupCodes: (code: string) =>
    request<{ backupCodes: string[] }>("/auth/mfa/backup-codes/regenerate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code })
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    }),

  // ===== Models =====
  listModels: () => request<{ providers: ModelProvider[]; options: ModelOption[] }>("/models"),

  // ===== Knowledge =====
  searchKnowledge: (query: string, options?: { limit?: number; categories?: string[] }) =>
    request<KnowledgeItem[]>(`/knowledge${options ? `?${new URLSearchParams(options as any).toString()}` : ""}`),
  uploadKnowledge: (form: FormData) =>
    fetch(`${API_BASE_URL}/knowledge`, { method: "POST", body: form, credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error(`upload failed: ${r.status}`); return r.json(); }),
  deleteKnowledge: (id: string) =>
    request<{ ok: true }>(`/knowledge/${id}`, { method: "DELETE" }),

  // ===== Consultation =====
  listConsultations: () => request<ConsultationRecord[]>("/consultations"),
  createConsultation: (input: any) =>
    request<ConsultationRecord>("/consultations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  getConsultation: (id: string) => request<ConsultationRecord>(`/consultations/${id}`),
  consultations: () => request<ConsultationRecord[]>("/consultations"),
  knowledge: () => request<KnowledgeItem[]>("/knowledge"),
  employees: () => request<Employee[]>("/employees"),
  models: () => request<ModelOption[]>("/models"),
  exportConsultationDocx: (consultationId: string, form: any) =>
    fetch(`${API_BASE_URL}/consultations/${consultationId}/export/docx`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form), credentials: "include"
    }).then(async (r) => { if (!r.ok) throw new Error(`export failed: ${r.status}`); return r.blob(); }),
  enterpriseSolutionTemplate: () =>
    requestBlob("/templates/enterprise-solution.docx"),

  
  deleteConsultation: (id: string) =>
    request<{ ok: true }>(`/consultations/${id}`, { method: "DELETE" }),
  submitFeedback: (consultationId: string, input: any) =>
    request<{ ok: true }>(`/consultations/${consultationId}/feedback`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  exportConsultationPptx: (id: string, input: {
    version: string; presenter: string; confidentiality: string; includeReferences: boolean;
  }) =>
    requestBlob(`/consultations/${id}/export/pptx`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  digitalTransformationPresentationTemplate: () =>
    requestBlob("/templates/digital-transformation-solution.pptx"),

  // ===== Customers =====
  listCustomers: () => request<any[]>("/customers"),
  searchCustomers: (q: string, limit = 20) =>
    request<any[]>(`/customers?q=${encodeURIComponent(q)}&limit=${limit}`),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  createCustomer: (input: any) =>
    request<any>("/customers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),

  // ===== Quotes =====
  listQuotes: () => request<any[]>("/certification/quotes"),
  createQuote: (input: any) =>
    request<CertificationQuote>("/certification/quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  certificationOptions: () =>
    request<{ industries: string[]; riskLevels?: any[]; certifications: CertificationOption[] }>(
      "/certification/options"
    ),
  certificationQuote: (input: any) =>
    request<CertificationQuote>("/certification/quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  analyzeDocument: (form: FormData) =>
    fetch(`${API_BASE_URL}/documents/analyze`, { method: "POST", body: form, credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error(`analyze failed: ${r.status}`); return r.json(); }),

    quoteOptions: () => request<CertificationOptionsResponse>("/certification/quote/options"),
  exportQuoteDocx: (input: any) =>
    fetch(`${API_BASE_URL}/certification/quote/export/docx`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), credentials: "include"
    }).then(async (r) => { if (!r.ok) throw new Error(`export failed: ${r.status}`); return r.blob(); }),

  // ===== Employees =====
  listEmployees: () => request<Employee[]>("/employees"),

  // ===== Auditor (数字审核员) =====
  auditorPlan: (input: any) =>
    request<{ plan: string; references: string[] }>("/auditor/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  auditorChecklist: (input: any) =>
    request<{ checklist: any[]; totalItems: number }>("/auditor/checklist", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  auditorReport: (input: any) =>
    request<{
      nonConformances: any[]; report: string; conclusion: string;
      summary: { total: number; major: number; minor: number; observation: number };
    }>("/auditor/report", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  auditorCreateSession: (input: any) =>
    request<{ sessionId: string; itemCount: number }>("/auditor/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  auditorGetSession: (id: string) =>
    request<{ session: any; items: any[]; attachmentCount: number }>(`/auditor/session/${id}`),
  auditorUpdateItem: (itemId: string, input: { result?: string; notes?: string }) =>
    request<{ id: string; result: string; notes: string }>(`/auditor/item/${itemId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  auditorUploadAttachment: (itemId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE_URL}/auditor/item/${itemId}/upload`, {
      method: "POST", body: form, credentials: "include"
    }).then(async (r) => { if (!r.ok) throw new Error(`upload failed: ${r.status}`); return r.json(); });
  },
  auditorDeleteAttachment: (id: string) =>
    fetch(`${API_BASE_URL}/auditor/attachment/${id}`, { method: "DELETE", credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error(`delete failed: ${r.status}`); return true; }),

  // 报告级附件（出报告前上传）
  auditorGetReportAttachments: (sessionId: string) =>
    request<{ items: ReportAttachment[]; summary: ReportAttachmentSummary }>(
      `/auditor/session/${sessionId}/report-attachments`
    ),
  auditorUploadReportAttachment: (sessionId: string, file: File, caption?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return fetch(`${API_BASE_URL}/auditor/session/${sessionId}/report-attachment/upload`, {
      method: "POST", body: form, credentials: "include"
    }).then(async (r) => { if (!r.ok) throw new Error(`upload failed: ${r.status}`); return r.json(); });
  },
  auditorDeleteReportAttachment: (id: string) =>
    fetch(`${API_BASE_URL}/auditor/report-attachment/${id}`, { method: "DELETE", credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error(`delete failed: ${r.status}`); return true; }),
  auditorSetAttachmentsReady: (sessionId: string, ready: boolean) =>
    request<{ ready: boolean }>(`/auditor/session/${sessionId}/attachments-ready`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ready })
    }),
  // ===== Files (文件浏览器) =====
  filesList: (path: string) => {
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    const qs = params.toString();
    return request<{
      path: string;
      breadcrumbs: Array<{ name: string; path: string }>;
      parent: string | null;
      items: Array<{
        name: string;
        path: string;
        isDir: boolean;
        size: number;
        modifiedAt: string;
      }>;
    }>(`/files/list${qs ? "?" + qs : ""}`);
  },
  filesUpload: (path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    const qs = params.toString();
    return fetch(`${API_BASE_URL}/files/upload${qs ? "?" + qs : ""}`, {
      method: "POST",
      body: form,
      credentials: "include"
    }).then(async (r) => {
      if (!r.ok) throw new Error(`upload failed: ${r.status}`);
      return r.json();
    });
  },
  filesDelete: (path: string) => {
    const params = new URLSearchParams();
    params.set("path", path);
    return fetch(`${API_BASE_URL}/files/delete?${params.toString()}`, {
      method: "DELETE",
      credentials: "include"
    }).then(async (r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
      return true;
    });
  },
  filesMkdir: (path: string, name: string) =>
    request<{ name: string; path: string }>("/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name })
    }),

  // ===== Quality (knowledge review) =====
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

export { API_BASE_URL };
