import { useEffect, useState } from "react";
import {
  Archive,
  Bell,
  Calendar,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2
} from "lucide-react";
import { api } from "../lib/api";

const STAGE_FALLBACK = [
  { key: "expired",         label: "到期",          color: "orange" },
  { key: "quoted",          label: "已报价",        color: "blue" },
  { key: "contract_review", label: "合同评审",      color: "purple" },
  { key: "contract_signed", label: "合同签订",      color: "cyan" },
  { key: "implementing",    label: "项目实施",      color: "indigo" },
  { key: "certified",       label: "出证",          color: "teal" },
  { key: "completed",       label: "完成",          color: "green" },
];

const STATUS_COLORS: Record<string, string> = {
  orange: "status-pending",  // orange
  blue: "status-active",    // blue
  purple: "status-info",
  cyan: "status-info",
  indigo: "status-active",
  teal: "status-info",
  green: "status-completed",
  gray: "status-default"
};

const STAGE_LABELS: Record<string, string> = STAGE_FALLBACK.reduce((m, s) => {
  m[s.key] = s.label; return m;
}, {} as Record<string, string>);

interface FollowUpItem {
  id: string;
  customerId: string;
  customerName?: string;
  projectCode?: string;
  certificationType?: string;
  stage: string;
  year: number;
  expectedDate?: string;
  completedAt?: string;
  expectedAmount?: number;
  contractAmount?: number;
  notes?: string;
  isArchived?: boolean;
  archivedYear?: number;
}

interface FollowUpPageProps {
  onOpenCustomer: (id: string) => void;
}

export function FollowUpPage({ onOpenCustomer }: FollowUpPageProps) {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importingNotifications, setImportingNotifications] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    newCustomers: number;
  } | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [stage, setStage] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    api.listFollowUps({
      year,
      stage: stage || undefined,
      archived: showArchived,
      limit: 100
    })
      .then((r) => {
        setItems(r.data);
        setTotal(r.total);
        setTotalAll(r.totalAll);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [year, stage, showArchived]);

  const handleArchive = async () => {
    if (!confirm(`确认归档 ${year} 年所有未归档的跟进记录？此操作不可撤销。`)) return;
    try {
      const r = await api.archiveFollowUpYear(year);
      alert(`已归档 ${r.data.archived_count} 条记录`);
      setShowArchived(true);
    } catch (e) {
      alert("归档失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  const [importing, setImporting] = useState(false);

  const handleImportNotifications = async () => {
    let notifications: any[];
    try {
      notifications = JSON.parse(importJson);
      if (!Array.isArray(notifications)) {
        throw new Error("必须是 JSON 数组");
      }
    } catch (e) {
      alert("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)));
      return;
    }

    setImportingNotifications(true);
    try {
      const r = await api.importFollowUpsFromNotifications(notifications);
      const data = r.data;
      setImportResult({
        created: data.created?.length ?? 0,
        updated: data.updated?.length ?? 0,
        skipped: data.skipped?.length ?? 0,
        newCustomers: data.newCustomers ?? 0
      });
      // 刷新列表
      const list = await api.listFollowUps({ year, archived: showArchived, limit: 100 });
      setItems(list.data);
      setTotal(list.total);
      setTotalAll(list.totalAll);
    } catch (e) {
      alert("导入失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImportingNotifications(false);
    }
  };

  const handleAutoImport = async () => {
    if (!confirm(`从客户历史数据自动导入"${year}"年的跟进（基于 last_service_at）？\n将跳过已存在的跟进。`)) return;
    setImporting(true);
    try {
      const r = await api.autoFollowUpFromHistory(year, 200);
      alert(`已扫描 ${r.data.scanned} 个有历史交易的客户，创建 ${r.data.created} 条跟进`);
      // 刷新
      const list = await api.listFollowUps({ year, archived: showArchived, limit: 100 });
      setItems(list.data);
      setTotal(list.total);
      setTotalAll(list.totalAll);
    } catch (e) {
      alert("导入失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">客户管理 · 跟进</span>
          <h1>客户跟进</h1>
          <p>跟踪客户从"到期→报价→合同→实施→出证→完成"全流程。每年归档以便来年继续跟进。</p>
        </div>
        <div className="page-header-actions">
          <button
            className="ghost-button"
            onClick={() => setShowImportModal(true)}
            title="从手机通知导入沟通信息"
          >
            <Bell size={16} />
            通知导入
          </button>
          <button
            className="ghost-button"
            onClick={handleAutoImport}
            disabled={importing}
            title="从客户的历史交易记录自动导入跟进"
          >
            {importing ? <LoaderCircle className="spin" size={16} /> : <Wand2 size={16} />}
            从历史导入
          </button>
          <button className="ghost-button" onClick={handleArchive}>
            <Archive size={16} /> 归档 {year} 年
          </button>
        </div>
      </header>

      {/* 筛选 */}
      <section className="finance-toolbar">
        <div className="toolbar-group">
          <Calendar size={16} />
          <span>年度：</span>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="toolbar-select"
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="toolbar-group">
          <span>阶段：</span>
          <button
            className={stage === "" ? "type-pill active" : "type-pill"}
            onClick={() => setStage("")}
          >
            全部
          </button>
          {STAGE_FALLBACK.map(s => (
            <button
              key={s.key}
              className={stage === s.key ? `type-pill active ${s.color}` : `type-pill ${s.color}`}
              onClick={() => setStage(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>显示归档</span>
          </label>
        </div>
        <div className="toolbar-group" style={{ marginLeft: "auto" }}>
          <span>
            共 <strong>{totalAll}</strong> 条
            {total < totalAll && <>（已筛选 <strong>{total}</strong> 条）</>}
          </span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {/* 阶段进度漏斗 */}
      <section className="card">
        <div className="card-header">
          <h3>
            <Sparkles size={16} /> {year} 年阶段漏斗
          </h3>
          <span className="card-note">
            进行中 <strong>{items.filter(i => !i.isArchived).length}</strong>
            {totalAll > items.filter(i => !i.isArchived).length && (
              <> · 归档 <strong>{totalAll - items.filter(i => !i.isArchived).length}</strong></>
            )}
          </span>
        </div>
        <div className="card-body">
          <div className="follow-up-funnel">
            {STAGE_FALLBACK.map(s => {
              const active = items.filter(i => i.stage === s.key && !i.isArchived).length;
              const archived = items.filter(i => i.stage === s.key && i.isArchived).length;
              return (
                <div key={s.key} className={`funnel-step funnel-${s.color}`}>
                  <span className="funnel-label">{s.label}</span>
                  <span className="funnel-count">{active}</span>
                  {archived > 0 && (
                    <span className="funnel-archived">归档 {archived}</span>
                  )}
                </div>
              );
            })}
          </div>
          {totalAll === 0 && (
            <div className="funnel-note">
              💡 {year} 年暂无跟进。点击页面右上角 <strong>「从历史导入」</strong> 自动从客户历史交易生成跟进，或在「客户管理」中为单个客户创建跟进。
            </div>
          )}
        </div>
      </section>

      {/* 列表 */}
      <section className="customer-list">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={20} /> 正在加载...
          </div>
        ) : items.length === 0 ? (
          <div className="empty-row">{year} 年暂无跟进记录</div>
        ) : (
          <table className="customer-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>认证类型</th>
                <th>阶段</th>
                <th>预计完成</th>
                <th>金额</th>
                <th>更新</th>
                <th>归档</th>
              </tr>
            </thead>
            <tbody>
              {items.map(f => {
                const stageInfo = STAGE_FALLBACK.find(s => s.key === f.stage) || STAGE_FALLBACK[0];
                return (
                  <tr
                    key={f.id}
                    className="clickable-row"
                    onClick={() => f.customerId && onOpenCustomer(f.customerId)}
                  >
                    <td>
                      <strong>{f.customerName || "—"}</strong>
                      {f.projectCode && (
                        <small style={{ color: "var(--muted)", marginLeft: 6 }}>
                          {f.projectCode}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="cert-tag">{f.certificationType || "—"}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${STATUS_COLORS[stageInfo.color] || "status-default"}`}>
                        {stageInfo.label}
                      </span>
                    </td>
                    <td className="mono">
                      {f.expectedDate
                        ? new Date(f.expectedDate).toLocaleDateString("zh-CN")
                        : "—"}
                    </td>
                    <td>
                      {f.contractAmount ? (
                        <strong>¥{f.contractAmount.toLocaleString()}</strong>
                      ) : f.expectedAmount ? (
                        <span style={{ color: "var(--muted)" }}>
                          ¥{f.expectedAmount.toLocaleString()}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                      {f.completedAt
                        ? new Date(f.completedAt).toLocaleDateString("zh-CN")
                        : "—"}
                    </td>
                    <td>
                      {f.isArchived ? (
                        <span className="archived-tag">已归档 {f.archivedYear}</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 通知导入 Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <Bell size={20} />
              <h2>从手机通知导入跟进</h2>
              <button className="ghost-button close-btn" onClick={() => setShowImportModal(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                💡 将 YoooClaw 提取的通知数据粘贴到下方 JSON 数组。
                每条通知包含客户名、沟通摘要、阶段、金额等字段。
              </p>

              <details className="schema-hint">
                <summary>查看 JSON 格式示例</summary>
                <pre>{`[
  {
    "customerName": "宁夏希望信息产业股份有限公司",
    "customerPhone": "13800000001",
    "stage": "quoted",
    "year": 2026,
    "certificationType": "QES",
    "issuingBody": "zhongren",
    "contractAmount": 85000,
    "expectedDate": "2026-09-15",
    "summary": "客户回复邮件同意 8.5 万报价",
    "sourceApp": "Mail"
  }
]`}</pre>
              </details>

              <textarea
                className="json-input"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='粘贴 JSON 数组，例如：[{"customerName":"...","summary":"..."}]'
                rows={12}
              />

              {importResult && (
                <div className="import-result">
                  <strong>导入结果：</strong>
                  <span className="result-tag created">新建 {importResult.created} 条</span>
                  {importResult.updated > 0 && (
                    <span className="result-tag updated">更新 {importResult.updated} 条</span>
                  )}
                  {importResult.newCustomers > 0 && (
                    <span className="result-tag new">新客户 {importResult.newCustomers} 个</span>
                  )}
                  {importResult.skipped > 0 && (
                    <span className="result-tag skipped">跳过 {importResult.skipped} 条</span>
                  )}
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button
                className="ghost-button"
                onClick={() => setShowImportModal(false)}
              >
                关闭
              </button>
              <button
                className="primary-button"
                onClick={handleImportNotifications}
                disabled={importingNotifications || !importJson.trim()}
              >
                {importingNotifications ? <LoaderCircle className="spin" size={16} /> : <Bell size={16} />}
                导入
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}