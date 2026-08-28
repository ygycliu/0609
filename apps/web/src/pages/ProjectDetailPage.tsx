import { useEffect, useState } from "react";
import {
  AlertCircle, ArrowLeft, Calendar, CheckCircle2, CheckSquare, ChevronRight, FileText,
  FileUp, Loader2, MessageSquare, Plus, RefreshCw, Save, User, Wallet, X
} from "lucide-react";
import { api } from "../lib/api";
import {
  PROJECT_STATUS_LABEL, PROJECT_STATUS_TRANSITIONS,
  type Project, type ProjectStatus,
  type ProjectTimelineEvent
} from "../types";

// 业务阶段 → 状态机状态映射（漏斗的 10 个阶段）
const BUSINESS_STAGES: Array<{ stage: string; states: string[] }> = [
  { stage: "线索", states: ["lead"] },
  { stage: "沟通", states: ["communicating"] },
  { stage: "报价", states: ["quoted"] },
  { stage: "合同签订", states: ["contract_pending", "contract_signed", "contract_archived", "first_pay_pending", "first_paid"] },
  { stage: "合同评审", states: ["contract_review"] },
  { stage: "现场审核", states: ["expert_review_pending", "expert_reviewing", "delivery_prep", "doc_collecting"] },
  { stage: "整改中", states: ["correcting"] },
  { stage: "出证", states: ["final_pay_pending", "invoice_pending", "cert_pending", "certified"] },
  { stage: "邮寄证书", states: ["shipment_pending"] },
  { stage: "项目完成", states: ["completed"] },
  { stage: "取消", states: ["cancelled"] },
  { stage: "暂停", states: ["suspended"] },
  { stage: "风险", states: ["at_risk"] },
];

// 根据当前状态，找出允许的业务阶段选项
function getAllowedBusinessStages(currentStatus: string): Array<{ stage: string; states: string[] }> {
  const allowedStates = new Set<string>((PROJECT_STATUS_TRANSITIONS as any)[currentStatus] || []);
  // 找出当前状态对应的业务阶段
  const currentStageIdx = BUSINESS_STAGES.findIndex((bs) => bs.states.includes(currentStatus));
  return BUSINESS_STAGES
    .filter((bs) => {
      // 排除当前阶段自身
      const currentStage = BUSINESS_STAGES[currentStageIdx];
      if (currentStage && bs.stage === currentStage.stage) return false;
      // 该业务阶段下是否有任何状态在 allowed 列表中
      return bs.states.some((s) => allowedStates.has(s));
    });
}

interface ProjectDetailPageProps {
  projectId: string;
  onBack: () => void;
}

type Tab = "timeline" | "info" | "financial" | "documents" | "corrections";

export function ProjectDetailPage({ projectId, onBack }: ProjectDetailPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("timeline");
  const [changingStatus, setChangingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState<ProjectStatus | "">("");
  const [reason, setReason] = useState("");

  // 子模块数据
  const [payments, setPayments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);

  // Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // 表单 state
  const [paymentForm, setPaymentForm] = useState({ paymentType: "deposit", amount: "", receivedAmount: "", dueDate: "", notes: "" });
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNo: "", amount: "", taxRate: 6, issueDate: "", notes: "" });
  const [documentForm, setDocumentForm] = useState({ name: "", documentType: "contract", notes: "" });
  const [correctionForm, setCorrectionForm] = useState({ title: "", description: "", responsibleName: "", dueDate: "", notes: "" });
  const [reviewForm, setReviewForm] = useState({ reviewType: "contract", scheduledDate: "", reviewerName: "", notes: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [p, t, pay, inv, doc, cor, rev] = await Promise.all([
        api.getCertificationProject(projectId),
        api.getCertificationProjectTimeline(projectId),
        api.listProjectPayments(projectId).catch(() => ({ data: [] })),
        api.listProjectInvoices(projectId).catch(() => ({ data: [] })),
        api.listProjectDocuments(projectId).catch(() => ({ data: [] })),
        api.listProjectCorrections(projectId).catch(() => ({ data: [] })),
        api.listProjectReviews(projectId).catch(() => ({ data: [] }))
      ]);
      setProject((p as any).data || p);
      setTimeline((t as any).data || t || []);
      setPayments(((pay as any).data || pay) || []);
      setInvoices(((inv as any).data || inv) || []);
      setDocuments(((doc as any).data || doc) || []);
      setCorrections(((cor as any).data || cor) || []);
      setReviews(((rev as any).data || rev) || []);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [projectId]);

  async function handleStatusChange() {
    if (!project || !newStatus) return;
    if (!reason.trim()) { alert("请填写变更原因"); return; }
    try {
      await api.changeCertificationProjectStatus(project.id, newStatus, reason);
      setChangingStatus(false);
      setNewStatus("");
      setReason("");
      await load();
    } catch (e: any) {
      alert(e?.message || "状态变更失败");
    }
  }

  async function savePayment() {
    if (!paymentForm.amount) { alert("请填写金额"); return; }
    try {
      await api.createProjectPayment(projectId, {
        ...paymentForm,
        amount: Number(paymentForm.amount),
        receivableAmount: Number(paymentForm.amount),
        receivedAmount: Number(paymentForm.receivedAmount || 0)
      });
      setShowPaymentModal(false);
      setPaymentForm({ paymentType: "deposit", amount: "", receivedAmount: "", dueDate: "", notes: "" });
      await load();
    } catch (e: any) { alert(e?.message || "保存失败"); }
  }

  async function saveInvoice() {
    if (!invoiceForm.amount) { alert("请填写金额"); return; }
    try {
      await api.createProjectInvoice(projectId, {
        ...invoiceForm,
        amount: Number(invoiceForm.amount),
        taxRate: Number(invoiceForm.taxRate),
        taxAmount: Number(invoiceForm.amount) * Number(invoiceForm.taxRate) / 100
      });
      setShowInvoiceModal(false);
      setInvoiceForm({ invoiceNo: "", amount: "", taxRate: 6, issueDate: "", notes: "" });
      await load();
    } catch (e: any) { alert(e?.message || "保存失败"); }
  }

  async function saveDocument() {
    if (!documentForm.name) { alert("请填写文件名"); return; }
    try {
      await api.createProjectDocument(projectId, documentForm);
      setShowDocumentModal(false);
      setDocumentForm({ name: "", documentType: "contract", notes: "" });
      await load();
    } catch (e: any) { alert(e?.message || "保存失败"); }
  }

  async function saveCorrection() {
    if (!correctionForm.title) { alert("请填写标题"); return; }
    try {
      await api.createProjectCorrection(projectId, correctionForm);
      setShowCorrectionModal(false);
      setCorrectionForm({ title: "", description: "", responsibleName: "", dueDate: "", notes: "" });
      await load();
    } catch (e: any) { alert(e?.message || "保存失败"); }
  }

  async function updateCorrectionStatus(id: string, status: string) {
    try {
      await api.updateProjectCorrection(projectId, id, { status });
      await load();
    } catch (e: any) { alert(e?.message || "状态更新失败"); }
  }

  async function saveReview() {
    if (!reviewForm.scheduledDate) { alert("请填写日期"); return; }
    try {
      await api.createProjectReview(projectId, reviewForm);
      setShowReviewModal(false);
      setReviewForm({ reviewType: "contract", scheduledDate: "", reviewerName: "", notes: "" });
      await load();
    } catch (e: any) { alert(e?.message || "保存失败"); }
  }

  if (loading && !project) {
    return <div className="page-loading"><Loader2 className="spin" /> 加载中...</div>;
  }
  if (!project) {
    return <div className="page-error">项目不存在</div>;
  }

  // 计算财务汇总
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.receivedAmount || p.received_amount || 0), 0);
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const contractAmount = Number((project as any).contractAmount || (project as any).contract_amount || 0);
  const pendingAmount = Math.max(0, contractAmount - totalPaid);

  return (
    <div className="page-stack">
      <header className="page-header project-detail-header">
        <div>
          <button className="back-button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回工作台
          </button>
          <h1>
            <span className="project-code">{project.projectCode}</span>
            <span className={`status-pill status-${project.status}`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </h1>
          <p>{project.customerName} · {project.serviceTypeName} · {project.signatoryName}</p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={load}><RefreshCw size={16} /> 刷新</button>
          <button className="primary-button" onClick={() => setChangingStatus(true)}>
            变更状态
          </button>
        </div>
      </header>

      <section className="metric-grid">
        <div className="metric">
          <span>合同金额</span>
          <strong>{contractAmount ? `¥${contractAmount.toLocaleString()}` : "未填"}</strong>
          <small>签约金额</small>
        </div>
        <div className="metric">
          <span>已收款</span>
          <strong style={{ color: "#059669" }}>¥{totalPaid.toLocaleString()}</strong>
          <small>{payments.length} 笔记录</small>
        </div>
        <div className="metric">
          <span>已开票</span>
          <strong>¥{totalInvoiced.toLocaleString()}</strong>
          <small>{invoices.length} 张发票</small>
        </div>
        <div className="metric">
          <span>待收款</span>
          <strong style={{ color: "#d97706" }}>¥{pendingAmount.toLocaleString()}</strong>
          <small>合同 - 已收</small>
        </div>
      </section>

      <div className="tab-bar">
        <button className={`tab ${tab === "timeline" ? "active" : ""}`} onClick={() => setTab("timeline")}>
          <FileText size={14} /> 时间线
        </button>
        <button className={`tab ${tab === "info" ? "active" : ""}`} onClick={() => setTab("info")}>
          <User size={14} /> 项目信息
        </button>
        <button className={`tab ${tab === "financial" ? "active" : ""}`} onClick={() => setTab("financial")}>
          <Wallet size={14} /> 财务
        </button>
        <button className={`tab ${tab === "documents" ? "active" : ""}`} onClick={() => setTab("documents")}>
          <FileUp size={14} /> 资料
        </button>
        <button className={`tab ${tab === "corrections" ? "active" : ""}`} onClick={() => setTab("corrections")}>
          <AlertCircle size={14} /> 整改闭环
        </button>
      </div>

      {/* 时间线 */}
      {tab === "timeline" && (
        <section className="timeline-section">
          <div className="section-heading">
            <h3>项目时间线</h3>
            {reviews.length > 0 && <span className="muted">最近评审：{reviews.length} 次</span>}
          </div>
          {timeline.length === 0 && <p className="muted">暂无事件</p>}
          {timeline.map((e, i) => (
            <div key={i} className={`timeline-item timeline-${e.type}`}>
              <div className="timeline-dot" />
              <div className="timeline-body">
                <div className="timeline-time">
                  <Calendar size={12} /> {e.at.substring(0, 19).replace("T", " ")}
                  {e.operatorName && <span> · {e.operatorName}</span>}
                </div>
                <div className="timeline-content">
                  {e.type === "status" && (
                    <>
                      {e.fromStatus && (
                        <span className={`status-pill status-${e.fromStatus}`}>
                          {PROJECT_STATUS_LABEL[e.fromStatus as ProjectStatus] || e.fromStatus}
                        </span>
                      )}
                      <ChevronRight size={14} />
                      <span className={`status-pill status-${e.toStatus}`}>
                        {PROJECT_STATUS_LABEL[e.toStatus as ProjectStatus] || e.toStatus}
                      </span>
                      {e.reason && <span className="timeline-reason">· {e.reason}</span>}
                    </>
                  )}
                  {e.type === "log" && (
                    <>
                      <strong>{e.action}</strong>
                      {e.note && <span className="timeline-reason">· {JSON.stringify(e.note).substring(0, 80)}</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 项目信息 */}
      {tab === "info" && (
        <section className="info-section">
          <h3>项目信息</h3>
          <dl className="info-grid">
            <dt>项目编号</dt><dd>{project.projectCode}</dd>
            <dt>项目名称</dt><dd>{(project as any).projectName || project.customerName}</dd>
            <dt>客户名称</dt><dd>{project.customerName}</dd>
            <dt>联系人</dt><dd>{project.contactPerson || "未填"}</dd>
            <dt>联系电话</dt><dd>{project.contactPhone || "未填"}</dd>
            <dt>服务类型</dt><dd>{project.serviceTypeName}</dd>
            <dt>签约主体</dt><dd>{project.signatoryName}</dd>
            {(project as any).partnerCertUnitNameSnapshot && (
              <><dt>外协单位</dt><dd>{(project as any).partnerCertUnitNameSnapshot}</dd></>
            )}
            {project.industry && <><dt>行业</dt><dd>{project.industry}</dd></>}
            {project.riskLevel && <><dt>风险等级</dt><dd>{project.riskLevel}</dd></>}
            {project.salesSource && <><dt>销售来源</dt><dd>{project.salesSource}</dd></>}
            {project.certificationScope && <><dt>申请认证范围</dt><dd>{project.certificationScope}</dd></>}
            {project.certificationStandards && <><dt>认证标准</dt><dd>{project.certificationStandards}</dd></>}
            {project.notes && <><dt>备注</dt><dd>{project.notes}</dd></>}
            {project.salesName && <><dt>销售负责人</dt><dd>{project.salesName}</dd></>}
            {project.projectOwnerName && <><dt>项目负责人</dt><dd>{project.projectOwnerName}</dd></>}
            {project.consultantName && <><dt>咨询师</dt><dd>{project.consultantName}</dd></>}
            {project.reviewerName && <><dt>评审员</dt><dd>{project.reviewerName}</dd></>}
            {project.expectedCertDate && <><dt>预计出证</dt><dd>{project.expectedCertDate}</dd></>}
            {project.actualCertDate && <><dt>实际出证</dt><dd>{project.actualCertDate}</dd></>}
            {project.firstPayDate && <><dt>首付款日</dt><dd>{project.firstPayDate}</dd></>}
            {project.finalPayDate && <><dt>尾款日</dt><dd>{project.finalPayDate}</dd></>}
            <dt>创建时间</dt><dd>{project.createdAt.substring(0, 19).replace("T", " ")}</dd>
          </dl>
        </section>
      )}

      {/* 财务 */}
      {tab === "financial" && (
        <section className="financial-section">
          <div className="section-heading">
            <h3>财务记录</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="ghost-button" onClick={() => setShowPaymentModal(true)}>
                <Plus size={14} /> 新增收款
              </button>
              <button className="ghost-button" onClick={() => setShowInvoiceModal(true)}>
                <Plus size={14} /> 新增发票
              </button>
              <button className="ghost-button" onClick={() => setShowReviewModal(true)}>
                <Plus size={14} /> 新增评审
              </button>
            </div>
          </div>

          {/* 收款记录 */}
          <h4>📥 收款记录（{payments.length}）</h4>
          {payments.length === 0 ? <p className="muted">暂无收款记录。点击"新增收款"开始添加。</p> : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>类型</th><th>应收</th><th>实收</th><th>到账日</th><th>状态</th><th>备注</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td><span className={`status-pill status-${p.paymentType === "deposit" ? "first_pay_pending" : "final_pay_pending"}`}>
                      {p.paymentType === "deposit" ? "首付款" : p.paymentType === "balance" ? "尾款" : "其他"}
                    </span></td>
                    <td>¥{Number(p.receivableAmount || p.amount || 0).toLocaleString()}</td>
                    <td><strong>¥{Number(p.receivedAmount || p.received_amount || 0).toLocaleString()}</strong></td>
                    <td>{p.received_at || p.receivedAt || p.received_date || "—"}</td>
                    <td>
                      <span className={`status-pill ${p.status === "paid" ? "status-completed" : p.status === "overdue" ? "status-suspended" : "status-awaiting_balance"}`}>
                        {p.status === "paid" ? "已收" : p.status === "pending" ? "待收" : p.status === "overdue" ? "逾期" : p.status}
                      </span>
                    </td>
                    <td>{p.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 发票记录 */}
          <h4 style={{ marginTop: 20 }}>🧾 发票记录（{invoices.length}）</h4>
          {invoices.length === 0 ? <p className="muted">暂无发票记录。点击"新增发票"开始添加。</p> : (
            <table className="data-table">
              <thead>
                <tr><th>发票号</th><th>金额</th><th>税率</th><th>税额</th><th>开票日</th><th>状态</th></tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><strong>{inv.invoice_no || "—"}</strong></td>
                    <td>¥{Number(inv.amount || 0).toLocaleString()}</td>
                    <td>{inv.tax_rate || inv.taxRate}%</td>
                    <td>¥{Number(inv.tax_amount || inv.taxAmount || 0).toLocaleString()}</td>
                    <td>{inv.issue_date || inv.issueDate || "—"}</td>
                    <td>
                      <span className={`status-pill ${inv.status === "issued" ? "status-completed" : "status-awaiting_balance"}`}>
                        {inv.status === "issued" ? "已开" : inv.status === "pending" ? "待开" : inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 评审记录 */}
          <h4 style={{ marginTop: 20 }}>👥 评审记录（{reviews.length}）</h4>
          {reviews.length === 0 ? <p className="muted">暂无评审记录。点击"新增评审"开始添加。</p> : (
            <table className="data-table">
              <thead>
                <tr><th>类型</th><th>日期</th><th>评审员</th><th>方式</th><th>状态</th><th>结论</th></tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id}>
                    <td>{r.review_type === "contract" ? "合同评审" : "专家评审"}</td>
                    <td>{r.scheduled_date || r.scheduledDate || "—"}</td>
                    <td>{r.reviewer_name || r.reviewerName || r.external_reviewer || r.externalReviewer || "—"}</td>
                    <td>{r.review_method === "onsite" ? "现场" : r.review_method === "remote" ? "远程" : "—"}</td>
                    <td>
                      <span className={`status-pill ${r.status === "completed" ? "status-completed" : r.status === "in_progress" ? "status-contract_review" : "status-awaiting_balance"}`}>
                        {r.status === "completed" ? "已完成" : r.status === "in_progress" ? "进行中" : r.status === "scheduled" ? "已排期" : r.status}
                      </span>
                    </td>
                    <td>{r.conclusion || r.conclusionNote || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 资料 */}
      {tab === "documents" && (
        <section className="documents-section">
          <div className="section-heading">
            <h3>项目资料</h3>
            <button className="primary-button" onClick={() => setShowDocumentModal(true)}>
              <Plus size={14} /> 上传资料
            </button>
          </div>
          {documents.length === 0 ? <p className="muted">暂无项目资料。点击"上传资料"开始添加。</p> : (
            <table className="data-table">
              <thead>
                <tr><th>文件名</th><th>类型</th><th>版本</th><th>上传人</th><th>上传时间</th><th>状态</th></tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.title || d.name || "—"}</strong></td>
                    <td>{d.document_type || d.documentType || "—"}</td>
                    <td>v{d.version || d.versionNo || 1}</td>
                    <td>{d.uploaded_by_name || d.uploadedByName || "—"}</td>
                    <td>{(d.uploaded_at || d.uploadedAt || d.created_at || d.createdAt || "").substring(0, 19).replace("T", " ")}</td>
                    <td>
                      <span className={`status-pill ${d.status === "active" ? "status-completed" : d.status === "verified" ? "status-completed" : "status-obsolete"}`}>
                        {d.status === "active" ? "使用中" : d.status === "verified" ? "已验证" : d.status === "obsolete" ? "已废弃" : d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 整改闭环 */}
      {tab === "corrections" && (
        <section className="corrections-section">
          <div className="section-heading">
            <h3>整改闭环</h3>
            <button className="primary-button" onClick={() => setShowCorrectionModal(true)}>
              <Plus size={14} /> 新增整改项
            </button>
          </div>
          {corrections.length === 0 ? <p className="muted">暂无整改项。点击"新增整改项"开始添加。</p> : (
            <div className="correction-list">
              {corrections.map((c) => (
                <div key={c.id} className="correction-card">
                  <div className="correction-header">
                    <div>
                      <strong>{c.item_no || c.itemNo || "CA-?"}</strong>
                      <span style={{ marginLeft: 8 }}>{c.title}</span>
                    </div>
                    <span className={`status-pill status-${c.status === "open" ? "status-awaiting_balance" : c.status === "submitted" ? "status-contract_review" : c.status === "verified" ? "status-completed" : c.status === "rejected" ? "status-suspended" : "status-correcting"}`}>
                      {c.status === "open" ? "待整改" : c.status === "submitted" ? "已提交" : c.status === "verified" ? "已验证" : c.status === "rejected" ? "已驳回" : c.status === "closed" ? "已关闭" : c.status}
                    </span>
                  </div>
                  {c.description && <p className="muted">{c.description}</p>}
                  <div className="correction-meta">
                    <span>责任人：{c.responsible_name || c.responsibleName || "未指派"}</span>
                    {c.due_date || c.dueDate ? <span>截止：{c.due_date || c.dueDate}</span> : null}
                    {c.verified_at || c.verifiedAt ? <span>验证：{(c.verified_at || c.verifiedAt).substring(0, 10)}</span> : null}
                  </div>
                  <div className="correction-actions">
                    {c.status === "open" && (
                      <button className="ghost-button small" onClick={() => updateCorrectionStatus(c.id, "submitted")}>
                        标记为已提交
                      </button>
                    )}
                    {c.status === "submitted" && (
                      <>
                        <button className="primary-button small" onClick={() => updateCorrectionStatus(c.id, "verified")}>
                          ✓ 验证通过
                        </button>
                        <button className="ghost-button small" onClick={() => updateCorrectionStatus(c.id, "rejected")}>
                          ✗ 驳回
                        </button>
                      </>
                    )}
                    {c.status === "verified" && (
                      <button className="ghost-button small" onClick={() => updateCorrectionStatus(c.id, "closed")}>
                        关闭
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 状态变更弹窗 */}
      {changingStatus && (
        <div className="modal-overlay" onClick={() => setChangingStatus(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><MessageSquare size={18} /> 变更项目状态</h3>
            <p>当前状态：<strong>{PROJECT_STATUS_LABEL[project.status]}</strong></p>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as ProjectStatus)}>
              <option value="">选择新阶段（按业务漏斗顺序）...</option>
              {(() => {
                const stages = getAllowedBusinessStages(project.status);
                return stages.map((bs) => (
                  <option key={bs.stage} value={bs.states[0]}>{bs.stage}</option>
                ));
              })()}
            </select>
            <textarea placeholder="变更原因（必填）" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setChangingStatus(false)}>取消</button>
              <button className="primary-button" disabled={!newStatus || !reason.trim()} onClick={handleStatusChange}>
                确认变更
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 收款弹窗 */}
      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Plus size={18} /> 新增收款记录</h3>
            <div className="form-row-2">
              <div>
                <label>类型 *</label>
                <select value={paymentForm.paymentType} onChange={(e) => setPaymentForm({ ...paymentForm, paymentType: e.target.value })}>
                  <option value="deposit">首付款</option>
                  <option value="balance">尾款</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div>
                <label>应收金额 *</label>
                <input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
              </div>
            </div>
            <div className="form-row-2">
              <div>
                <label>已收金额</label>
                <input type="number" value={paymentForm.receivedAmount} onChange={(e) => setPaymentForm({ ...paymentForm, receivedAmount: e.target.value })} />
              </div>
              <div>
                <label>应收日期</label>
                <input type="date" value={paymentForm.dueDate} onChange={(e) => setPaymentForm({ ...paymentForm, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea rows={2} value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowPaymentModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={savePayment}><Save size={14} /> 保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 发票弹窗 */}
      {showInvoiceModal && (
        <div className="modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Plus size={18} /> 新增发票</h3>
            <div className="form-row-2">
              <div>
                <label>发票号</label>
                <input value={invoiceForm.invoiceNo} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceNo: e.target.value })} placeholder="可选" />
              </div>
              <div>
                <label>金额 *</label>
                <input type="number" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} />
              </div>
            </div>
            <div className="form-row-2">
              <div>
                <label>税率</label>
                <select value={invoiceForm.taxRate} onChange={(e) => setInvoiceForm({ ...invoiceForm, taxRate: Number(e.target.value) })}>
                  <option value="3">3%</option>
                  <option value="6">6%</option>
                  <option value="9">9%</option>
                  <option value="13">13%</option>
                </select>
              </div>
              <div>
                <label>开票日</label>
                <input type="date" value={invoiceForm.issueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, issueDate: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea rows={2} value={invoiceForm.notes} onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowInvoiceModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={saveInvoice}><Save size={14} /> 保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 资料弹窗 */}
      {showDocumentModal && (
        <div className="modal-overlay" onClick={() => setShowDocumentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><FileUp size={18} /> 上传项目资料</h3>
            <div className="form-row">
              <label>文件名称 *</label>
              <input value={documentForm.name} onChange={(e) => setDocumentForm({ ...documentForm, name: e.target.value })} placeholder="例：营业执照副本" />
            </div>
            <div className="form-row">
              <label>资料类型</label>
              <select value={documentForm.documentType} onChange={(e) => setDocumentForm({ ...documentForm, documentType: e.target.value })}>
                <option value="quotation">报价单</option>
                <option value="contract">合同</option>
                <option value="customer_material">客户资料</option>
                <option value="review_report">评审报告</option>
                <option value="certificate">证书</option>
                <option value="invoice">发票</option>
                <option value="payment_voucher">到账凭证</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea rows={2} value={documentForm.notes} onChange={(e) => setDocumentForm({ ...documentForm, notes: e.target.value })} />
            </div>
            <p className="muted small">📝 当前版本：仅记录元数据（文件名/类型），实际文件上传可后续对接存储服务</p>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowDocumentModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={saveDocument}><Save size={14} /> 保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 整改弹窗 */}
      {showCorrectionModal && (
        <div className="modal-overlay" onClick={() => setShowCorrectionModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><AlertCircle size={18} /> 新增整改项</h3>
            <div className="form-row">
              <label>问题标题 *</label>
              <input value={correctionForm.title} onChange={(e) => setCorrectionForm({ ...correctionForm, title: e.target.value })} placeholder="例：质量手册未更新" />
            </div>
            <div className="form-row">
              <label>问题描述</label>
              <textarea rows={2} value={correctionForm.description} onChange={(e) => setCorrectionForm({ ...correctionForm, description: e.target.value })} />
            </div>
            <div className="form-row-2">
              <div>
                <label>责任人</label>
                <input value={correctionForm.responsibleName} onChange={(e) => setCorrectionForm({ ...correctionForm, responsibleName: e.target.value })} />
              </div>
              <div>
                <label>截止日期</label>
                <input type="date" value={correctionForm.dueDate} onChange={(e) => setCorrectionForm({ ...correctionForm, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea rows={2} value={correctionForm.notes} onChange={(e) => setCorrectionForm({ ...correctionForm, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowCorrectionModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={saveCorrection}><Save size={14} /> 保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 评审弹窗 */}
      {showReviewModal && (
        <div className="modal-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><CheckCircle2 size={18} /> 新增评审安排</h3>
            <div className="form-row-2">
              <div>
                <label>类型 *</label>
                <select value={reviewForm.reviewType} onChange={(e) => setReviewForm({ ...reviewForm, reviewType: e.target.value })}>
                  <option value="contract">合同评审</option>
                  <option value="expert">专家评审</option>
                </select>
              </div>
              <div>
                <label>日期 *</label>
                <input type="date" value={reviewForm.scheduledDate} onChange={(e) => setReviewForm({ ...reviewForm, scheduledDate: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label>评审员/老师</label>
              <input value={reviewForm.reviewerName} onChange={(e) => setReviewForm({ ...reviewForm, reviewerName: e.target.value })} />
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea rows={2} value={reviewForm.notes} onChange={(e) => setReviewForm({ ...reviewForm, notes: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowReviewModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={saveReview}><Save size={14} /> 保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
