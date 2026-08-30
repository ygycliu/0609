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
  PartnerOrg,
  Project,
  ProjectTimelineEvent,
  RiskLevelOption,
  ReviewItem,
  ServiceType,
  Signatory
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

  // ===== Finance =====
  listProjects: async (params: {
    q?: string;
    status?: string;
    customer_id?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.customer_id) qs.set("customer_id", params.customer_id);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await fetch(`${API_BASE_URL}/finance/projects?${qs.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new ApiError(`projects list failed: ${response.status}`, response.status);
    return (await response.json()) as { data: any[]; total: number };
  },
  getProject: (id: string) => request<any>(`/finance/projects/${id}`),
  createProject: (input: any) =>
    request<any>("/finance/projects", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateProject: (id: string, input: any) =>
    request<any>(`/finance/projects/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteProject: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/finance/projects/${id}`, {
      method: "DELETE"
    }),

  listTransactions: async (params: {
    type?: "income" | "expense";
    category?: string;
    project_id?: string;
    customer_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set("type", params.type);
    if (params.category) qs.set("category", params.category);
    if (params.project_id) qs.set("project_id", params.project_id);
    if (params.customer_id) qs.set("customer_id", params.customer_id);
    if (params.start_date) qs.set("start_date", params.start_date);
    if (params.end_date) qs.set("end_date", params.end_date);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await fetch(`${API_BASE_URL}/finance/transactions?${qs.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new ApiError(`transactions list failed: ${response.status}`, response.status);
    return (await response.json()) as { data: any[]; total: number };
  },
  createTransaction: (input: any) =>
    request<any>("/finance/transactions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateTransaction: (id: string, input: any) =>
    request<any>(`/finance/transactions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteTransaction: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/finance/transactions/${id}`, {
      method: "DELETE"
    }),
  getFinanceSummary: (params: { start_date?: string; end_date?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.start_date) qs.set("start_date", params.start_date);
    if (params.end_date) qs.set("end_date", params.end_date);
    const path = qs.toString() ? `/finance/summary?${qs.toString()}` : "/finance/summary";
    return request<any>(path);
  },

  // ===== 应收账款 AR =====
  listAR: async (params: {
    customer_id?: string;
    status?: string;
    overdue_only?: boolean;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.customer_id) qs.set("customer_id", params.customer_id);
    if (params.status) qs.set("status", params.status);
    if (params.overdue_only) qs.set("overdue_only", "1");
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await fetch(`${API_BASE_URL}/finance/ar?${qs.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new ApiError(`ar list failed: ${response.status}`, response.status);
    return (await response.json()) as { data: any[]; total: number; totalAmount: number; remainingAmount: number };
  },
  getARTopByCustomer: (limit: number = 10) => {
    return request<any>(`/finance/ar/top-by-customer?limit=${limit}`);
  },
  getAR: (id: string) => request<any>(`/finance/ar/${id}`),
  createAR: (input: any) =>
    request<any>("/finance/ar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateAR: (id: string, input: any) =>
    request<any>(`/finance/ar/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteAR: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/finance/ar/${id}`, {
      method: "DELETE"
    }),
  addARPayment: (arId: string, input: any) =>
    request<any>(`/finance/ar/${arId}/payments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),

  // ===== 客户跟进 Follow-up =====
  listFollowUps: async (params: {
    customer_id?: string;
    stage?: string;
    year?: number;
    archived?: boolean;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.customer_id) qs.set("customer_id", params.customer_id);
    if (params.stage) qs.set("stage", params.stage);
    if (params.year) qs.set("year", String(params.year));
    if (params.archived !== undefined) qs.set("archived", params.archived ? "1" : "0");
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    const response = await fetch(`${API_BASE_URL}/follow-up?${qs.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new ApiError(`follow-up list failed: ${response.status}`, response.status);
    return (await response.json()) as { data: any[]; total: number; totalAll: number };
  },
  getFollowUp: (id: string) => request<any>(`/follow-up/${id}`),
  getFollowUpStages: () => request<any>("/follow-up/stages"),
  createFollowUp: (input: any) =>
    request<any>("/follow-up", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateFollowUp: (id: string, input: any) =>
    request<any>(`/follow-up/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  advanceFollowUp: (id: string, stage: string, notes?: string) =>
    request<any>(`/follow-up/${id}/advance`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, notes: notes || null })
    }),
  closeFollowUp: (id: string, closeReason: string, closeNotes: string) =>
    request<any>(`/follow-up/${id}/close`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closeReason, closeNotes })
    }),
  getCustomerCertTypes: (customerId: string) =>
    request<{ data: string[] }>(`/follow-up/customer-types/${customerId}`),
  getCustomerHistoryScope: (customerId: string) =>
    request<{ data: any[] }>(`/customers/${customerId}/history-scope`),
  getAuditPlanByFollowUp: (followUpId: string) =>
    request<{ data: any[] }>(`/follow-up/${followUpId}/audit-plan`),
  listAuditTemplates: () =>
    request<{ data: any[] }>("/audit-templates"),
  deleteFollowUp: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/follow-up/${id}`, {
      method: "DELETE"
    }),
  archiveFollowUpYear: (year: number) =>
    request<any>(`/follow-up/archive-year/${year}`, { method: "POST" }),
  importFollowUpsFromNotifications: (notifications: Array<{
    customerName?: string;
    customerPhone?: string;
    stage?: string;
    year?: number;
    expectedDate?: string;
    contractAmount?: number;
    certificationType?: string;
    issuingBody?: string;
    summary?: string;
    sourceApp?: string;
  }>) =>
    request<any>("/follow-up/import-from-notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifications })
    }),
  ensureFollowUpForCustomer: (customerId: string, year?: number, certificationType?: string) =>
    request<any>("/follow-up/ensure-for-customer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, year, certificationType })
    }),
  batchEnsureFollowUp: (customerIds: string[], year?: number, certificationType?: string) =>
    request<any>("/follow-up/batch-ensure", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_ids: customerIds, year, certification_type: certificationType })
    }),
  autoFollowUpFromHistory: (year?: number, limit?: number) => {
    const qs = new URLSearchParams();
    if (year) qs.set("year", String(year));
    if (limit) qs.set("limit", String(limit));
    const path = qs.toString() ? `/follow-up/auto-from-history?${qs.toString()}` : "/follow-up/auto-from-history";
    return request<any>(path, { method: "POST" });
  },

  // ===== Customers =====
  listCustomers: async (params: {
    q?: string;
    status?: string;
    service_stage?: string;
    industry?: string;
    tags?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.service_stage) qs.set("service_stage", params.service_stage);
    if (params.industry) qs.set("industry", params.industry);
    if (params.tags) qs.set("tags", params.tags);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    // 后端返回 { data: [...], total }
    // request 会自动解包 data 字段，所以这里再 fetch 一次拿到完整响应
    const response = await fetch(`${API_BASE_URL}/customers?${qs.toString()}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new ApiError(`customers list failed: ${response.status}`, response.status);
    return (await response.json()) as { data: any[]; total: number };
  },
  searchCustomers: (q: string, limit = 20) =>
    request<{ data: any[]; total: number }>(`/customers?q=${encodeURIComponent(q)}&limit=${limit}`),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  exportCustomers: (params: {
    q?: string;
    industry?: string;
    status?: string;
    service_stage?: string;
    tags?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.industry) qs.set("industry", params.industry);
    if (params.status) qs.set("status", params.status);
    if (params.service_stage) qs.set("service_stage", params.service_stage);
    if (params.tags) qs.set("tags", params.tags);
    const path = qs.toString() ? `/customers/export.csv?${qs.toString()}` : "/customers/export.csv";
    return fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: { Accept: "text/csv" }
    });
  },
  createCustomer: (input: any) =>
    request<any>("/customers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateCustomer: (id: string, input: any) =>
    request<any>(`/customers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteCustomer: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(`/customers/${id}`, {
      method: "DELETE"
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

  // ===== PDF 转 Word =====
  pdfToDocx: async (file: File, model: string = "ollama"): Promise<{ blob: Blob; filename: string }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("model", model);
    const r = await fetch(`${API_BASE_URL}/pdf/to-docx`, {
      method: "POST",
      body: form,
      credentials: "include"
    });
    if (!r.ok) {
      let message = `convert failed: ${r.status}`;
      try {
        const errData = await r.json();
        if (errData?.message) message = errData.message;
      } catch { /* ignore */ }
      throw new Error(message);
    }
    const dispo = r.headers.get("Content-Disposition") || "";
    const match = dispo.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : `${file.name.replace(/\.pdf$/i, "")}.docx`;
    return { blob: await r.blob(), filename };
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

  // ===== V2.0 系统基础数据（签约主体/外协/风险等级）=====
  listSigningEntities: () => request<any[]>("/system-enum/signing-entities"),
  createSigningEntity: (input: any) =>
    request<any>("/system-enum/signing-entities", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateSigningEntity: (id: string, input: any) =>
    request<any>(`/system-enum/signing-entities/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteSigningEntity: (id: string) =>
    request<any>(`/system-enum/signing-entities/${id}`, { method: "DELETE" }),

  listPartners: () => request<any[]>("/system-enum/partners"),
  createPartner: (input: any) =>
    request<any>("/system-enum/partners", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updatePartner: (id: string, input: any) =>
    request<any>(`/system-enum/partners/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deletePartner: (id: string) =>
    request<any>(`/system-enum/partners/${id}`, { method: "DELETE" }),

  listRiskLevels: () => request<any[]>("/system-enum/risk-levels"),
  createRiskLevel: (input: any) =>
    request<any>("/system-enum/risk-levels", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  updateRiskLevel: (id: string, input: any) =>
    request<any>(`/system-enum/risk-levels/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    }),
  deleteRiskLevel: (id: string) =>
    request<any>(`/system-enum/risk-levels/${id}`, { method: "DELETE" }),
  knowledgeVersions: (docCode: string) =>
    request<Array<{ id: string; version: number; change_summary: string; creator: string | null; created_at: string }>>(
      `/knowledge/${docCode}/versions`
    ),
  expiringKnowledge: (days = 30) =>
    request<Array<{ doc_code: string; title: string; category: string; effective_to: string; days_remaining: number }>>(
      `/quality/expiring?days=${days}`
    ),
  listSignatories: () => request<{ data: Signatory[] }>("/signatories"),
  listServiceTypes: () => request<{ data: ServiceType[] }>("/service-types"),
  listPartnerOrgs: () => request<{ data: PartnerOrg[] }>("/partner-orgs"),
  createPartnerOrg: (input: { name: string; contactPerson?: string; contactPhone?: string; address?: string; notes?: string; }) =>
    request<{ data: PartnerOrg }>("/partner-orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  listCertificationProjects: (filter: { status?: string; customerId?: string; ownerId?: string; overdue?: boolean; limit?: number; offset?: number; } = {}) => {
    const qs = new URLSearchParams();
    if (filter.status && filter.status !== "all") qs.set("status", filter.status);
    if (filter.customerId) qs.set("customer_id", filter.customerId);
    if (filter.ownerId) qs.set("owner_id", filter.ownerId);
    if (filter.overdue) qs.set("overdue", "true");
    if (filter.limit) qs.set("limit", String(filter.limit));
    if (filter.offset) qs.set("offset", String(filter.offset));
    return request<{ data: Project[]; total: number }>(`/projects?${qs}`);
  },
  getCertificationProjectStats: () => request<{ data: Record<string, number> }>("/projects/stats"),
  listOverdueCertificationProjects: () => request<{ data: Project[] }>("/projects/overdue"),
  listPendingPaymentCertificationProjects: () => request<{ data: Project[] }>("/projects/pending-payment"),
  listPendingCertCertificationProjects: () => request<{ data: Project[] }>("/projects/pending-cert"),
  getCertificationProject: (id: string) => request<{ data: Project }>(`/projects/${id}`),
  createCertificationProject: (input: any) => request<{ data: Project }>("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  changeCertificationProjectStatus: (id: string, status: string, reason?: string) => request<{ data: Project }>(`/projects/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reason }) }),
  getCertificationProjectTimeline: (id: string) => request<{ data: ProjectTimelineEvent[] }>(`/projects/${id}/timeline`),
  listProjectPayments: (projectId: string) =>
    request<{ data: any[] }>(`/projects/${projectId}/payments`),
  createProjectPayment: (projectId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/payments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  updateProjectPayment: (projectId: string, paymentId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/payments/${paymentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  deleteProjectPayment: (projectId: string, paymentId: string) =>
    request<{ data: any }>(`/projects/${projectId}/payments/${paymentId}`, { method: "DELETE" }),
  listProjectInvoices: (projectId: string) =>
    request<{ data: any[] }>(`/projects/${projectId}/invoices`),
  createProjectInvoice: (projectId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/invoices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  listProjectCorrections: (projectId: string) =>
    request<{ data: any[] }>(`/projects/${projectId}/corrections`),
  createProjectCorrection: (projectId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/corrections`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  updateProjectCorrection: (projectId: string, id: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/corrections/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  listProjectDocuments: (projectId: string) =>
    request<{ data: any[] }>(`/projects/${projectId}/documents`),
  createProjectDocument: (projectId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/documents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  listProjectReviews: (projectId: string) =>
    request<{ data: any[] }>(`/projects/${projectId}/reviews`),
  createProjectReview: (projectId: string, input: any) =>
    request<{ data: any }>(`/projects/${projectId}/reviews`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
};

export { API_BASE_URL };

// 暴露部分 API 方法作为独立导出
export const listTransactions = api.listTransactions;
export const getCustomer = (id: string) => request<any>(`/customers/${id}`);

// ===== Todo (待办) =====
export function listTodos(params: { status?: string; category?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.category) qs.set("category", params.category);
  qs.set("limit", String(params.limit ?? 100));
  qs.set("offset", String(params.offset ?? 0));
  return request<{ data: any[]; total: number }>(`/todo?${qs.toString()}`);
}
export function createTodo(input: any) {
  return request<any>("/todo", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}
export function updateTodo(id: string, input: any) {
  return request<any>(`/todo/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}
export function deleteTodo(id: string) {
  return request<{ data: { id: string; deleted: boolean } }>(`/todo/${id}`, { method: "DELETE" });
}

// ===== YoooClaw 录音导入 =====
export function importYoooclawRecording(payload: {
  recordingId: string;
  recordingName?: string;
  transcript: string;
  summary?: string;
  durationSec?: number;
  todos?: Array<any>;
  followUps?: Array<any>;
}) {
  return request<any>("/yoooclaw/import-recording", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}
export function listImportedRecordings(limit = 50) {
  return request<{ data: any[] }>(`/yoooclaw/imported-recordings?limit=${limit}`);
}

// 智能提取：自动从转写文本提取 todo / follow_up / knowledge
export function autoExtractYoooclawRecording(payload: {
  recordingId: string;
  recordingName?: string;
  transcript: string;
  durationSec?: number;
}) {
  return request<any>("/yoooclaw/auto-extract", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}

// ===== 页面助手 =====
export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function assistantChat(payload: {
  message: string;
  history?: AssistantMessage[];
  context?: { currentPage?: string };
}) {
  // 助手返回 {data: {reply, toolCalls, ...}}，需要保留 data 层
  // /ai/ 前缀是 Apache 反代到 :3001
  const base = ((import.meta as any).env?.BASE_URL || "/ai/") as string;
  const url = base + "api/assistant/chat";
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(async (res) => {
    const body = await res.text();
    const json = body ? JSON.parse(body) : { data: { reply: "(空响应)" } };
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
    return json;
  });
}

export function assistantConfirm(payload: { toolName: string; args: any }) {
  const base = ((import.meta as any).env?.BASE_URL || "/ai/") as string;
  const url = base + "api/assistant/confirm";
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(async (res) => {
    const body = await res.text();
    const json = body ? JSON.parse(body) : { data: { reply: "(空响应)", success: false } };
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
    return json;
  });
}
