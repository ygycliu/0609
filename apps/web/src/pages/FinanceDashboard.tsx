import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  ChevronRight,
  CircleDollarSign,
  Download,
  Filter,
  LoaderCircle,
  Receipt,
  TrendingDown,
  TrendingUp,
  X
} from "lucide-react";
import { api } from "../lib/api";

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  income: { label: "收入", color: "green" },
  expense: { label: "支出", color: "pink" }
};

interface SummaryData {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  incomeByCategory: Array<{ category: string; total: number; count: number }>;
  expenseByCategory: Array<{ category: string; total: number; count: number }>;
  incomeByCustomer: Array<{ customerId: string; customerName: string | null; total: number }>;
  expenseByCustomer: Array<{ customerId: string; customerName: string | null; total: number }>;
}

const PAGE_SIZE = 50;

interface FinanceDashboardProps {
  onOpenTransaction: (id: string) => void;
}

export function FinanceDashboard({ onOpenTransaction }: FinanceDashboardProps) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  // 默认覆盖所有历史数据（2024-2025）
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2025-12-31");
  const [page, setPage] = useState(0);

  // 客户穿透查看状态
  const [drillCustomer, setDrillCustomer] = useState<{
    id: string;
    name: string;
    type: "income" | "expense";
  } | null>(null);
  const [drillTx, setDrillTx] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // 应收账款 Top 10
  const [arTop, setArTop] = useState<Array<{
    customerId: string;
    customerName: string;
    arCount: number;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    maxOverdueDays: number;
  }>>([]);
  const [arLoading, setArLoading] = useState(false);
  const [arDrill, setArDrill] = useState<{
    customerId: string;
    customerName: string;
  } | null>(null);
  const [arDrillList, setArDrillList] = useState<any[]>([]);
  const [arDrillLoading, setArDrillLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api.getFinanceSummary({ start_date: startDate, end_date: endDate }),
      api.listTransactions({
        type: typeFilter === "all" ? undefined : typeFilter,
        start_date: startDate,
        end_date: endDate,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
    ])
      .then(([sumRes, txRes]) => {
        // api.getFinanceSummary 用 request() 自动解包，所以 sumRes 直接是 data
        // api.listTransactions 用 fetch() 自己解析，所以 txRes 是 {data, total}
        setSummary(sumRes);
        setTransactions(txRes.data);
        setTotal(txRes.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [startDate, endDate, typeFilter, page]);

  // V2.0：月度趋势聚合（从交易按月统计收入/支出）
  const monthlyTrend = useMemo(() => {
    const trend: Record<string, { income: number; expense: number }> = {};
    for (const tx of transactions) {
      const date = tx.transactionDate || tx.transaction_date || tx.createdAt || tx.created_at;
      if (!date) continue;
      const month = String(date).slice(0, 7); // YYYY-MM
      if (!trend[month]) trend[month] = { income: 0, expense: 0 };
      const amount = Number(tx.amount ?? 0);
      if (tx.type === "income") trend[month].income += amount;
      else if (tx.type === "expense") trend[month].expense += amount;
    }
    // 生成最近 6 个月（包括零数据）
    const result: Array<{ month: string; income: number; expense: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        month: key,
        income: trend[key]?.income ?? 0,
        expense: trend[key]?.expense ?? 0
      });
    }
    return result;
  }, [transactions]);

  // V2.0：AR 总额汇总
  const arSummary = useMemo(() => {
    const totalAmount = arTop.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
    const remainingAmount = arTop.reduce((s, r) => s + Number(r.remainingAmount ?? 0), 0);
    const overdueCount = arTop.filter((r) => Number(r.maxOverdueDays ?? 0) > 0).length;
    return { totalAmount, remainingAmount, overdueCount };
  }, [arTop]);

  // 加载穿透客户的交易
  useEffect(() => {
    if (!drillCustomer) {
      setDrillTx([]);
      return;
    }
    setDrillLoading(true);
    api.listTransactions({
        type: drillCustomer.type,
        customer_id: drillCustomer.id,
        start_date: startDate,
        end_date: endDate,
        limit: 200,
        offset: 0
      })
      .then((r) => {
        setDrillTx(r.data);
      })
      .catch((e) => console.error("drill load failed:", e))
      .finally(() => setDrillLoading(false));
  }, [drillCustomer, startDate, endDate]);

  // 加载应收账款 Top 10
  useEffect(() => {
    setArLoading(true);
    api.getARTopByCustomer(10)
      .then((r) => setArTop(r.data || []))
      .catch(() => setArTop([]))
      .finally(() => setArLoading(false));
  }, []);

  // 加载某客户应收账款明细
  useEffect(() => {
    if (!arDrill) {
      setArDrillList([]);
      return;
    }
    setArDrillLoading(true);
    api.listAR({ customer_id: arDrill.customerId, limit: 50 })
      .then((r) => setArDrillList(r.data))
      .catch(() => setArDrillList([]))
      .finally(() => setArDrillLoading(false));
  }, [arDrill]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">认证业务中心 · 财务</span>
          <h1>财务管理</h1>
          <p>记录项目、客户、公司的收入 / 支出 / 利润；客户档案与客户管理模块统一。</p>
        </div>
      </header>

      {/* 统计区 */}
      <section className="finance-metric-grid">
        <div className="metric metric-income">
          <span>总收入</span>
          <strong>¥{summary?.totalIncome?.toLocaleString() ?? "0"}</strong>
          <small>本期间所有收入分类</small>
          <TrendingUp size={32} className="metric-icon" />
        </div>
        <div className="metric metric-expense">
          <span>总支出</span>
          <strong>¥{summary?.totalExpense?.toLocaleString() ?? "0"}</strong>
          <small>本期间所有支出分类</small>
          <TrendingDown size={32} className="metric-icon" />
        </div>
        <div className="metric metric-profit">
          <span>净利润</span>
          <strong>¥{summary?.netProfit?.toLocaleString() ?? "0"}</strong>
          <small>收入 - 支出</small>
          <CircleDollarSign size={32} className="metric-icon" />
        </div>
        {/* V2.0：应收总额 / 未收总额 / 逾期客户数 */}
        <div className="metric metric-ar">
          <span>应收总额</span>
          <strong>¥{arSummary.totalAmount.toLocaleString()}</strong>
          <small>已签合同未收齐</small>
          <Banknote size={32} className="metric-icon" />
        </div>
        <div className="metric metric-ar-remaining">
          <span>未收总额</span>
          <strong style={{ color: arSummary.remainingAmount > 0 ? "#dc2626" : "#059669" }}>
            ¥{arSummary.remainingAmount.toLocaleString()}
          </strong>
          <small>未收回金额</small>
          <Receipt size={32} className="metric-icon" />
        </div>
        <div className="metric metric-overdue">
          <span>逾期客户</span>
          <strong style={{ color: arSummary.overdueCount > 0 ? "#dc2626" : "#059669" }}>
            {arSummary.overdueCount} 个
          </strong>
          <small>有逾期应收</small>
          <AlertCircle size={32} className="metric-icon" />
        </div>
      </section>

      {/* V2.0：6 个月趋势图 */}
      <section className="card trend-card">
        <div className="card-header">
          <h3>📈 最近 6 个月收入/支出趋势</h3>
          <span className="muted small">基于当前交易数据</span>
        </div>
        <div className="card-body">
          <div className="trend-chart">
            {monthlyTrend.map((m, idx) => {
              const maxVal = Math.max(...monthlyTrend.map(t => Math.max(t.income, t.expense)), 1);
              const incomeH = Math.max((m.income / maxVal) * 180, 2);
              const expenseH = Math.max((m.expense / maxVal) * 180, 2);
              const monthLabel = m.month.slice(5);
              return (
                <div key={m.month} className="trend-bar-group">
                  <div className="trend-bar-pair">
                    <div
                      className="trend-bar trend-income"
                      style={{ height: `${incomeH}px` }}
                      title={`收入 ¥${m.income.toLocaleString()}`}
                    >
                      {m.income > 0 && <span className="trend-value">¥{(m.income / 1000).toFixed(1)}k</span>}
                    </div>
                    <div
                      className="trend-bar trend-expense"
                      style={{ height: `${expenseH}px` }}
                      title={`支出 ¥${m.expense.toLocaleString()}`}
                    >
                      {m.expense > 0 && <span className="trend-value">¥{(m.expense / 1000).toFixed(1)}k</span>}
                    </div>
                  </div>
                  <div className="trend-label">{monthLabel}月</div>
                  <div className="trend-netto">
                    净 {m.income - m.expense >= 0 ? "+" : ""}¥{((m.income - m.expense) / 1000).toFixed(1)}k
                  </div>
                </div>
              );
            })}
          </div>
          <div className="trend-legend">
            <span className="trend-legend-item"><span className="dot dot-income" /> 收入</span>
            <span className="trend-legend-item"><span className="dot dot-expense" /> 支出</span>
          </div>
        </div>
      </section>

      {/* 期间筛选 */}
      <section className="finance-toolbar">
        <div className="toolbar-group">
          <Filter size={16} />
          <span>期间：</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setPage(0);
              setStartDate(e.target.value);
            }}
          />
          <span>~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setPage(0);
              setEndDate(e.target.value);
            }}
          />
        </div>
        <div className="toolbar-group">
          <button
            className={typeFilter === "all" ? "type-pill active" : "type-pill"}
            onClick={() => { setPage(0); setTypeFilter("all"); }}
          >
            全部
          </button>
          <button
            className={typeFilter === "income" ? "type-pill active green" : "type-pill green"}
            onClick={() => { setPage(0); setTypeFilter("income"); }}
          >
            <TrendingUp size={14} /> 收入
          </button>
          <button
            className={typeFilter === "expense" ? "type-pill active pink" : "type-pill pink"}
            onClick={() => { setPage(0); setTypeFilter("expense"); }}
          >
            <TrendingDown size={14} /> 支出
          </button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {/* 分类 + 客户 双栏 */}
      <section className="finance-grid">
        {/* 收入分类 */}
        <div className="card">
          <div className="card-header">
            <h3>
              <TrendingUp size={16} /> 收入分类 Top 10
            </h3>
          </div>
          <div className="card-body">
            {summary?.incomeByCategory.slice(0, 10).map((c) => {
              const max = summary.incomeByCategory[0]?.total ?? 1;
              const pct = (c.total / max) * 100;
              return (
                <div key={c.category} className="bar-row">
                  <span className="bar-label">{c.category}</span>
                  <div className="bar-track">
                    <div className="bar-fill bar-green" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">¥{c.total.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 支出分类 */}
        <div className="card">
          <div className="card-header">
            <h3>
              <TrendingDown size={16} /> 支出分类 Top 10
            </h3>
          </div>
          <div className="card-body">
            {summary?.expenseByCategory.slice(0, 10).map((c) => {
              const max = summary.expenseByCategory[0]?.total ?? 1;
              const pct = (c.total / max) * 100;
              return (
                <div key={c.category} className="bar-row">
                  <span className="bar-label">{c.category}</span>
                  <div className="bar-track">
                    <div className="bar-fill bar-pink" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="bar-value">¥{c.total.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 客户收入 Top 10 */}
        <div className="card">
          <div className="card-header">
            <h3>
              <Banknote size={16} /> 客户收入 Top 10
            </h3>
          </div>
          <div className="card-body">
            {summary?.incomeByCustomer.slice(0, 10).map((c) => (
              <div
                key={c.customerId}
                className="customer-row clickable"
                onClick={() => setDrillCustomer({ id: c.customerId, name: c.customerName ?? "未关联客户", type: "income" })}
                title="点击查看该客户的所有收入明细"
              >
                <span className="customer-name">{c.customerName ?? "未关联客户"}</span>
                <span className="customer-amount">¥{c.total.toLocaleString()}</span>
                <ChevronRight size={14} />
              </div>
            ))}
          </div>
        </div>

        {/* 客户支出 Top 10 */}
        <div className="card">
          <div className="card-header">
            <h3>
              <Receipt size={16} /> 客户支出 Top 10
            </h3>
          </div>
          <div className="card-body">
            {summary?.expenseByCustomer.slice(0, 10).map((c) => (
              <div
                key={c.customerId}
                className="customer-row clickable"
                onClick={() => setDrillCustomer({ id: c.customerId, name: c.customerName ?? "公司层面", type: "expense" })}
                title="点击查看该客户的所有支出明细"
              >
                <span className="customer-name">{c.customerName ?? "公司层面"}</span>
                <span className="customer-amount">¥{c.total.toLocaleString()}</span>
                <ChevronRight size={14} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 应收账款 Top 10 */}
      <section className="finance-grid">
        <div className="card ar-card">
          <div className="card-header">
            <h3>
              <AlertCircle size={16} /> 应收账款 Top 10
            </h3>
            <span className="card-note">
              未收回 ¥{arTop.reduce((s, c) => s + c.remainingAmount, 0).toLocaleString()}
            </span>
          </div>
          <div className="card-body">
            {arLoading ? (
              <div className="loading-row">
                <LoaderCircle className="spin" size={20} /> 加载中...
              </div>
            ) : arTop.length === 0 ? (
              <div className="empty-row">暂无应收账款</div>
            ) : (
              arTop.map((c) => (
                <div
                  key={c.customerId}
                  className="customer-row clickable ar-row"
                  onClick={() => setArDrill({ customerId: c.customerId, customerName: c.customerName })}
                  title="点击查看该客户的应收账款明细"
                >
                  <div className="ar-row-main">
                    <span className="customer-name">{c.customerName}</span>
                    <span className="ar-meta">
                      {c.arCount} 笔
                      {c.maxOverdueDays > 0 && (
                        <span className="overdue-badge">逾期 {c.maxOverdueDays} 天</span>
                      )}
                    </span>
                  </div>
                  <span className="customer-amount">¥{c.remainingAmount.toLocaleString()}</span>
                  <ChevronRight size={14} />
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* 穿透查看抽屉 */}
      {drillCustomer && (
        <>
          <div className="drawer-overlay" onClick={() => setDrillCustomer(null)} />
          <aside className="drawer">
            <header className="drawer-header">
              <div>
                <span className="eyebrow">{drillCustomer.type === "income" ? "客户收入明细" : "客户支出明细"}</span>
                <h2>{drillCustomer.name}</h2>
                <p>
                  {startDate} ~ {endDate} · 共 {drillTx.length} 条
                  {drillTx.length > 0 && (
                    <> · 合计 ¥
                      {drillTx.reduce((s, x) => s + Number(x.amount), 0).toLocaleString()}
                    </>
                  )}
                </p>
              </div>
              <button className="ghost-button" onClick={() => setDrillCustomer(null)} title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="drawer-body">
              {drillLoading ? (
                <div className="loading-row">
                  <LoaderCircle className="spin" size={20} /> 加载中...
                </div>
              ) : drillTx.length === 0 ? (
                <div className="empty-row">该客户在此期间没有 {drillCustomer.type === "income" ? "收入" : "支出"} 记录</div>
              ) : (
                <table className="drill-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>分类</th>
                      <th style={{ textAlign: "right" }}>金额</th>
                      <th>描述</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillTx.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">
                          {new Date(t.transDate).toLocaleDateString("zh-CN")}
                        </td>
                        <td>{t.category}</td>
                        <td style={{ textAlign: "right" }}>
                          <strong style={{ color: t.type === "income" ? "var(--green)" : "#b03a3a" }}>
                            {t.type === "income" ? "+" : "-"}¥{Number(t.amount).toLocaleString()}
                          </strong>
                        </td>
                        <td className="muted">{t.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </>
      )}

      {/* 应收账款穿透 drawer */}
      {arDrill && (
        <>
          <div className="drawer-overlay" onClick={() => setArDrill(null)} />
          <aside className="drawer">
            <header className="drawer-header ar-drawer">
              <div>
                <span className="eyebrow">应收账款明细</span>
                <h2>{arDrill.customerName}</h2>
                <p>
                  {arDrillList.length} 笔账单 · 未收回 ¥
                  {arDrillList.reduce((s, x) => s + Number(x.remainingAmount || 0), 0).toLocaleString()}
                </p>
              </div>
              <button className="ghost-button" onClick={() => setArDrill(null)} title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="drawer-body">
              {arDrillLoading ? (
                <div className="loading-row">
                  <LoaderCircle className="spin" size={20} /> 加载中...
                </div>
              ) : arDrillList.length === 0 ? (
                <div className="empty-row">该客户暂无应收账款</div>
              ) : (
                <table className="drill-table">
                  <thead>
                    <tr>
                      <th>账单号</th>
                      <th>标题</th>
                      <th>应收</th>
                      <th>已收</th>
                      <th>未收</th>
                      <th>到期日</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arDrillList.map((ar) => (
                      <tr key={ar.id}>
                        <td className="mono">{ar.arNo}</td>
                        <td>{ar.title}</td>
                        <td>¥{Number(ar.totalAmount).toLocaleString()}</td>
                        <td>¥{Number(ar.paidAmount).toLocaleString()}</td>
                        <td>
                          <strong style={{ color: "var(--primary)" }}>
                            ¥{Number(ar.remainingAmount).toLocaleString()}
                          </strong>
                        </td>
                        <td className="mono">
                          {ar.dueDate
                            ? new Date(ar.dueDate).toLocaleDateString("zh-CN")
                            : "—"}
                        </td>
                        <td>
                          {ar.status === "paid" ? (
                            <span className="status-pill status-completed">已收</span>
                          ) : ar.overdueDays > 0 ? (
                            <span className="status-pill status-overdue">逾期 {ar.overdueDays} 天</span>
                          ) : (
                            <span className="status-pill status-pending">待收</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </>
      )}

      {/* 流水 */}
      <section className="section-heading">
        <div>
          <span className="eyebrow">流水明细</span>
          <h2>本期间 {total} 条交易</h2>
        </div>
      </section>

      <section className="customer-list">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={20} /> 正在加载...
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-row">没有匹配的交易</div>
        ) : (
          <table className="customer-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>分类</th>
                <th>金额</th>
                <th>描述</th>
                <th>客户</th>
                <th>项目</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="clickable-row" onClick={() => onOpenTransaction(t.id)}>
                  <td className="mono">
                    {new Date(t.transDate).toLocaleDateString("zh-CN")}
                  </td>
                  <td>
                    <span className={`status-pill status-${t.type === "income" ? "active" : "inactive"}`}>
                      {t.type === "income" ? "收入" : "支出"}
                    </span>
                  </td>
                  <td>{t.category}</td>
                  <td>
                    <strong style={{ color: t.type === "income" ? "var(--green)" : "#b03a3a" }}>
                      {t.type === "income" ? "+" : "-"}¥{Number(t.amount).toLocaleString()}
                    </strong>
                  </td>
                  <td className="muted" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.description || "—"}
                  </td>
                  <td>{t.customerName || "—"}</td>
                  <td>{t.projectCode || "—"}</td>
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