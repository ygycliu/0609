/**
 * V2.0 数据导入导出页面
 *
 * 4 个 Tab：
 * 1. 客户导出
 * 2. 客户导入
 * 3. 财务交易导出
 * 4. 财务交易导入（自动建客户）
 *
 * admin 专属
 */

import { useRef, useState } from "react";
import {
  X,
  Download,
  Upload,
  LoaderCircle,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Users,
  Banknote
} from "lucide-react";
import {
  exportCustomersCSV,
  importCustomersCSV,
  exportFinanceTransactionsCSV,
  importFinanceTransactionsCSV,
  downloadCustomerTemplate,
  downloadTransactionTemplate,
  type CustomerImportResult,
  type TransactionImportResult
} from "../lib/data-exchange";

type Tab = "customer-export" | "customer-import" | "finance-export" | "finance-import";

interface DataExchangePageProps {
  onClose?: () => void;
}

export function DataExchangePage({ onClose }: DataExchangePageProps) {
  const [activeTab, setActiveTab] = useState<Tab>("customer-export");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // 客户导入状态
  const [customerImportMode, setCustomerImportMode] = useState<"create" | "upsert">("create");
  const [customerResult, setCustomerResult] = useState<CustomerImportResult | null>(null);

  // 财务交易导入状态
  const [autoCreateCustomers, setAutoCreateCustomers] = useState(true);
  const [financeResult, setFinanceResult] = useState<TransactionImportResult | null>(null);

  // 财务导出参数
  const [financeStartDate, setFinanceStartDate] = useState("2024-01-01");
  const [financeEndDate, setFinanceEndDate] = useState("2025-12-31");
  const [financeType, setFinanceType] = useState<"all" | "income" | "expense">("all");

  const customerFileRef = useRef<HTMLInputElement>(null);
  const financeFileRef = useRef<HTMLInputElement>(null);

  // ============== 客户导出 ==============
  const handleCustomerExport = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const count = await exportCustomersCSV();
      setInfo(`✅ 已导出 ${count} 个客户`);
    } catch (e: any) {
      setError("导出失败：" + (e?.message ?? "未知错误"));
    } finally {
      setBusy(false);
    }
  };

  // ============== 客户导入 ==============
  const handleCustomerImport = async (file: File) => {
    setBusy(true);
    setError("");
    setCustomerResult(null);
    setProgress(null);
    try {
      const result = await importCustomersCSV(file, {
        mode: customerImportMode,
        onProgress: (current, total) => setProgress({ current, total })
      });
      setCustomerResult(result);
      setInfo(
        `✅ 完成！导入 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}`
      );
    } catch (e: any) {
      setError("导入失败：" + (e?.message ?? "未知错误"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // ============== 财务导出 ==============
  const handleFinanceExport = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const count = await exportFinanceTransactionsCSV({
        startDate: financeStartDate,
        endDate: financeEndDate,
        type: financeType === "all" ? undefined : financeType
      });
      setInfo(`✅ 已导出 ${count} 条交易`);
    } catch (e: any) {
      setError("导出失败：" + (e?.message ?? "未知错误"));
    } finally {
      setBusy(false);
    }
  };

  // ============== 财务导入 ==============
  const handleFinanceImport = async (file: File) => {
    setBusy(true);
    setError("");
    setFinanceResult(null);
    setProgress(null);
    try {
      const result = await importFinanceTransactionsCSV(file, {
        autoCreateCustomers,
        onProgress: (current, total) => setProgress({ current, total })
      });
      setFinanceResult(result);
      setInfo(
        `✅ 完成！导入 ${result.imported}，新建客户 ${result.newCustomers}，跳过 ${result.skipped}，失败 ${result.failed}`
      );
    } catch (e: any) {
      setError("导入失败：" + (e?.message ?? "未知错误"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="page data-exchange-page">
      {onClose && (
        <button
          className="ghost-icon page-close-btn"
          onClick={onClose}
          title="返回"
          style={{ position: "absolute", top: 16, right: 16 }}
        >
          <X size={18} />
        </button>
      )}

      <header className="page-header">
        <span className="eyebrow">工具 · 数据管理</span>
        <h1>📦 数据导入导出</h1>
        <p>
          批量导出全量数据到 CSV 文件，或从 CSV/Excel 文件批量导入。
          <strong style={{ color: "#dc2626" }}> 仅管理员可访问。</strong>
        </p>
      </header>

      {/* Tab 切换 */}
      <div className="data-exchange-tabs">
        <button
          className={activeTab === "customer-export" ? "active" : ""}
          onClick={() => setActiveTab("customer-export")}
        >
          <Download size={16} /> 客户导出
        </button>
        <button
          className={activeTab === "customer-import" ? "active" : ""}
          onClick={() => setActiveTab("customer-import")}
        >
          <Upload size={16} /> 客户导入
        </button>
        <button
          className={activeTab === "finance-export" ? "active" : ""}
          onClick={() => setActiveTab("finance-export")}
        >
          <Download size={16} /> 财务交易导出
        </button>
        <button
          className={activeTab === "finance-import" ? "active" : ""}
          onClick={() => setActiveTab("finance-import")}
        >
          <Upload size={16} /> 财务交易导入
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {info && <div className="success-banner">{info}</div>}

      {progress && (
        <div className="progress-bar">
          导入进度：{progress.current} / {progress.total}
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="data-exchange-content">
        {/* ========== 客户导出 ========== */}
        {activeTab === "customer-export" && (
          <section className="card">
            <div className="card-header">
              <h3>
                <Users size={20} /> 客户数据导出
              </h3>
            </div>
            <div className="card-body">
              <p>导出<strong>全部</strong>客户数据到 CSV 文件，包含编号、名称、行业、地区、联系人、标签等所有字段。</p>
              <div className="action-buttons">
                <button
                  className="ghost-button"
                  onClick={downloadCustomerTemplate}
                  disabled={busy}
                >
                  <FileText size={14} /> 下载导入模板
                </button>
                <button
                  className="primary-button"
                  onClick={handleCustomerExport}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={16} /> 导出中...
                    </>
                  ) : (
                    <>
                      <Download size={16} /> 导出全部客户
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ========== 客户导入 ========== */}
        {activeTab === "customer-import" && (
          <section className="card">
            <div className="card-header">
              <h3>
                <Upload size={20} /> 客户数据导入
              </h3>
            </div>
            <div className="card-body">
              <div className="form-group-inline">
                <label>
                  <strong>导入模式：</strong>
                </label>
                <label>
                  <input
                    type="radio"
                    name="customerMode"
                    checked={customerImportMode === "create"}
                    onChange={() => setCustomerImportMode("create")}
                  />
                  仅创建新客户（跳过已存在编号）
                </label>
                <label>
                  <input
                    type="radio"
                    name="customerMode"
                    checked={customerImportMode === "upsert"}
                    onChange={() => setCustomerImportMode("upsert")}
                  />
                  创建 + 更新（按客户编号 upsert）
                </label>
              </div>

              <input
                ref={customerFileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files?.[0] && handleCustomerImport(e.target.files[0])}
                style={{ display: "none" }}
              />
              <div className="action-buttons">
                <button
                  className="ghost-button"
                  onClick={downloadCustomerTemplate}
                  disabled={busy}
                >
                  <FileText size={14} /> 下载模板
                </button>
                <button
                  className="primary-button"
                  onClick={() => customerFileRef.current?.click()}
                  disabled={busy}
                >
                  <Upload size={16} /> 选择文件导入
                </button>
              </div>

              {customerResult && (
                <div className="import-result">
                  <h4>
                    <CheckCircle2 size={18} /> 导入完成
                  </h4>
                  <div className="result-stats">
                    <span><strong>{customerResult.total}</strong> 总行数</span>
                    <span style={{ color: "#059669" }}>
                      <strong>{customerResult.imported}</strong> 新建
                    </span>
                    <span style={{ color: "#0ea5e9" }}>
                      <strong>{customerResult.updated}</strong> 更新
                    </span>
                    <span style={{ color: "#94a3b8" }}>
                      <strong>{customerResult.skipped}</strong> 跳过
                    </span>
                    <span style={{ color: "#dc2626" }}>
                      <strong>{customerResult.failed}</strong> 失败
                    </span>
                  </div>
                  {customerResult.errors.length > 0 && (
                    <details>
                      <summary>失败详情（{customerResult.errors.length}）</summary>
                      <ul>
                        {customerResult.errors.slice(0, 20).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ========== 财务导出 ========== */}
        {activeTab === "finance-export" && (
          <section className="card">
            <div className="card-header">
              <h3>
                <Banknote size={20} /> 财务交易导出
              </h3>
            </div>
            <div className="card-body">
              <p>导出<strong>全部</strong>财务交易到 CSV，按筛选条件过滤。</p>

              <div className="filter-grid">
                <label className="field">
                  <span>开始日期</span>
                  <input
                    type="date"
                    value={financeStartDate}
                    onChange={(e) => setFinanceStartDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>结束日期</span>
                  <input
                    type="date"
                    value={financeEndDate}
                    onChange={(e) => setFinanceEndDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>类型</span>
                  <select
                    value={financeType}
                    onChange={(e) => setFinanceType(e.target.value as any)}
                  >
                    <option value="all">全部</option>
                    <option value="income">仅收入</option>
                    <option value="expense">仅支出</option>
                  </select>
                </label>
              </div>

              <div className="action-buttons">
                <button
                  className="primary-button"
                  onClick={handleFinanceExport}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={16} /> 导出中...
                    </>
                  ) : (
                    <>
                      <Download size={16} /> 导出交易数据
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ========== 财务导入 ========== */}
        {activeTab === "finance-import" && (
          <section className="card">
            <div className="card-header">
              <h3>
                <Upload size={20} /> 财务交易导入
              </h3>
            </div>
            <div className="card-body">
              <p>
                从 CSV/Excel 文件批量导入财务交易。<strong>支持自动新建客户</strong>（如果 Excel 中的客户编号/名称在系统中不存在）。
              </p>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={autoCreateCustomers}
                  onChange={(e) => setAutoCreateCustomers(e.target.checked)}
                />
                自动创建不存在的客户（标 tag "Excel导入"）
              </label>

              <input
                ref={financeFileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files?.[0] && handleFinanceImport(e.target.files[0])}
                style={{ display: "none" }}
              />
              <div className="action-buttons">
                <button
                  className="ghost-button"
                  onClick={downloadTransactionTemplate}
                  disabled={busy}
                >
                  <FileText size={14} /> 下载模板
                </button>
                <button
                  className="primary-button"
                  onClick={() => financeFileRef.current?.click()}
                  disabled={busy}
                >
                  <Upload size={16} /> 选择文件导入
                </button>
              </div>

              {financeResult && (
                <div className="import-result">
                  <h4>
                    <CheckCircle2 size={18} /> 导入完成
                  </h4>
                  <div className="result-stats">
                    <span><strong>{financeResult.total}</strong> 总行数</span>
                    <span style={{ color: "#059669" }}>
                      <strong>{financeResult.imported}</strong> 交易
                    </span>
                    <span style={{ color: "#8b5cf6" }}>
                      <strong>{financeResult.newCustomers}</strong> 新建客户
                    </span>
                    <span style={{ color: "#94a3b8" }}>
                      <strong>{financeResult.skipped}</strong> 跳过
                    </span>
                    <span style={{ color: "#dc2626" }}>
                      <strong>{financeResult.failed}</strong> 失败
                    </span>
                  </div>
                  {financeResult.errors.length > 0 && (
                    <details>
                      <summary>失败详情（{financeResult.errors.length}）</summary>
                      <ul>
                        {financeResult.errors.slice(0, 20).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}