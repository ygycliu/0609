import { useState, useEffect, useRef } from "react";
import {
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  File,
  Upload,
  Download,
  Trash2,
  X,
  ClipboardList,
  CheckCircle2,
  Loader2,
  Save,
  Plus
} from "lucide-react";
import { api, API_BASE_URL, type ReportAttachment, type ReportAttachmentSummary } from "../lib/api";

interface AuditPlanInput {
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

interface ChecklistItem {
  id?: string;          // DB item id (after session created)
  clause: string;
  standard: string;
  department: string;
  question: string;
  evidence: string;
  result: "pass" | "ng_major" | "ng_minor" | "observation" | "pending";
  notes: string;
  attachments?: Attachment[];
}

interface Attachment {
  id: string;
  original_name: string;
  file_type: string;
  size_bytes: number | string;
  mime_type?: string;
  created_at: string;
  url: string;
}

interface AuditReport {
  nonConformances: any[];
  report: string;
  conclusion: string;
  summary: { total: number; major: number; minor: number; observation: number };
}

const AUDIT_TYPES = [
  { value: "initial", label: "初次认证" },
  { value: "surveillance", label: "监督审核" },
  { value: "recertification", label: "再认证" }
] as const;

const STANDARDS = [
  { value: "iso9001", label: "ISO 9001 质量管理体系" },
  { value: "iso14001", label: "ISO 14001 环境管理体系" },
  { value: "iso45001", label: "ISO 45001 职业健康安全管理体系" }
];

const RESULT_OPTIONS = [
  { value: "pending", label: "待审核", color: "#9ca3af", bg: "#f3f4f6" },
  { value: "pass", label: "符合", color: "#10b981", bg: "#d1fae5" },
  { value: "ng_major", label: "严重不符合", color: "#ef4444", bg: "#fee2e2" },
  { value: "ng_minor", label: "一般不符合", color: "#f59e0b", bg: "#fef3c7" },
  { value: "observation", label: "观察项", color: "#3b82f6", bg: "#dbeafe" }
];

function fileIcon(type: string) {
  const t = type.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(t)) return ImageIcon;
  if (["mp4", "mov", "avi", "webm", "mkv", "flv"].includes(t)) return Video;
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(t)) return Music;
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(t)) return Archive;
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"].includes(t)) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AuditorPage() {
  const [step, setStep] = useState<"input" | "plan" | "checklist" | "upload" | "report">("input") as any;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 客户选择下拉状态
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState<Array<{
    id: string;
    customerCode: string;
    name: string;
    industry: string | null;
    employeeCount: number | null;
    region?: string | null;
    contactPerson?: string | null;
    contactPhone?: string | null;
  }>>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  // 输入数据
  const [input, setInput] = useState<AuditPlanInput>({
    customerName: "",
    industry: "",
    employeeCount: 50,
    auditType: "surveillance",
    standards: ["iso9001", "iso14001", "iso45001"],
    address: "",
    contactPerson: "",
    contactPhone: "",
    scheduledDate: ""
  });

  // 会话/生成结果
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ markdown: string; references: string[] } | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  // 报告级附件 state
  const [reportAttachments, setReportAttachments] = useState<ReportAttachment[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportAttachmentSummary | null>(null);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [attachmentsReady, setAttachmentsReady] = useState(false);
  const reportFileInputRef = useRef<HTMLInputElement | null>(null);

  // 上传中状态
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // 搜索客户（debounced）
  const handleSearchCustomers = async (query: string) => {
    setSearchingCustomers(true);
    try {
      const results: any = await api.searchCustomers(query, 20);
      setCustomerOptions((results && results.data) || results || []);
    } catch (e) {
      console.error("搜索客户失败:", e);
      setCustomerOptions([]);
    } finally {
      setSearchingCustomers(false);
    }
  };

  // 选中客户
  const handleSelectCustomer = (c: any) => {
    setSelectedCustomer(c);
    setCustomerDropdownOpen(false);
    // 自动填入字段
    setInput(prev => ({
      ...prev,
      customerName: c.name,
      industry: c.industry ?? prev.industry,
      employeeCount: c.employeeCount ?? prev.employeeCount,
      address: c.region ?? prev.address,
      contactPerson: c.contactPerson ?? prev.contactPerson,
      contactPhone: c.contactPhone ?? prev.contactPhone,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!input.customerName || !input.industry || input.standards.length === 0) {
      setError("客户名/行业/标准 必填");
      return;
    }
    setLoading(true);
    try {
      const data = await api.auditorPlan(input);
      setPlan({ markdown: data.plan, references: data.references });
      setStep("plan");
    } catch (e: any) {
      setError(e?.message ?? "生成计划失败");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateChecklist = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.auditorChecklist(input);
      const items: ChecklistItem[] = data.checklist.map((c: any) => ({
        ...c,
        result: "pending",
        notes: "",
        attachments: []
      }));
      setChecklist(items);

      // 立即创建会话（持久化到 DB）
      try {
        const ses = await api.auditorCreateSession({
          ...input,
          checklist: items.map(it => ({
            clause: it.clause,
            standard: it.standard,
            department: it.department,
            question: it.question,
            evidence: it.evidence,
            result: it.result,
            notes: it.notes
          }))
        });
        setSessionId(ses.sessionId);
        // 把 item id 写回 checklist
        // 由于后端未返回 item id 列表，我们异步 pull 一次
      } catch (sesErr: any) {
        console.warn("Create session failed (will retry on report):", sesErr);
      }
      setStep("checklist");
    } catch (e: any) {
      setError(e?.message ?? "生成检查表失败");
    } finally {
      setLoading(false);
    }
  };

  // 加载会话的 item id 映射
  useEffect(() => {
    if (sessionId && checklist && !checklist[0]?.id) {
      api.auditorGetSession(sessionId).then((data) => {
        const itemMap = new Map<string, ChecklistItem>();
        data.items.forEach((it: any) => {
          itemMap.set(`${it.clause}__${it.standard}__${it.question}`, {
            ...it,
            attachments: it.attachments || []
          });
        });
        const updated = checklist.map(local => {
          const key = `${local.clause}__${local.standard}__${local.question}`;
          const found = itemMap.get(key);
          return found ? { ...local, id: found.id, attachments: found.attachments } : local;
        });
        setChecklist(updated);
      }).catch(err => console.warn("Failed to load session items:", err));
    }
  }, [sessionId]);


  useEffect(() => {
    if (step === "upload" && sessionId) loadReportAttachments();
  }, [step, sessionId]);

  const handleUpdateItem = (idx: number, key: keyof ChecklistItem, value: string) => {
    if (!checklist) return;
    const updated = [...checklist];
    (updated[idx] as any)[key] = value;
    setChecklist(updated);

    // 同步到 DB
    const item = updated[idx];
    if (item.id && (key === "result" || key === "notes")) {
      api.auditorUpdateItem(item.id, { [key]: value }).catch(err =>
        console.warn(`Update ${key} failed:`, err)
      );
    }
  };

  const handleUpload = async (itemId: string, file: File) => {
    if (!file) return;
    setError(null);
    setUploadingItemId(itemId);
    try {
      const result = await api.auditorUploadAttachment(itemId, file);
      // 更新本地 checklist
      if (checklist) {
        const updated = checklist.map(item =>
          item.id === itemId
            ? { ...item, attachments: [...(item.attachments ?? []), result.data] }
            : item
        );
        setChecklist(updated);
      }
    } catch (e: any) {
      setError(`上传失败: ${e?.message ?? "未知错误"}`);
    } finally {
      setUploadingItemId(null);
    }
  };

  const handleDeleteAttachment = async (itemId: string, attachmentId: string) => {
    if (!confirm("确认删除此附件？")) return;
    try {
      await api.auditorDeleteAttachment(attachmentId);
      if (checklist) {
        const updated = checklist.map(item =>
          item.id === itemId
            ? { ...item, attachments: (item.attachments ?? []).filter(a => a.id !== attachmentId) }
            : item
        );
        setChecklist(updated);
      }
    } catch (e: any) {
      setError(`删除失败: ${e?.message ?? "未知错误"}`);
    }
  };


  // ====== 报告级附件 ======
  const loadReportAttachments = async () => {
    if (!sessionId) return;
    try {
      const r = await api.auditorGetReportAttachments(sessionId);
      setReportAttachments(r.items);
      setReportSummary(r.summary);
    } catch (e: any) {
      console.warn("load report attachments failed:", e);
    }
  };

  const handleUploadReportAttachment = async (file: File, caption?: string) => {
    if (!sessionId) return;
    setError(null);
    setUploadingReport(true);
    try {
      await api.auditorUploadReportAttachment(sessionId, file, caption);
      await loadReportAttachments();
    } catch (e: any) {
      setError(`报告附件上传失败: ${e?.message ?? "未知错误"}`);
    } finally {
      setUploadingReport(false);
    }
  };

  const handleDeleteReportAttachment = async (id: string) => {
    if (!confirm("确认删除此附件？")) return;
    try {
      await api.auditorDeleteReportAttachment(id);
      await loadReportAttachments();
    } catch (e: any) {
      setError(`删除失败: ${e?.message ?? "未知错误"}`);
    }
  };

  const handleSetAttachmentsReady = async (ready: boolean) => {
    if (!sessionId) return;
    try {
      await api.auditorSetAttachmentsReady(sessionId, ready);
      setAttachmentsReady(ready);
    } catch (e: any) {
      setError(`状态变更失败: ${e?.message ?? "未知错误"}`);
    }
  };

  const handleGenerateReport = async () => {
    if (!checklist) return;
    setError(null);
    setLoading(true);
    try {
      const data = await api.auditorReport({
        ...input,
        scheduledDate: input.scheduledDate || "见审核计划",
        checklist: checklist.map(it => ({
          clause: it.clause,
          standard: it.standard,
          department: it.department,
          question: it.question,
          result: it.result,
          notes: it.notes
        }))
      });
      setReport(data);
      setStep("report");
    } catch (e: any) {
      setError(e?.message ?? "生成报告失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page auditor-page">
      <header className="page-header">
        <h2><ClipboardList size={24} style={{ verticalAlign: "middle", marginRight: 8 }} />数字审核员工作台</h2>
        <p className="page-subtitle">
          基于 ISO 9001/14001/45001 + 中认内部审核指导书 + 闳达完整案例的 QES 审核材料生成。
          <strong>4 步流程：① 输入客户 → ② 生成审核计划 → ③ 检查表（每项可上传附件）→ ④ 不符合项 + 审核报告</strong>
        </p>
      </header>

      <div className="audit-steps">
        <div className={`audit-step ${step === "input" ? "active" : step !== "input" ? "done" : ""}`}>
          <span className="step-num">1</span> 输入客户
        </div>
        <div className={`audit-step ${step === "plan" ? "active" : step === "checklist" || step === "report" ? "done" : ""}`}>
          <span className="step-num">2</span> 审核计划
        </div>
        <div className={`audit-step ${step === "checklist" ? "active" : step === "report" ? "done" : ""}`}>
          <span className="step-num">3</span> 检查表
        </div>
        <div className={`audit-step ${step === "report" ? "active" : ""}`}>
          <span className="step-num">4</span> 报告
        </div>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} className="close-btn"><X size={16} /></button>
        </div>
      )}

      {step === "input" && (
        <form onSubmit={handleSubmit} className="audit-form">
          <div className="form-grid">
            <label className="form-field customer-combobox">
              <span>客户名称 *</span>
              <div className="combobox-wrapper">
                <input
                  type="text"
                  value={input.customerName}
                  onChange={(e) => {
                    setInput({ ...input, customerName: e.target.value });
                    setCustomerSearch(e.target.value);
                    setCustomerDropdownOpen(true);
                  }}
                  onFocus={() => {
                    setCustomerDropdownOpen(true);
                    // 第一次打开就搜索空字符串 - 返回前 20 个
                    if (customerOptions.length === 0) {
                      handleSearchCustomers("");
                    }
                  }}
                  onBlur={() => {
                    // 延迟关闭，让用户点击选项生效
                    setTimeout(() => setCustomerDropdownOpen(false), 200);
                  }}
                  placeholder="🔍 搜索客户名或编号..."
                  required
                  autoComplete="off"
                />
                {customerDropdownOpen && customerOptions.length > 0 && (
                  <ul className="combobox-dropdown">
                    {customerOptions.map(c => (
                      <li
                        key={c.id}
                        className={`combobox-item ${selectedCustomer?.id === c.id ? 'selected' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectCustomer(c)}
                      >
                        <div className="item-name">{c.name}</div>
                        <div className="item-meta">
                          <span className="item-code">{c.customerCode}</span>
                          {c.industry && <span className="item-tag">{c.industry}</span>}
                          {c.employeeCount && <span className="item-tag">{c.employeeCount} 人</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {searchingCustomers && (
                  <div className="combobox-loading">
                    <Loader2 className="spin" size={14} /> 搜索中...
                  </div>
                )}
              </div>
            </label>
            <label className="form-field">
              <span>
                行业 *
                {selectedCustomer?.industry && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setInput({ ...input, industry: selectedCustomer.industry ?? "" })}
                    title="从所选客户重新带入"
                  >
                    ⟲ 同步
                  </button>
                )}
              </span>
              <input
                type="text"
                value={input.industry}
                onChange={(e) => setInput({ ...input, industry: e.target.value })}
                placeholder={selectedCustomer?.industry ? "已从客户自动带入（可手动修改）" : "选择客户后自动带入"}
                required
                className={selectedCustomer?.industry ? "auto-filled" : ""}
              />
            </label>
            <label className="form-field">
              <span>员工人数</span>
              <input
                type="number"
                value={input.employeeCount}
                onChange={(e) => setInput({ ...input, employeeCount: Number(e.target.value) })}
                min={1}
              />
            </label>
            <label className="form-field">
              <span>审核类型 *</span>
              <select
                value={input.auditType}
                onChange={(e) => setInput({ ...input, auditType: e.target.value as any })}
              >
                {AUDIT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="form-field form-field-wide">
              <span>审核地址</span>
              <input
                type="text"
                value={input.address}
                onChange={(e) => setInput({ ...input, address: e.target.value })}
                placeholder="例：宁夏吴忠市盐池县高沙窝镇"
              />
            </label>
            <label className="form-field">
              <span>联系人</span>
              <input
                type="text"
                value={input.contactPerson}
                onChange={(e) => setInput({ ...input, contactPerson: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>联系电话</span>
              <input
                type="text"
                value={input.contactPhone}
                onChange={(e) => setInput({ ...input, contactPhone: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>计划审核日期</span>
              <input
                type="date"
                value={input.scheduledDate}
                onChange={(e) => setInput({ ...input, scheduledDate: e.target.value })}
              />
            </label>
            <div className="form-field form-field-wide">
              <span>认证标准 *</span>
              <div className="checkbox-group">
                {STANDARDS.map(s => (
                  <label key={s.value} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={input.standards.includes(s.value as any)}
                      onChange={(e) => {
                        const v = s.value as any;
                        if (e.target.checked) {
                          setInput({ ...input, standards: [...input.standards, v] });
                        } else {
                          setInput({ ...input, standards: input.standards.filter(x => x !== v) });
                        }
                      }}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "生成中..." : "生成审核计划 →"}
          </button>
        </form>
      )}

      {step === "plan" && plan && (
        <div className="audit-content">
          <div className="audit-toolbar">
            <button className="ghost-button" onClick={() => setStep("input")}>← 返回修改</button>
            <button className="primary-button" onClick={handleGenerateChecklist} disabled={loading}>
              {loading ? "生成中..." : "生成现场检查表 →"}
            </button>
          </div>
          <div className="card">
            <h3>📋 审核计划（{plan.references.length} 条参考）</h3>
            {plan.references.length > 0 && (
              <div className="references">
                <strong>参考知识：</strong>
                {plan.references.map((r, i) => <span key={i} className="ref-tag">{r}</span>)}
              </div>
            )}
            <pre className="markdown-content">{plan.markdown}</pre>
          </div>
        </div>
      )}

      {step === "checklist" && checklist && (
        <div className="audit-content">
          <div className="audit-toolbar">
            <button className="ghost-button" onClick={() => setStep("plan")}>← 返回计划</button>
            <div className="toolbar-info">
              {sessionId ? (
                <span className="session-badge">
                  <Save size={14} /> 会话已保存: {sessionId.slice(0, 8)}...
                </span>
              ) : (
                <span className="session-badge warning">未持久化（仅前端）</span>
              )}
            </div>
            <button className="primary-button" onClick={() => setStep("upload")}>
              下一步：上传现场文件 →
            </button>
          </div>
          <div className="card">
            <h3>📝 现场检查表（{checklist.length} 项）<span className="hint">每项可上传附件（图片/视频/文档等）</span></h3>
            <p className="hint">请勾选每项结果（pass/ng_major/ng_minor/observation），并记录事实 + 上传证据</p>
            <table className="checklist-table">
              <thead>
                <tr>
                  <th>条款</th>
                  <th>标准</th>
                  <th>部门</th>
                  <th>问题</th>
                  <th>证据</th>
                  <th>结果</th>
                  <th>备注</th>
                  <th>附件</th>
                </tr>
              </thead>
              <tbody>
                {checklist.map((item, idx) => {
                  const resultOpt = RESULT_OPTIONS.find(r => r.value === item.result);
                  const Icon = resultOpt?.value === "pass" ? CheckCircle2 : null;
                  return (
                    <tr key={idx} style={{ borderLeft: `4px solid ${resultOpt?.color ?? "#9ca3af"}` }}>
                      <td><code>{item.clause}</code></td>
                      <td>{item.standard}</td>
                      <td>{item.department}</td>
                      <td className="question-cell">{item.question}</td>
                      <td className="evidence-cell">{item.evidence}</td>
                      <td>
                        <select
                          value={item.result}
                          onChange={(e) => handleUpdateItem(idx, "result", e.target.value as any)}
                          className="result-select"
                          style={{
                            borderColor: resultOpt?.color,
                            backgroundColor: resultOpt?.bg,
                            color: resultOpt?.color
                          }}
                        >
                          {RESULT_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) => handleUpdateItem(idx, "notes", e.target.value)}
                          placeholder="事实/证据"
                          className="notes-input"
                        />
                      </td>
                      <td className="attachment-cell">
                        <input
                          ref={(el) => { fileInputRefs.current[item.id ?? `idx-${idx}`] = el; }}
                          type="file"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && item.id) {
                              handleUpload(item.id, file);
                            } else if (file && !item.id) {
                              setError("等待会话同步完成再上传");
                            }
                            e.target.value = "";
                          }}
                        />
                        <button
                          className="upload-btn"
                          onClick={() => {
                            const key = item.id ?? `idx-${idx}`;
                            fileInputRefs.current[key]?.click();
                          }}
                          disabled={uploadingItemId === item.id || !item.id}
                          title={item.id ? "点击上传附件" : "等待会话同步"}
                        >
                          {uploadingItemId === item.id ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Upload size={14} />
                          )}
                          上传
                        </button>
                        <div className="attachment-list">
                          {(item.attachments ?? []).map(att => {
                            const FileIco = fileIcon(att.file_type);
                            return (
                              <div key={att.id} className="attachment-item">
                                <FileIco size={14} />
                                <a
                                  href={`/api/auditor/attachment/${att.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="attachment-link"
                                  title={att.original_name}
                                >
                                  <span className="attachment-name">{att.original_name}</span>
                                  <span className="attachment-size">{formatSize(Number(att.size_bytes))}</span>
                                </a>
                                <button
                                  className="delete-att-btn"
                                  onClick={() => handleDeleteAttachment(item.id!, att.id)}
                                  title="删除附件"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                          {(!item.attachments || item.attachments.length === 0) && (
                            <span className="no-attachments">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}



      {step === "upload" && (
        <div className="audit-content">
          <div className="audit-toolbar">
            <button className="ghost-button" onClick={() => setStep("checklist")}>← 返回检查表</button>
            <div className="toolbar-info">
              <span className="session-badge">
                <Save size={14} /> 会话: {sessionId?.slice(0, 8)}...
              </span>
            </div>
            <button className="primary-button" onClick={handleGenerateReport} disabled={loading}>
              {loading ? "生成中..." : "生成审核报告 →"}
            </button>
          </div>

          <div className="card">
            <h3>
              📎 现场文件上传（出报告前）
              {reportSummary && (
                <span className="summary-tags">
                  {reportSummary.photo > 0 && <span className="tag tag-photo">📷 {reportSummary.photo}</span>}
                  {reportSummary.recording > 0 && <span className="tag tag-recording">🎤 {reportSummary.recording}</span>}
                  {reportSummary.document > 0 && <span className="tag tag-doc">📄 {reportSummary.document}</span>}
                  {reportSummary.video > 0 && <span className="tag tag-video">🎬 {reportSummary.video}</span>}
                  <span className="tag tag-total">共 {reportSummary.total}</span>
                </span>
              )}
            </h3>
            <p className="hint">
              请上传现场照片、录音、签字表等证据文件。出报告前需点击"标记就绪"。
              上传完成后，点击"标记就绪"才能生成审核报告。
            </p>

            <input
              ref={reportFileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadReportAttachment(file);
                e.target.value = "";
              }}
            />

            <div className="upload-actions">
              <button
                className="upload-btn-primary"
                onClick={() => reportFileInputRef.current?.click()}
                disabled={uploadingReport || !sessionId}
              >
                {uploadingReport ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                上传现场照片 / 文档
              </button>
              <button
                className={attachmentsReady ? "upload-btn-ready active" : "upload-btn-ready"}
                onClick={() => handleSetAttachmentsReady(!attachmentsReady)}
                disabled={!sessionId}
              >
                {attachmentsReady ? "✅ 附件已就绪（点击取消）" : "标记附件就绪"}
              </button>
            </div>

            <div className="report-attachments-grid">
              {reportAttachments.length === 0 ? (
                <p className="empty-state">还没有上传任何附件</p>
              ) : (
                reportAttachments.map(att => {
                  const FileIco = fileIcon(att.file_type);
                  return (
                    <div key={att.id} className={`report-attachment-card cat-${att.category}`}>
                      <div className="card-header">
                        <FileIco size={18} />
                        <span className="cat-label">
                          {att.category === "photo" ? "照片" :
                           att.category === "recording" ? "录音" :
                           att.category === "document" ? "文档" :
                           att.category === "video" ? "视频" : "其他"}
                        </span>
                      </div>
                      <div className="card-name">{att.original_name}</div>
                      <div className="card-meta">
                        {formatSize(att.size_bytes)} · {new Date(att.created_at).toLocaleString("zh-CN")}
                      </div>
                      {att.caption && <div className="card-caption">备注: {att.caption}</div>}
                      <div className="card-actions">
                        <a
                          href={`${API_BASE_URL}/auditor/report-attachment/${att.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="card-link"
                        >
                          <Download size={12} /> 下载
                        </a>
                        <button
                          className="card-delete"
                          onClick={() => handleDeleteReportAttachment(att.id)}
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {step === "report" && report && (
        <div className="audit-content">
          <div className="audit-toolbar">
            <button className="ghost-button" onClick={() => setStep("upload")}>← 上传现场文件</button>
            <button className="primary-button" onClick={() => window.print()}>🖨 打印/导出 PDF</button>
          </div>
          <div className="card">
            <h3>
              📊 审核报告
              <span className={`conclusion-badge ${report.conclusion}`}>
                {report.conclusion === "recommend" ? "推荐认证" :
                 report.conclusion === "recommend_with_action" ? "推荐认证（含整改）" :
                 "不推荐认证"}
              </span>
            </h3>
            <div className="summary-stats">
              <div className="stat"><strong>总不符合项：</strong>{report.summary.total}</div>
              <div className="stat stat-major"><strong>严重：</strong>{report.summary.major}</div>
              <div className="stat stat-minor"><strong>一般：</strong>{report.summary.minor}</div>
              <div className="stat stat-obs"><strong>观察：</strong>{report.summary.observation}</div>
            </div>

            {report.nonConformances.length > 0 && (
              <div className="ng-list">
                <h4>不符合项详情</h4>
                {report.nonConformances.map((ng, i) => (
                  <div key={i} className={`ng-card ${ng.level}`}>
                    <div className="ng-header">
                      <strong>{i + 1}. [{ng.standard} {ng.clause}] {ng.standardName}</strong>
                      <span className={`ng-level ${ng.level}`}>
                        {ng.level === "major" ? "严重" : ng.level === "minor" ? "一般" : "观察"}
                      </span>
                    </div>
                    <div className="ng-body">
                      <p><strong>事实：</strong>{ng.fact}</p>
                      <p><strong>标准要求：</strong>{ng.requirement}</p>
                      <p><strong>不符合：</strong>{ng.gap}</p>
                      <p><strong>纠正要求：</strong>{ng.correctiveRequirement}</p>
                      <p><strong>期限：</strong>{ng.deadlineDays} 天 / <strong>验证：</strong>{ng.verificationMethod}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h4>完整审核报告</h4>
            <pre className="markdown-content">{report.report}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
