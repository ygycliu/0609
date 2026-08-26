import { useEffect, useState } from "react";
import {
  AlertTriangle, Archive, Bell, CheckSquare, Clock, FileText,
  ListChecks, MapPin, RefreshCw, Wallet
} from "lucide-react";
import { api } from "../lib/api";
import { PROJECT_STATUS_LABEL, Project, type ProjectStatus } from "../types";

interface ProjectWorkspaceProps {
  onNavigate: (page: string) => void;
  onOpenProject: (id: string) => void;
}

export function ProjectWorkspace({ onNavigate, onOpenProject }: ProjectWorkspaceProps) {
  const [overdue, setOverdue] = useState<Project[]>([]);
  const [pendingPay, setPendingPay] = useState<Project[]>([]);
  const [pendingCert, setPendingCert] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [a, b, c, s, p] = await Promise.all([
        api.listOverdueCertificationProjects(),
        api.listPendingPaymentCertificationProjects(),
        api.listPendingCertCertificationProjects(),
        api.getCertificationProjectStats(),
        api.listCertificationProjects({ limit: 50 }),
      ]);
      setOverdue((a as any).data || a || []);
      setPendingPay((b as any).data || b || []);
      setPendingCert((c as any).data || c || []);
      setStats((s as any).data || s || {});
      const list = (p as any).data?.items || (p as any).data || (Array.isArray(p) ? p : []);
      setProjects(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("load workspace failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const summary = (s: Record<string, number>) => {
    const total = Object.values(s).reduce((sum, v) => sum + v, 0);
    const completed = (s.completed || 0) + (s.certified || 0);
    const inProgress = (s.lead || 0) + (s.communicating || 0) + (s.quoted || 0) +
      (s.contract_pending || 0) + (s.first_paid || 0) + (s.doc_collecting || 0) +
      (s.contract_review || 0) + (s.expert_reviewing || 0) + (s.correcting || 0);
    return { total, completed, inProgress };
  };
  const sum = summary(stats);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">工作台</span>
          <h1>认证项目中心</h1>
          <p>所有工作都围绕"认证项目"完成。从线索 → 报价 → 合同 → 交付 → 出证。</p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={load}><RefreshCw size={16} /> 刷新</button>
          <button className="primary-button" onClick={() => onNavigate("project-new")}>
            + 新建项目
          </button>
        </div>
      </header>

      {/* 三大数字卡 */}
      <section className="metric-grid">
        <div className="metric">
          <span>项目总数</span>
          <strong>{sum.total}</strong>
          <small>全部状态</small>
        </div>
        <div className="metric">
          <span>进行中</span>
          <strong style={{ color: "#2563eb" }}>{sum.inProgress}</strong>
          <small>含已签订未完成</small>
        </div>
        <div className="metric">
          <span>已出证</span>
          <strong style={{ color: "#059669" }}>{sum.completed}</strong>
          <small>已完成 + 已出证</small>
        </div>
        <div className="metric">
          <span>异常项目</span>
          <strong style={{ color: "#dc2626" }}>
            {(stats.suspended || 0) + (stats.at_risk || 0) + (stats.cancelled || 0)}
          </strong>
          <small>暂停/风险/取消</small>
        </div>
      </section>

      {/* 三看板 */}
      <section className="dashboard-band">
        <KanbanCard
          icon={<AlertTriangle size={18} />}
          title="逾期项目"
          color="#dc2626"
          items={overdue}
          onOpen={onOpenProject}
          emptyText="暂无逾期项目"
          loading={loading}
        />
        <KanbanCard
          icon={<Wallet size={18} />}
          title="待回款"
          color="#d97706"
          items={pendingPay}
          onOpen={onOpenProject}
          emptyText="暂无待回款项目"
          loading={loading}
        />
        <KanbanCard
          icon={<CheckSquare size={18} />}
          title="待出证"
          color="#059669"
          items={pendingCert}
          onOpen={onOpenProject}
          emptyText="暂无待出证项目"
          loading={loading}
        />
      </section>

      {/* 状态分布图 */}
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">项目状态分布</span>
            <h2>各状态项目数</h2>
          </div>
        </div>
        <div className="status-distribution">
          {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="status-bar">
              <span className="status-label">
                {PROJECT_STATUS_LABEL[k as ProjectStatus] || k}
              </span>
              <div className="status-bar-track">
                <div
                  className={`status-bar-fill bar-${k}`}
                  style={{ width: `${sum.total ? (v / sum.total) * 100 : 0}%` }}
                />
              </div>
              <strong>{v}</strong>
            </div>
          ))}
          {Object.keys(stats).length === 0 && (
            <p className="muted">暂无项目数据</p>
          )}
        </div>
      </section>

      {/* 项目列表 */}
      <section className="project-list-section">
        <div className="section-heading">
          <h3>最近项目</h3>
          <span className="muted">共 {projects.length} 个</span>
        </div>
        {projects.length === 0 ? (
          <p className="muted">暂无项目，点击右上角"新建项目"开始第一个</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>编号</th><th>客户</th><th>服务类型</th><th>签约主体</th>
                <th>合同</th><th>已收</th><th>状态</th><th>创建时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.projectCode}</strong></td>
                  <td>{p.customerName}</td>
                  <td>{p.serviceTypeName}</td>
                  <td>{p.signatoryName}</td>
                  <td>{p.contractAmount ? `¥${Number(p.contractAmount).toLocaleString()}` : "—"}</td>
                  <td>{p.paidAmount ? `¥${Number(p.paidAmount).toLocaleString()}` : "—"}</td>
                  <td>
                    <span className={`status-pill status-${p.status}`}>
                      {PROJECT_STATUS_LABEL[p.status] || p.status}
                    </span>
                  </td>
                  <td>{(p.createdAt || "").substring(0, 10)}</td>
                  <td>
                    <button className="ghost-button small" onClick={() => onOpenProject?.(p.id)}>
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

interface KanbanCardProps {
  icon: React.ReactNode;
  title: string;
  color: string;
  items: Project[];
  onOpen: (id: string) => void;
  emptyText: string;
  loading: boolean;
}

function KanbanCard({ icon, title, color, items, onOpen, emptyText, loading }: KanbanCardProps) {
  return (
    <div className="kanban-card">
      <div className="kanban-header" style={{ color }}>
        {icon}
        <h3>{title}</h3>
        <span className="count">{items.length}</span>
      </div>
      <div className="kanban-body">
        {loading && <p className="muted">加载中...</p>}
        {!loading && items.length === 0 && <p className="muted">{emptyText}</p>}
        {!loading && items.slice(0, 5).map((p) => (
          <button key={p.id} className="kanban-item" onClick={() => onOpen(p.id)}>
            <div className="kanban-item-title">
              <strong>{p.projectCode}</strong>
              <small>{p.customerName}</small>
            </div>
            <div className="kanban-item-meta">
              <span className={`status-pill status-${p.status}`}>
                {PROJECT_STATUS_LABEL[p.status]}
              </span>
              {p.nextFollowupDate && (
                <small className="due-date">
                  <Clock size={12} /> {p.nextFollowupDate}
                </small>
              )}
            </div>
          </button>
        ))}
        {!loading && items.length > 5 && (
          <p className="muted small">还有 {items.length - 5} 个项目...</p>
        )}
      </div>
    </div>
  );
}