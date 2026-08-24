import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronRight,
  Download,
  LoaderCircle,
  Plus,
  Search,
  Users,
  X
} from "lucide-react";
import { api } from "../lib/api";

const PAGE_SIZE = 50;

interface CustomerRow {
  id: string;
  customerCode: string;
  name: string;
  industry: string | null;
  employeeCount: number | null;
  region: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  status: string;
  serviceStage: string | null;
  tags: string[];
  totalRevenue: number | null;
  updatedAt: string | null;
  createdAt: string;
}

interface CustomerListPageProps {
  onOpen: (id: string) => void;
  onCreate: () => void;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "活跃" },
  { value: "inactive", label: "暂停" },
  { value: "archived", label: "归档" }
];

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "潜在", label: "潜在" },
  { value: "接触", label: "接触" },
  { value: "报价", label: "报价" },
  { value: "签约", label: "签约" },
  { value: "服务中", label: "服务中" },
  { value: "续约", label: "续约" },
  { value: "流失", label: "流失" }
];

export function CustomerListPage({ onOpen, onCreate }: CustomerListPageProps) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.exportCustomers({
        q: q.trim() || undefined,
        status: status || undefined,
        service_stage: stage || undefined
      });
      if (!response.ok) throw new Error(`导出失败: ${response.status}`);

      // 从响应头拿文件名
      const disposition = response.headers.get("content-disposition") || "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const filename = m ? decodeURIComponent(m[1]) : `客户列表_${new Date().toISOString().slice(0, 10)}.csv`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .listCustomers({
        q,
        status,
        service_stage: stage,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
      .then((res) => {
        setItems(res.data);
        setTotal(res.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [q, status, stage, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stats = useMemo(() => {
    const active = items.filter((c) => c.status === "active").length;
    const inactive = items.filter((c) => c.status === "inactive").length;
    const archived = items.filter((c) => c.status === "archived").length;
    const stageMap = new Map<string, number>();
    for (const c of items) {
      if (c.serviceStage) {
        stageMap.set(c.serviceStage, (stageMap.get(c.serviceStage) ?? 0) + 1);
      }
    }
    return { active, inactive, archived, stageMap };
  }, [items]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">认证业务中心 · CRM</span>
          <h1>客户管理</h1>
          <p>管理你服务过的所有客户档案，作为业务基础数据被报价、咨询、审核等模块引用。</p>
        </div>
        <div className="page-header-actions">
          <button className="ghost-button" onClick={handleExport} disabled={exporting}>
            {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
            导出 CSV
          </button>
          <button className="primary-button" onClick={onCreate}>
            <Plus size={18} /> 新建客户
          </button>
        </div>
      </header>

      <section className="customer-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="搜索客户名称 / 编号 / 信用代码"
            value={q}
            onChange={(event) => {
              setPage(0);
              setQ(event.target.value);
            }}
          />
          {q && (
            <button
              className="clear-btn"
              onClick={() => {
                setQ("");
                setPage(0);
              }}
              aria-label="清空"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          value={status}
          onChange={(event) => {
            setPage(0);
            setStatus(event.target.value);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(event) => {
            setPage(0);
            setStage(event.target.value);
          }}
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="toolbar-meta">
          <Users size={14} /> 共 <strong>{total}</strong> 个客户
        </div>
      </section>

      <section className="customer-stats">
        <div
          className={`stat-card clickable ${status === "" ? "active" : ""}`}
          onClick={() => { setPage(0); setStatus(""); }}
          title="显示所有状态"
        >
          <span>全部</span>
          <strong>{total}</strong>
        </div>
        <div
          className={`stat-card clickable status-active ${status === "active" ? "active" : ""}`}
          onClick={() => { setPage(0); setStatus("active"); }}
          title="只显示活跃客户"
        >
          <span>活跃</span>
          <strong>{stats.active}</strong>
        </div>
        <div
          className={`stat-card clickable status-inactive ${status === "inactive" ? "active" : ""}`}
          onClick={() => { setPage(0); setStatus("inactive"); }}
          title="只显示暂停客户"
        >
          <span>暂停</span>
          <strong>{stats.inactive}</strong>
        </div>
        <div
          className={`stat-card clickable status-archived ${status === "archived" ? "active" : ""}`}
          onClick={() => { setPage(0); setStatus("archived"); }}
          title="只显示已归档客户"
        >
          <span>归档</span>
          <strong>{stats.archived}</strong>
        </div>
        {Array.from(stats.stageMap.entries())
          .slice(0, 4)
          .map(([s, n]) => (
            <div key={s} className="stat-card small">
              <span>{s}</span>
              <strong>{n}</strong>
            </div>
          ))}
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="customer-list">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={20} /> 正在加载客户列表...
          </div>
        ) : items.length === 0 ? (
          <div className="empty-row">没有匹配的客户</div>
        ) : (
          <table className="customer-table">
            <thead>
              <tr>
                <th>客户编号</th>
                <th>名称</th>
                <th>行业</th>
                <th>规模</th>
                <th>联系人</th>
                <th>服务阶段</th>
                <th>状态</th>
                <th>累计营收</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c.id)} className="clickable-row">
                  <td className="mono">{c.customerCode}</td>
                  <td>
                    <strong>{c.name}</strong>
                    {c.tags && c.tags.length > 0 && (
                      <div className="tag-row">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="tag-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{c.industry ?? "—"}</td>
                  <td>{c.employeeCount ? `${c.employeeCount} 人` : "—"}</td>
                  <td>
                    {c.contactPerson ?? "—"}
                    {c.contactPhone && (
                      <div className="muted">{c.contactPhone}</div>
                    )}
                  </td>
                  <td>{c.serviceStage ?? <span className="muted">未设置</span>}</td>
                  <td>
                    <span className={`status-pill status-${c.status}`}>
                      {c.status === "active" ? "活跃" : c.status === "inactive" ? "暂停" : "归档"}
                    </span>
                  </td>
                  <td>
                    {c.totalRevenue != null
                      ? `¥${c.totalRevenue.toLocaleString()}`
                      : "—"}
                  </td>
                  <td>
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {totalPages > 1 && (
        <div className="customer-pager">
          <button
            className="ghost-button"
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            上一页
          </button>
          <span>
            第 {page + 1} / {totalPages} 页（共 {total} 条）
          </span>
          <button
            className="ghost-button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}