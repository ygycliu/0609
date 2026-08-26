import { useEffect, useState } from "react";
import {
  ArrowLeft, Calendar, ChevronRight, FileText, Loader2,
  MessageSquare, RefreshCw, User, Wallet, CheckSquare
} from "lucide-react";
import { api } from "../lib/api";
import {
  PROJECT_STATUS_LABEL, type Project, type ProjectStatus,
  type ProjectTimelineEvent
} from "../types";

interface ProjectDetailPageProps {
  projectId: string;
  onBack: () => void;
}

const STATUS_TABS: ProjectStatus[] = [
  "lead", "communicating", "quoted", "contract_pending",
  "contract_signed", "first_pay_pending", "first_paid",
  "delivery_prep", "doc_collecting", "contract_review",
  "expert_review_pending", "expert_reviewing", "correcting",
  "final_pay_pending", "invoice_pending", "cert_pending",
  "certified", "shipment_pending", "completed"
];

export function ProjectDetailPage({ projectId, onBack }: ProjectDetailPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "info" | "financial" | "transitions">("timeline");
  const [changingStatus, setChangingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState<ProjectStatus | "">("");
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        api.getCertificationProject(projectId),
        api.getCertificationProjectTimeline(projectId),
      ]);
      setProject((p as any).data || p);
      setTimeline((t as any).data || t || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId]);

  async function handleStatusChange() {
    if (!project || !newStatus) return;
    try {
      await api.changeCertificationProjectStatus(project.id, newStatus, reason || undefined);
      setChangingStatus(false);
      setNewStatus("");
      setReason("");
      await load();
    } catch (e: any) {
      alert(e?.message || "状态变更失败");
    }
  }

  if (loading && !project) {
    return <div className="page-loading"><Loader2 className="spin" /> 加载中...</div>;
  }
  if (!project) {
    return <div className="page-error">项目不存在</div>;
  }

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
          <button className="ghost-button" onClick={load}>
            <RefreshCw size={16} /> 刷新
          </button>
          <button className="primary-button" onClick={() => setChangingStatus(true)}>
            变更状态
          </button>
        </div>
      </header>

      {/* 4 个指标 */}
      <section className="metric-grid">
        <div className="metric">
          <span>合同金额</span>
          <strong>{project.contractAmount ? `¥${project.contractAmount.toLocaleString()}` : "未填"}</strong>
          <small>签约金额</small>
        </div>
        <div className="metric">
          <span>已收款</span>
          <strong>¥{project.paidAmount.toLocaleString()}</strong>
          <small>累计到账</small>
        </div>
        <div className="metric">
          <span>已开票</span>
          <strong>¥{project.invoiceAmount.toLocaleString()}</strong>
          <small>累计开票</small>
        </div>
        <div className="metric">
          <span>预计出证</span>
          <strong>{project.expectedCertDate || "未设定"}</strong>
          <small>目标日期</small>
        </div>
      </section>

      {/* 标签页 */}
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
        <button className={`tab ${tab === "transitions" ? "active" : ""}`} onClick={() => setTab("transitions")}>
          <CheckSquare size={14} /> 状态流转
        </button>
      </div>

      {/* 内容 */}
      {tab === "timeline" && (
        <section className="timeline-section">
          <h3>项目时间线</h3>
          <div className="timeline">
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
          </div>
        </section>
      )}

      {tab === "info" && (
        <section className="info-section">
          <h3>项目信息</h3>
          <dl className="info-grid">
            <dt>项目编号</dt><dd>{project.projectCode}</dd>
            <dt>客户名称</dt><dd>{project.customerName}</dd>
            <dt>联系人</dt><dd>{project.contactPerson || "未填"}</dd>
            <dt>联系电话</dt><dd>{project.contactPhone || "未填"}</dd>
            <dt>服务类型</dt><dd>{project.serviceTypeName}</dd>
            <dt>签约主体</dt><dd>{project.signatoryName}</dd>
            {project.partnerOrgName && (
              <>
                <dt>外协单位</dt><dd>{project.partnerOrgName}</dd>
              </>
            )}
            {project.industry && (
              <>
                <dt>行业</dt><dd>{project.industry}</dd>
              </>
            )}
            {project.riskLevel && (
              <>
                <dt>风险等级</dt><dd>{project.riskLevel}</dd>
              </>
            )}
            {project.salesSource && (
              <>
                <dt>销售来源</dt><dd>{project.salesSource}</dd>
              </>
            )}
            {project.certificationScope && (
              <>
                <dt>申请认证范围</dt><dd>{project.certificationScope}</dd>
              </>
            )}
            {project.certificationStandards && (
              <>
                <dt>认证标准</dt><dd>{project.certificationStandards}</dd>
              </>
            )}
            {project.notes && (
              <>
                <dt>备注</dt><dd>{project.notes}</dd>
              </>
            )}
            <dt>创建时间</dt><dd>{project.createdAt.substring(0, 19).replace("T", " ")}</dd>
          </dl>
        </section>
      )}

      {tab === "financial" && (
        <section className="financial-section">
          <h3>财务记录</h3>
          <div className="finance-summary">
            <div className="finance-card">
              <span>合同金额</span>
              <strong>{project.contractAmount ? `¥${project.contractAmount.toLocaleString()}` : "未填"}</strong>
            </div>
            <div className="finance-card">
              <span>已收款</span>
              <strong>¥{project.paidAmount.toLocaleString()}</strong>
            </div>
            <div className="finance-card">
              <span>已开票</span>
              <strong>¥{project.invoiceAmount.toLocaleString()}</strong>
            </div>
          </div>
          <p className="muted">首付款/尾款/发票记录将在下一迭代添加。</p>
        </section>
      )}

      {tab === "transitions" && (
        <section className="transitions-section">
          <h3>状态流转说明</h3>
          <p className="muted">认证项目状态机（22 个状态，详见项目仓库）</p>
          <div className="status-flow">
            {[
              ["线索", "沟通中", "已报价", "待签合同"],
              ["合同已签", "合同已归档", "待首付款", "已收首付款"],
              ["交付准备", "资料收集中", "合同评审中", "待专家评审"],
              ["现场/远程评审中", "整改中", "待尾款", "待开票"],
              ["待出证", "已出证", "待邮寄", "已完成"],
            ].flat().map((s, i) => (
              <span key={i} className="status-flow-item">{s}</span>
            ))}
            <p className="muted">异常：暂停 / 风险/待处理 / 取消</p>
          </div>
        </section>
      )}

      {/* 状态变更弹窗 */}
      {changingStatus && (
        <div className="modal-overlay" onClick={() => setChangingStatus(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><MessageSquare size={18} /> 变更项目状态</h3>
            <p>当前状态：<strong>{PROJECT_STATUS_LABEL[project.status]}</strong></p>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as ProjectStatus)}
            >
              <option value="">选择新状态...</option>
              {STATUS_TABS.filter((s) => s !== project.status).map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
              <option value="suspended">暂停</option>
              <option value="at_risk">风险/待处理</option>
              <option value="cancelled">取消</option>
            </select>
            <textarea
              placeholder="变更原因（必填）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setChangingStatus(false)}>取消</button>
              <button
                className="primary-button"
                disabled={!newStatus || !reason.trim()}
                onClick={handleStatusChange}
              >
                确认变更
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}