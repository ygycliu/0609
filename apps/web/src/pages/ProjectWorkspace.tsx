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
  // V2.0：项目列表分页（默认 10，可选 50/全部）
  const [pageSize, setPageSize] = useState<10 | 50 | 0>(10);  // 0 = 全部
  const [totalProjects, setTotalProjects] = useState(0);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [stageFilter, setStageFilter] = useState<string[] | null>(null);

  // 根据 stageFilter 过滤项目（V2.1：支持虚拟状态 in_progress / completed / anomaly）
  // 实际 DB 状态值：lead, communicating, quoted, contract_signed, contract_pending,
  //                 project_archived, cert_pending, completed, cancelled 等
  const IN_PROGRESS_STATUSES = [
    "lead", "communicating", "quoted", "contract_pending",
    "contract_signed", "delivery_ready",
    "collecting_documents", "contract_review", "expert_pending",
    "reviewing", "rectifying", "awaiting_balance", "invoicing",
    "cert_pending"
  ];
  // 已出证 = completed（已发证）
  const COMPLETED_STATUSES = ["completed"];
  // 异常 = 已取消 + 暂停/风险（如有）
  const ANOMALY_STATUSES = ["cancelled", "suspended", "paused", "at_risk", "risk"];

  const filteredProjects = !stageFilter
    ? projects
    : projects.filter((p) => {
        const status = (p as any).status;
        if (stageFilter.includes("in_progress")) return IN_PROGRESS_STATUSES.includes(status);
        if (stageFilter.includes("completed")) return COMPLETED_STATUSES.includes(status);
        if (stageFilter.includes("anomaly")) return ANOMALY_STATUSES.includes(status);
        return stageFilter.includes(status);
      });

  interface Reminder {
    id: string;
    priority: "high" | "medium" | "low";
    icon: React.ReactNode;
    title: string;
    description: string;
    actionLabel: string;
    action: () => void;
  }

  const load = async () => {
    setLoading(true);
    try {
      // V2.0：根据 pageSize 加载项目（10/50/全部）
      const listOptions: any = {};
      if (pageSize > 0) {
        listOptions.limit = pageSize;
      }
      // V2.1：穿透查询时，传 status 数组（or 用 in_xxx 虚拟 status）
      // 后端 status 只支持单值，但前端有"in_progress/completed/anomaly"虚拟分组
      // 解决方案：拉所有数据（limit=0），前端 client-side 过滤（已有 stageFilter 机制）
      if (stageFilter && stageFilter.length === 1 && !["in_progress", "completed", "anomaly"].includes(stageFilter[0])) {
        listOptions.status = stageFilter[0];
      }
      // V2.1：穿透时强制分页拉全部（否则只拉前 200 条无法穿透筛选）
      const useAllProjects = stageFilter !== null;
      const fetchAll = async () => {
        const all: any[] = [];
        let offset = 0;
        while (true) {
          const r: any = await api.listCertificationProjects({ limit: 200, offset });
          // request() 已经解包 { data, total }，所以 r.data 就是数组
          // 后端真实响应：{ data: Project[], total: N } → request 返回 { total: N }
          // 但后端 implementation 里 listProjects 返回 { data: [], total: N }
          // request 解包后，r 应该 = data 字段的内容（= { total: N }）
          // 数组需要从原始 response 拿
          const rawResp = await fetch(`/ai/api/projects?limit=200&offset=${offset}`, { credentials: "include" });
          const rawBody = await rawResp.json();
          const items = Array.isArray(rawBody.data) ? rawBody.data : [];
          all.push(...items);
          if (items.length < 200 || all.length >= (rawBody.total ?? all.length)) break;
          offset += 200;
          if (offset > 10000) break;
        }
        return all;
      };
      const [a, b, c, s, p] = await Promise.all([
        api.listOverdueCertificationProjects(),
        api.listPendingPaymentCertificationProjects(),
        api.listPendingCertCertificationProjects(),
        api.getCertificationProjectStats(),
        useAllProjects
          ? fetchAll()
          : api.listCertificationProjects(listOptions).then((r: any) => (r as any).data || r),
      ]);
      // 统一处理 p：fetchAll 返回数组，普通 API 返回 {data, total}
      const projectList = useAllProjects
        ? (Array.isArray(p) ? p : [])
        : ((p as any).data?.items || (p as any).data || (Array.isArray(p) ? p : []));
      setOverdue((a as any).data || a || []);
      setPendingPay((b as any).data || b || []);
      setPendingCert((c as any).data || c || []);
      setStats((s as any).data || s || {});
      setProjects(projectList);
      setTotalProjects((p as any).total ?? projectList.length);
      loadReminders(projectList);
    } catch (e) {
      console.error("load workspace failed", e);
    } finally {
      setLoading(false);
    }
  };

  // 计算自动提醒（基于项目状态 + 业务规则）
  const loadReminders = async (projectList: Project[]) => {
    const r: Reminder[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const p of projectList) {
      // 1. 线索超过 14 天未推进
      if (p.status === "lead" && p.createdAt) {
        const ageDays = Math.floor((today.getTime() - new Date(p.createdAt).getTime()) / 86400000);
        if (ageDays >= 14) {
          r.push({
            id: `lead-stale-${p.id}`,
            priority: "medium",
            icon: "⏰",
            title: `${p.projectCode} 线索停留 ${ageDays} 天`,
            description: `${p.customerName} 未推进沟通`,
            actionLabel: "去推进",
            action: () => onOpenProject?.(p.id)
          });
        }
      }
      // 2. 已报价超过 30 天未签约
      if (p.status === "quoted" && p.createdAt) {
        const ageDays = Math.floor((today.getTime() - new Date(p.createdAt).getTime()) / 86400000);
        if (ageDays >= 30) {
          r.push({
            id: `quote-stale-${p.id}`,
            priority: "high",
            icon: "⚠️",
            title: `${p.projectCode} 报价停留 ${ageDays} 天`,
            description: `${p.customerName} 需确认签约意向`,
            actionLabel: "去跟进",
            action: () => onOpenProject?.(p.id)
          });
        }
      }
      // 3. 合同已签未收首付款
      if (p.status === "contract_signed" || p.status === "contract_archived") {
        r.push({
          id: `await-deposit-${p.id}`,
          priority: "high",
          icon: "💰",
          title: `${p.projectCode} 待收首付款`,
          description: `${p.customerName} 合同金额 ¥${Number(p.contractAmount || 0).toLocaleString()}`,
          actionLabel: "去收首付款",
          action: () => onOpenProject?.(p.id)
        });
      }
      // 4. 整改中超过 30 天
      if (p.status === "correcting" && p.createdAt) {
        const ageDays = Math.floor((today.getTime() - new Date(p.createdAt).getTime()) / 86400000);
        if (ageDays >= 30) {
          r.push({
            id: `correcting-stale-${p.id}`,
            priority: "medium",
            icon: "🔧",
            title: `${p.projectCode} 整改 ${ageDays} 天`,
            description: `${p.customerName} 整改周期过长`,
            actionLabel: "去跟进",
            action: () => onOpenProject?.(p.id)
          });
        }
      }
      // 5. 即将到期出证（剩 7 天）
      if (p.expectedCertDate) {
        const days = Math.floor((new Date(p.expectedCertDate).getTime() - today.getTime()) / 86400000);
        if (days >= 0 && days <= 7 && p.status !== "certified" && p.status !== "completed") {
          r.push({
            id: `cert-soon-${p.id}`,
            priority: "high",
            icon: "📜",
            title: `${p.projectCode} 即将出证（${days}天）`,
            description: `${p.customerName} 预计出证日 ${p.expectedCertDate}`,
            actionLabel: "去跟进",
            action: () => onOpenProject?.(p.id)
          });
        }
      }
    }
    setReminders(r);
  };

  useEffect(() => { load(); }, [pageSize]);
  // V2.1：穿透查询触发重新加载
  useEffect(() => { load(); }, [stageFilter]);

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
          <p>所有工作都围绕"认证项目"完成。从线索 → 沟通 → 报价 → 合同签订 → 合同评审 → 现场审核 → 整改中 → 出证 → 邮寄证书 → 项目完成。</p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={load}><RefreshCw size={16} /> 刷新</button>
          <button className="primary-button" onClick={() => onNavigate("project-new")}>
            + 新建项目
          </button>
        </div>
      </header>

      {/* 三大数字卡（V2.1：可点击穿透查询） */}
      <section className="metric-grid">
        <div
          className={`metric ${stageFilter === null ? "active" : ""}`}
          onClick={() => setStageFilter(null)}
          title="点击查看全部项目"
        >
          <span>项目总数</span>
          <strong>{sum.total}</strong>
          <small>全部状态</small>
        </div>
        <div
          className={`metric ${stageFilter && stageFilter.includes("in_progress") ? "active" : ""}`}
          onClick={() => setStageFilter(["in_progress"])}
          title="点击筛选进行中项目"
        >
          <span>进行中</span>
          <strong style={{ color: "#2563eb" }}>{sum.inProgress}</strong>
          <small>含已签订未完成</small>
        </div>
        <div
          className={`metric ${stageFilter && stageFilter.includes("completed") ? "active" : ""}`}
          onClick={() => setStageFilter(["completed"])}
          title="点击筛选已出证项目"
        >
          <span>已出证</span>
          <strong style={{ color: "#059669" }}>{sum.completed}</strong>
          <small>已完成 + 已出证</small>
        </div>
        <div
          className={`metric ${stageFilter && stageFilter.includes("anomaly") ? "active" : ""}`}
          onClick={() => setStageFilter(["anomaly"])}
          title="点击筛选异常项目"
        >
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
          {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const isActive = stageFilter && stageFilter.length === 1 && stageFilter[0] === k;
            return (
              <div
                key={k}
                className={`status-bar clickable ${isActive ? "active" : ""}`}
                onClick={() => setStageFilter(isActive ? null : [k])}
                title={`点击筛选状态：${PROJECT_STATUS_LABEL[k as ProjectStatus] || k}`}
              >
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
            );
          })}
          {Object.keys(stats).length === 0 && (
            <p className="muted">暂无项目数据</p>
          )}
        </div>
      </section>

      {/* 项目列表 */}
      <section className="project-list-section">
        <div className="section-heading">
          <h3>最近项目</h3>
          <div className="project-list-meta">
            <span className="muted">
              {stageFilter
                ? `已筛选 ${filteredProjects.length} / ${projects.length} 个（按漏斗阶段）`
                : `共 ${projects.length}${pageSize > 0 ? ` / ${totalProjects}` : ""} 个`}
            </span>
            {/* V2.1：清除筛选按钮 */}
            {stageFilter && (
              <button
                className="tiny ghost-button"
                onClick={() => setStageFilter(null)}
                style={{ marginLeft: "12px" }}
              >
                ✕ 清除筛选
              </button>
            )}
            {/* V2.0：分页切换按钮 */}
            <div className="page-size-selector">
              <span className="page-size-label">显示：</span>
              {[
                { value: 10 as const, label: "10 条" },
                { value: 50 as const, label: "50 条" },
                { value: 0 as const, label: "全部" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={pageSize === opt.value ? "page-size-btn active" : "page-size-btn"}
                  onClick={() => setPageSize(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {stageFilter && (
              <button className="ghost-button small" onClick={() => setStageFilter(null)}>
                清除筛选
              </button>
            )}
          </div>
        </div>
        {stageFilter && (
          <div className="stage-filter-banner">
            🔍 当前筛选：<strong>漏斗阶段</strong>
            <span className="muted">（点击漏斗可切换 / 点击右上角"清除筛选"恢复全部）</span>
          </div>
        )}
        {filteredProjects.length === 0 ? (
          <p className="muted">
            {stageFilter ? "此阶段暂无项目" : '暂无项目，点击右上角"新建项目"开始第一个'}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>编号</th><th>客户</th><th>服务类型</th><th>签约主体</th>
                <th>合同</th><th>已收</th><th>状态</th><th>创建时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => (
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

      {/* 漏斗：转化率 */}
      <section className="funnel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">项目漏斗</span>
            <h2>从线索到出证的转化率</h2>
          </div>
        </div>
        <div className="funnel">
          {[
            { label: "线索", status: ["lead"], color: "#f59e0b" },
            { label: "沟通", status: ["communicating"], color: "#3b82f6" },
            { label: "报价", status: ["quoted"], color: "#6366f1" },
            { label: "合同签订", status: ["contract_pending", "contract_signed", "contract_archived", "first_pay_pending", "first_paid"], color: "#10b981" },
            { label: "合同评审", status: ["contract_review"], color: "#06b6d4" },
            { label: "现场审核", status: ["expert_review_pending", "expert_reviewing", "delivery_prep", "doc_collecting"], color: "#8b5cf6" },
            { label: "整改中", status: ["correcting"], color: "#ec4899" },
            { label: "出证", status: ["final_pay_pending", "invoice_pending", "cert_pending", "certified"], color: "#f97316" },
            { label: "邮寄证书", status: ["shipment_pending"], color: "#22c55e" },
            { label: "项目完成", status: ["completed"], color: "#16a34a" },
          ].map((stage, i) => {
            const stageList = Array.isArray(stage.status) ? stage.status : [stage.status];
            const stageCount = stageList.reduce((sum, s) => sum + (stats[s] || 0), 0);
            const total = sum.total || 1;
            const pct = (stageCount / total) * 100;
            const isActive = stageFilter && stage.status.some(s => stageFilter.includes(s));
            return (
              <div
                key={stage.label}
                className={`funnel-stage ${isActive ? "filter-active" : ""}`}
                onClick={() => {
                  // 第一次点击设过滤；再次点击取消
                  if (stageFilter && stage.status.some(s => stageFilter.includes(s))) {
                    setStageFilter(null);
                  } else {
                    setStageFilter(stage.status);
                    // 滚动到项目列表
                    setTimeout(() => {
                      const el = document.querySelector('.project-list-section');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                  }
                }}
                style={{ cursor: 'pointer' }}
                title={`点击筛选 ${stage.label} 阶段的项目`}
              >
                <div className="funnel-stage-label" style={{ color: stage.color }}>
                  <strong>{stage.label}</strong>
                  <span className="funnel-stage-count">{stageCount}</span>
                </div>
                <div className="funnel-bar">
                  <div className="funnel-fill" style={{ width: `${Math.max(pct, 5)}%`, background: stage.color }}>
                    {stageCount > 0 && (
                      <span className="funnel-fill-count">{stageCount}</span>
                    )}
                  </div>
                </div>
                {i > 0 && (
                  <span className="funnel-conversion">
                    {stageCount === 0 ? "—" : `${pct.toFixed(0)}%`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 自动提醒：今日待办 */}
      {reminders.length > 0 && (
        <section className="reminders-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">自动提醒</span>
              <h2>今日待办 ({reminders.length})</h2>
            </div>
            <button className="ghost-button" onClick={() => loadReminders(projects)}>
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
          <div className="reminders-list">
            {reminders.map((r) => (
              <div key={r.id} className={`reminder-item reminder-${r.priority}`}>
                <div className="reminder-icon">{r.icon}</div>
                <div className="reminder-body">
                  <div className="reminder-title">{r.title}</div>
                  <div className="reminder-desc">{r.description}</div>
                </div>
                <button className="ghost-button small" onClick={() => r.action()}>
                  {r.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
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