import { useEffect, useState } from "react";
import {
  Banknote,
  CircleDollarSign,
  Download,
  Filter,
  LoaderCircle,
  Receipt,
  TrendingDown,
  TrendingUp
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
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [page, setPage] = useState(0);

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
        setSummary(sumRes.data);
        setTransactions(txRes.data);
        setTotal(txRes.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [startDate, endDate, typeFilter, page]);

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
              <div key={c.customerId} className="customer-row">
                <span className="customer-name">{c.customerName ?? "未关联客户"}</span>
                <span className="customer-amount">¥{c.total.toLocaleString()}</span>
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
              <div key={c.customerId} className="customer-row">
                <span className="customer-name">{c.customerName ?? "公司层面"}</span>
                <span className="customer-amount">¥{c.total.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

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