import { useEffect, useState } from "react";
import {
  Archive,
  Bell,
  Calendar,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  MessageSquarePlus,
  Plus,
  PowerOff,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
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
  issuingBody?: string;
  stage: string;
  year: number;
  expectedDate?: string;
  completedAt?: string;
  expectedAmount?: number;
  contractAmount?: number;
  notes?: string;
  isArchived?: boolean;
  archivedYear?: number;
  updatedAt?: string;
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

  // 详情抽屉
  const [detailItem, setDetailItem] = useState<FollowUpItem | null>(null);

  // 继续沟通 Modal
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueStage, setContinueStage] = useState("expired");
  const [continueNotes, setContinueNotes] = useState("");
  const [continueSaving, setContinueSaving] = useState(false);

  // 关闭跟进 Modal（整页模式）
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeAction, setCloseAction] = useState<"complete" | "archive_all" | "delete_all">("complete");
  const [closeSaving, setCloseSaving] = useState(false);

  // 删除单条
  const [deleting, setDeleting] = useState(false);

  // 关闭跟进（单条，需填原因）
  const [showCloseSingleModal, setShowCloseSingleModal] = useState(false);
  const [closeReason, setCloseReason] = useState("certified_and_delivered");
  const [closeNotes, setCloseNotes] = useState("");
  const [closeSingleSaving, setCloseSingleSaving] = useState(false);

  // 继续沟通：客户历史认证类型建议
  const [certTypeSuggestions, setCertTypeSuggestions] = useState<string[]>([]);
  const [continueCertType, setContinueCertType] = useState("");

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
          <button
            className="ghost-button danger-action"
            onClick={() => setShowCloseModal(true)}
            title="关闭跟进功能（批量操作）"
          >
            <PowerOff size={16} />
            关闭跟进
          </button>
          <button
            className="ghost-button primary-action"
            onClick={() => onOpenCustomer("")}
            title="新建客户（不指定ID则进入新建页）"
          >
            <Plus size={16} />
            新建客户
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
                    onClick={() => setDetailItem(f)}
                  >
                    <td>
                      <a
                        className="customer-link"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (f.customerId) onOpenCustomer(f.customerId);
                        }}
                      >
                        <strong>{f.customerName || "—"}</strong>
                      </a>
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

      {/* 详情抽屉 */}
      {detailItem && (
        <div className="drawer-overlay" onClick={() => setDetailItem(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <span className="eyebrow">跟进详情 · {detailItem.year} 年</span>
                <h2>
                  {detailItem.customerName || "—"}
                  <button
                    className="ghost-button icon-only"
                    onClick={() => {
                      if (detailItem.customerId) {
                        onOpenCustomer(detailItem.customerId);
                        setDetailItem(null);
                      }
                    }}
                    title="查看客户档案"
                  >
                    <ExternalLink size={14} />
                  </button>
                </h2>
              </div>
              <button className="ghost-button close-btn" onClick={() => setDetailItem(null)}>×</button>
            </header>
            <div className="drawer-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="label">当前阶段</span>
                  <span className="value">
                    {(STAGE_FALLBACK.find(s => s.key === detailItem.stage) || STAGE_FALLBACK[0]).label}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="label">认证类型</span>
                  <span className="value">{detailItem.certificationType || "—"}</span>
                </div>
                <div className="detail-item">
                  <span className="label">出证机构</span>
                  <span className="value">
                    {detailItem.issuingBody === "huazhong" ? "华中检测" :
                     detailItem.issuingBody === "other" ? "其他" : "中认认证"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="label">合同金额</span>
                  <span className="value">
                    {detailItem.contractAmount
                      ? `¥${detailItem.contractAmount.toLocaleString()}`
                      : "—"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="label">预计完成</span>
                  <span className="value">
                    {detailItem.expectedDate
                      ? new Date(detailItem.expectedDate).toLocaleDateString("zh-CN")
                      : "—"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="label">项目编号</span>
                  <span className="value">{detailItem.projectCode || "—"}</span>
                </div>
                {detailItem.updatedAt && (
                  <div className="detail-item full">
                    <span className="label">最近更新</span>
                    <span className="value">
                      {new Date(detailItem.updatedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                )}
                {detailItem.notes && (
                  <div className="detail-item full">
                    <span className="label">备注</span>
                    <span className="value notes">{detailItem.notes}</span>
                  </div>
                )}
              </div>

              {/* 🎯 审核计划（项目实施阶段自动生成）*/}
              {detailItem.stage === "implementing" && (
                <AuditPlanSection followUpId={detailItem.id} customerName={detailItem.customerName || "—"} />
              )}
            </div>
            <footer className="drawer-footer">
              <button
                className="danger-button"
                onClick={async () => {
                  if (!confirm(`确认删除跟进「${detailItem.customerName} · ${detailItem.year}年」？\\n删除后无法恢复。`)) return;
                  setDeleting(true);
                  try {
                    await api.deleteFollowUp(detailItem.id);
                    setDetailItem(null);
                    window.location.reload();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "删除失败");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
              >
                {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                删除
              </button>
              <button
                className="ghost-button warning-action"
                onClick={() => {
                  setCloseReason("certified_and_delivered");
                  setCloseNotes("");
                  setShowCloseSingleModal(true);
                }}
                disabled={detailItem.stage === "completed"}
                title={detailItem.stage === "completed" ? "已关闭" : "关闭跟进（需填原因）"}
              >
                <Power size={16} />
                关闭跟进
              </button>
              <button className="ghost-button" onClick={() => setDetailItem(null)}>关闭</button>
              <button
                className="primary-button"
                onClick={async () => {
                  setContinueStage("quoted");
                  setContinueNotes(`基于 ${detailItem.year} 年跟进继续沟通`);
                  setContinueCertType(detailItem.certificationType || "");
                  setShowContinueModal(true);
                  // 加载该客户的历史认证类型建议
                  if (detailItem.customerId) {
                    try {
                      const r = await api.getCustomerCertTypes(detailItem.customerId);
                      setCertTypeSuggestions(r.data || []);
                    } catch (e) {
                      console.error("加载认证类型建议失败", e);
                    }
                  }
                }}
              >
                <MessageSquarePlus size={16} />
                继续沟通
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 关闭跟进（单条）Modal */}
      {showCloseSingleModal && detailItem && (
        <div className="modal-overlay" onClick={() => setShowCloseSingleModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header warning">
              <PowerOff size={20} />
              <h2>关闭跟进</h2>
              <button className="ghost-button close-btn" onClick={() => setShowCloseSingleModal(false)}>×</button>
            </header>
            <div className="modal-body">
              <p className="modal-hint warning">
                ⚠️ 关闭跟进后，该记录将标记为已完成，且不再显示在跟进列表中。
              </p>
              <p className="modal-hint">
                💡 <strong>客户：</strong>{detailItem.customerName}
                <br />📅 <strong>年度：</strong>{detailItem.year}
              </p>

              <label className="field">
                <span>关闭原因 <span className="required">*</span></span>
                <select value={closeReason} onChange={(e) => setCloseReason(e.target.value)}>
                  <option value="certified_and_delivered">✅ 出证交付完成</option>
                  <option value="customer_declined">🚫 客户主动拒绝</option>
                  <option value="price_too_high">💰 价格原因</option>
                  <option value="unable_to_contact">📞 联系不上</option>
                  <option value="customer_lost">💼 客户流失</option>
                  <option value="competitor_chosen">🏆 选择竞争对手</option>
                  <option value="duplicate">📋 重复跟进</option>
                  <option value="other">📝 其他原因</option>
                </select>
              </label>

              <label className="field">
                <span>详细说明 <span className="required">*</span></span>
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  rows={4}
                  placeholder="请说明关闭原因的具体情况（例如：QES 三体系证书已交付完成）"
                  autoFocus
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="ghost-button" onClick={() => setShowCloseSingleModal(false)}>取消</button>
              <button
                className="warning-button"
                onClick={async () => {
                  if (!closeReason) {
                    alert("请选择关闭原因");
                    return;
                  }
                  if (!closeNotes.trim()) {
                    alert("请填写详细说明（必填）");
                    return;
                  }
                  setCloseSingleSaving(true);
                  try {
                    await api.closeFollowUp(detailItem.id, closeReason, closeNotes.trim());
                    setShowCloseSingleModal(false);
                    setDetailItem(null);
                    window.location.reload();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "关闭失败");
                  } finally {
                    setCloseSingleSaving(false);
                  }
                }}
                disabled={closeSingleSaving || !closeNotes.trim()}
              >
                {closeSingleSaving ? <LoaderCircle className="spin" size={16} /> : <PowerOff size={16} />}
                确认关闭
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 继续沟通 Modal */}
      {showContinueModal && detailItem && (
        <div className="modal-overlay" onClick={() => setShowContinueModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <MessageSquarePlus size={20} />
              <h2>继续沟通 - 新跟进</h2>
              <button className="ghost-button close-btn" onClick={() => setShowContinueModal(false)}>×</button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                💡 为 <strong>{detailItem.customerName}</strong> 创建新年度跟进（自动延续）
              </p>
              <div className="form-grid two-col">
                <label className="field">
                  <span>年度</span>
                  <input
                    type="number"
                    value={detailItem.year + 1}
                    onChange={() => {}}
                    disabled
                  />
                </label>
                <label className="field">
                  <span>认证类型</span>
                  <input
                    list="cert-type-suggestions"
                    value={continueCertType}
                    onChange={(e) => setContinueCertType(e.target.value)}
                    placeholder={detailItem.certificationType || "如：QES / Q / 27001"}
                  />
                  <datalist id="cert-type-suggestions">
                    {certTypeSuggestions.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
              </div>
              <label className="field">
                <span>当前阶段</span>
                <select value={continueStage} onChange={(e) => setContinueStage(e.target.value)}>
                  <option value="expired">到期（证书需要续证）</option>
                  <option value="quoted">已报价</option>
                  <option value="contract_review">合同评审</option>
                  <option value="contract_signed">合同签订</option>
                  <option value="implementing">项目实施</option>
                  <option value="certified">出证</option>
                </select>
              </label>
              <label className="field">
                <span>备注（沟通内容）</span>
                <textarea
                  value={continueNotes}
                  onChange={(e) => setContinueNotes(e.target.value)}
                  rows={4}
                  placeholder="记录本次沟通的关键信息..."
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button className="ghost-button" onClick={() => setShowContinueModal(false)}>取消</button>
              <button
                className="primary-button"
                onClick={async () => {
                  setContinueSaving(true);
                  try {
                    await api.createFollowUp({
                      customerId: detailItem.customerId,
                      customerName: detailItem.customerName,
                      stage: continueStage,
                      year: detailItem.year + 1,
                      certificationType: continueCertType || null,
                      issuingBody: detailItem.issuingBody || "zhongren",
                      contractAmount: detailItem.contractAmount || null,
                      expectedDate: null,
                      notes: continueNotes
                    });
                    setShowContinueModal(false);
                    setDetailItem(null);
                    // 刷新列表
                    window.location.reload();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "创建失败");
                  } finally {
                    setContinueSaving(false);
                  }
                }}
                disabled={continueSaving}
              >
                {continueSaving ? <LoaderCircle className="spin" size={16} /> : <MessageSquarePlus size={16} />}
                创建新跟进
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 关闭跟进 Modal */}
      {showCloseModal && (
        <div className="modal-overlay" onClick={() => setShowCloseModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <PowerOff size={20} />
              <h2>关闭跟进功能</h2>
              <button className="ghost-button close-btn" onClick={() => setShowCloseModal(false)}>×</button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                💡 关闭跟进功能将批量处理当前年度（<strong>{year} 年</strong>）的所有跟进记录
              </p>

              <div className="close-options">
                <label className={`close-option ${closeAction === "complete" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="closeAction"
                    value="complete"
                    checked={closeAction === "complete"}
                    onChange={(e) => setCloseAction(e.target.value as any)}
                  />
                  <div className="close-option-content">
                    <div className="close-option-title">✅ 全部标记为已完成</div>
                    <div className="close-option-desc">
                      将 <strong>{year} 年</strong> 所有跟进标记为"已完成"状态（stage = completed）
                      <br />推荐：项目已全部交付，要关闭年度跟进
                    </div>
                  </div>
                </label>

                <label className={`close-option ${closeAction === "archive_all" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="closeAction"
                    value="archive_all"
                    checked={closeAction === "archive_all"}
                    onChange={(e) => setCloseAction(e.target.value as any)}
                  />
                  <div className="close-option-content">
                    <div className="close-option-title">📦 全部归档</div>
                    <div className="close-option-desc">
                      将 <strong>{year} 年</strong> 所有跟进归档（is_archived = true）
                      <br />数据保留，但不再显示在列表中
                    </div>
                  </div>
                </label>

                <label className={`close-option ${closeAction === "delete_all" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="closeAction"
                    value="delete_all"
                    checked={closeAction === "delete_all"}
                    onChange={(e) => setCloseAction(e.target.value as any)}
                  />
                  <div className="close-option-content">
                    <div className="close-option-title">🗑️ 全部删除（软删除）</div>
                    <div className="close-option-desc">
                      将 <strong>{year} 年</strong> 所有跟进软删除
                      <br />⚠️ 操作不可逆，请谨慎！
                    </div>
                  </div>
                </label>
              </div>
            </div>
            <footer className="modal-footer">
              <button className="ghost-button" onClick={() => setShowCloseModal(false)}>取消</button>
              <button
                className={closeAction === "delete_all" ? "danger-button" : "primary-button"}
                disabled={closeSaving}
                onClick={async () => {
                  if (closeAction === "delete_all") {
                    if (!confirm(`确认要删除 ${year} 年的所有跟进？\n此操作不可撤销！`)) return;
                  } else {
                    if (!confirm(`确认执行"${closeAction === 'complete' ? '全部标记为已完成' : '全部归档'}"？`)) return;
                  }
                  setCloseSaving(true);
                  try {
                    let count = 0;
                    if (closeAction === "complete") {
                      // 把所有未完成的标记为已完成
                      const allItems = await api.listFollowUps({ year, limit: 500 });
                      for (const item of allItems.data) {
                        if (item.stage !== "completed") {
                          await api.advanceFollowUp(item.id, "completed");
                          count++;
                        }
                      }
                      alert(`已将 ${count} 条跟进标记为已完成`);
                    } else if (closeAction === "archive_all") {
                      const r = await api.archiveFollowUpYear(year);
                      alert(`已归档 ${year} 年，共 ${r.data?.archivedCount || "所有"} 条`);
                    } else if (closeAction === "delete_all") {
                      const allItems = await api.listFollowUps({ year, limit: 500 });
                      for (const item of allItems.data) {
                        await api.deleteFollowUp(item.id);
                        count++;
                      }
                      alert(`已删除 ${count} 条跟进`);
                    }
                    setShowCloseModal(false);
                    window.location.reload();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "操作失败");
                  } finally {
                    setCloseSaving(false);
                  }
                }}
              >
                {closeSaving ? <LoaderCircle className="spin" size={16} /> : <PowerOff size={16} />}
                确认执行
              </button>
            </footer>
          </div>
        </div>
      )}

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
/**
 * 审核计划区块（仅项目实施阶段显示）
 * 从 audit_session + audit_checklist_item 自动生成
 */
function AuditPlanSection({ followUpId, customerName }: { followUpId: string; customerName: string }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getAuditPlanByFollowUp(followUpId)
      .then((r) => { if (!cancelled) setPlans(r.data || []); })
      .catch(() => { if (!cancelled) setPlans([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [followUpId]);

  if (loading) {
    return (
      <div className="audit-plan-section loading">
        <div className="section-title">
          <Sparkles size={16} />
          <span>自动审核计划</span>
        </div>
        <LoaderCircle className="spin" size={16} /> 加载中...
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="audit-plan-section empty">
        <div className="section-title">
          <Sparkles size={16} />
          <span>自动审核计划</span>
        </div>
        <p className="muted">该项目实施阶段已到达，但暂无审核计划。请联系数字审核员手动创建。</p>
      </div>
    );
  }

  return (
    <div className="audit-plan-section">
      <div className="section-title" onClick={() => setExpanded(!expanded)}>
        <Sparkles size={16} className="auto-icon" />
        <span>自动审核计划（{plans.length} 个 session / {plans.reduce((s, p) => s + parseInt(p.item_count || 0, 10), 0)} 项）</span>
        <span className="toggle">{expanded ? "▼" : "▶"}</span>
      </div>
      <p className="muted">📌 项目进入"实施"阶段时由系统根据客户体系自动生成，无需手动勾选。</p>

      {expanded && plans.map((p: any) => (
        <div key={p.id} className="audit-plan-card">
          <div className="audit-plan-header">
            <strong>{p.customer_name}</strong>
            <span className="auto-tag">自动</span>
            <span className="audit-type-tag">{p.audit_type === 'initial' ? '初次' : p.audit_type === 'surveillance' ? '监督' : '再认证'}</span>
          </div>
          <div className="audit-plan-meta">
            <span>📅 {p.scheduled_date ? new Date(p.scheduled_date).toLocaleDateString('zh-CN') : '未排期'}</span>
            <span>📋 {p.item_count} 项</span>
            <span>🏭 行业: {p.industry || '—'}</span>
          </div>
          <div className="audit-plan-standards">
            {(p.standards || []).map((s: string) => (
              <span key={s} className="standard-tag">{s.toUpperCase()}</span>
            ))}
          </div>
          <details className="audit-plan-items">
            <summary>查看 {p.item_count} 项审核清单</summary>
            <div className="muted small">提示：审核清单详情可在"数字审核员"模块查看与勾选。</div>
          </details>
        </div>
      ))}
    </div>
  );
}
