/**
 * V2.0 财务交易 Excel 批量导入
 *
 * 流程：
 * 1. 上传 Excel/CSV → 解析为交易行
 * 2. 智能匹配客户（按公司名模糊匹配）
 * 3. 未匹配 → 显示"将新建客户"标识
 * 4. 用户确认 → 批量创建客户 + 批量创建交易
 *
 * 支持字段（按优先级自动识别列名）：
 * - 日期/date
 * - 类型/income|expense|收入|支出
 * - 分类/category
 * - 金额/amount
 * - 客户名/customer
 * - 项目/project
 * - 描述/description/note
 */

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { X, Upload, LoaderCircle, CheckCircle2, AlertTriangle, Save } from "lucide-react";
import { api } from "../lib/api";

interface ExcelImportProps {
  onClose: () => void;
  onSuccess: () => void;
}

/** 解析后的单行交易 */
interface ParsedRow {
  /** 原始行号 */
  rowIndex: number;
  /** 日期 YYYY-MM-DD */
  transDate: string;
  /** 类型 */
  type: "income" | "expense";
  /** 分类 */
  category: string;
  /** 金额 */
  amount: number;
  /** 客户名（Excel 原值）*/
  customerName: string;
  /** 项目编号（Excel 原值）*/
  projectCode: string;
  /** 描述 */
  description: string;
}

interface CustomerMatch {
  customerName: string;
  matched: boolean;
  customerId?: string;
  customerCode?: string;
  /** 匹配得分（0-1）*/
  score: number;
}

interface ImportSummary {
  total: number;
  matched: number;
  newCustomers: number;
  imported: number;
  failed: number;
  errors: string[];
}

export function ExcelImport({ onClose, onSuccess }: ExcelImportProps) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [matches, setMatches] = useState<Record<number, CustomerMatch>>({});
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; customerCode: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [filename, setFilename] = useState("");

  // 加载现有客户列表（用于匹配）
  useEffect(() => {
    api.listCustomers({ limit: 500 }).then((res: any) => {
      const arr = Array.isArray(res) ? res : (res?.data?.items || res?.data || []);
      setCustomers(arr);
    }).catch(() => setCustomers([]));
  }, []);

  /** 解析 Excel/CSV 文件 */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setFilename(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (raw.length < 2) {
        setError("文件内容为空或只有标题行");
        return;
      }

      // 自动识别表头
      const headers = raw[0].map((h: any) => String(h).trim().toLowerCase());
      const idx = {
        date: findHeader(headers, ["日期", "date", "交易日期", "trans_date", "transDate"]),
        type: findHeader(headers, ["类型", "type", "收支", "收入/支出"]),
        category: findHeader(headers, ["分类", "category", "类目"]),
        amount: findHeader(headers, ["金额", "amount", "收入金额", "支出金额"]),
        customer: findHeader(headers, ["客户", "客户名", "customer", "客户名称"]),
        project: findHeader(headers, ["项目", "项目编号", "project", "项目代码"]),
        description: findHeader(headers, ["描述", "备注", "说明", "description", "note"]),
      };

      const missing = Object.entries(idx).filter(([_, v]) => v === -1).map(([k]) => k);
      if (missing.length > 2) {
        setError(`缺少关键列：${missing.join("、")}。请确保 Excel 包含日期、类型、金额列。`);
        return;
      }

      // 解析数据行
      const parsed: ParsedRow[] = [];
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i];
        if (!row || row.every((c) => !c)) continue;

        const dateVal = idx.date >= 0 ? parseDate(row[idx.date]) : "";
        const typeVal = idx.type >= 0 ? parseType(row[idx.type]) : "income";
        const amountVal = idx.amount >= 0 ? parseAmount(row[idx.amount]) : 0;
        if (!dateVal || amountVal <= 0) continue; // 跳过无效行

        parsed.push({
          rowIndex: i,
          transDate: dateVal,
          type: typeVal,
          category: idx.category >= 0 ? String(row[idx.category] || "其他").trim() : "其他",
          amount: amountVal,
          customerName: idx.customer >= 0 ? String(row[idx.customer] || "").trim() : "",
          projectCode: idx.project >= 0 ? String(row[idx.project] || "").trim() : "",
          description: idx.description >= 0 ? String(row[idx.description] || "").trim() : ""
        });
      }

      if (parsed.length === 0) {
        setError("没有解析到有效数据行");
        return;
      }

      setRows(parsed);
      // 自动匹配客户
      matchCustomers(parsed);
      setStep("preview");
    } catch (err: any) {
      setError(`解析失败：${err?.message ?? "未知错误"}`);
    }
  };

  /** 智能客户匹配 */
  const matchCustomers = (rowsToMatch: ParsedRow[]) => {
    const result: Record<number, CustomerMatch> = {};
    for (const row of rowsToMatch) {
      if (!row.customerName) {
        result[row.rowIndex] = { customerName: "", matched: false, score: 0 };
        continue;
      }
      // 模糊匹配：去括号、空格、关键词包含
      const cleaned = row.customerName.replace(/[（()）\s（宁夏）有限公司]+/g, "").toLowerCase();
      let best: { id: string; name: string; customerCode: string; score: number } | null = null;

      for (const c of customers) {
        const cName = c.name.replace(/[（()）\s（宁夏）有限公司]+/g, "").toLowerCase();
        let score = 0;
        // 完全相同
        if (cName === cleaned) score = 1;
        // 互相包含
        else if (cName.includes(cleaned) || cleaned.includes(cName)) {
          score = Math.min(cleaned.length, cName.length) / Math.max(cleaned.length, cName.length);
        }
        // 前缀匹配
        else if (cName.slice(0, 4) === cleaned.slice(0, 4) && cleaned.length >= 4) {
          score = 0.6;
        }

        if (!best || score > best.score) {
          best = { id: c.id, name: c.name, customerCode: c.customerCode, score };
        }
      }

      result[row.rowIndex] = {
        customerName: row.customerName,
        matched: best !== null && best.score >= 0.7,
        customerId: best?.id,
        customerCode: best?.customerCode,
        score: best?.score ?? 0
      };
    }
    setMatches(result);
  };

  /** 确认导入 */
  const handleImport = async () => {
    setSubmitting(true);
    setError("");

    const summary: ImportSummary = {
      total: rows.length,
      matched: 0,
      newCustomers: 0,
      imported: 0,
      failed: 0,
      errors: []
    };

    try {
      // 1. 为未匹配的客户创建客户记录
      const newCustomerCache: Record<string, string> = {};
      for (const row of rows) {
        if (!row.customerName) continue;
        const m = matches[row.rowIndex];
        if (!m || !m.matched) {
          if (newCustomerCache[row.customerName]) continue;
          try {
            const code = `CUST-IMP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
            const created: any = await api.createCustomer({
              customerCode: code,
              name: row.customerName,
              industry: null,
              tags: ["Excel导入"],
              status: "active"
            });
            const newId = created?.data?.id ?? created?.id;
            newCustomerCache[row.customerName] = newId;
            summary.newCustomers++;
          } catch (err: any) {
            summary.errors.push(`创建客户 "${row.customerName}" 失败：${err?.message}`);
            summary.failed++;
          }
        }
      }

      // 2. 批量创建交易
      for (const row of rows) {
        try {
          const m = matches[row.rowIndex];
          let customerId: string | null = m?.customerId || null;
          if (!customerId && row.customerName && newCustomerCache[row.customerName]) {
            customerId = newCustomerCache[row.customerName];
          }
          if (m?.matched) summary.matched++;

          await api.createTransaction({
            type: row.type,
            transDate: row.transDate,
            category: row.category || "其他",
            amount: row.amount,
            description: row.description || (row.projectCode ? `项目 ${row.projectCode}` : ""),
            customerId,
            projectId: null  // 项目暂时跳过（需要额外映射）
          });
          summary.imported++;
        } catch (err: any) {
          summary.errors.push(`第 ${row.rowIndex} 行 "${row.description || row.category}" 失败：${err?.message}`);
          summary.failed++;
        }
      }

      setSummary(summary);
      setStep("done");
      if (summary.imported > 0) onSuccess();
    } catch (err: any) {
      setError(`导入失败：${err?.message ?? "未知错误"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const matchedCount = Object.values(matches).filter((m) => m.matched).length;
  const newCustomerCount = rows.filter((r) => r.customerName && !matches[r.rowIndex]?.matched).length;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal excel-import-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>📊 批量导入交易（Excel/CSV）</h3>
          <button className="ghost-icon" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body excel-import-body">
          {error && <div className="error-banner">{error}</div>}

          {/* Step 1: 上传 */}
          {step === "upload" && (
            <div className="upload-step">
              <label className="file-drop" htmlFor="excel-file">
                <Upload size={48} />
                <strong>选择 Excel/CSV 文件</strong>
                <span>支持 .xlsx / .xls / .csv 格式</span>
                <small>需包含列：日期、类型、金额（建议包含：客户、分类、描述）</small>
                <input
                  id="excel-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  style={{ display: "none" }}
                />
              </label>

              <div className="excel-format-hint">
                <h4>📋 字段自动识别</h4>
                <ul>
                  <li><strong>日期</strong>：日期、date、交易日期（YYYY-MM-DD 或 Excel 日期格式）</li>
                  <li><strong>类型</strong>：类型、收支（收入/income / 支出/expense）</li>
                  <li><strong>分类</strong>：分类、category、类目</li>
                  <li><strong>金额</strong>：金额、amount、收入金额、支出金额</li>
                  <li><strong>客户</strong>：客户、客户名、customer、客户名称</li>
                  <li><strong>项目</strong>：项目、项目编号、project</li>
                  <li><strong>描述</strong>：描述、备注、说明、description</li>
                </ul>
                <div className="format-tip">
                  💡 <strong>提示</strong>：智能客户匹配阈值 70%；低于该阈值会标记"将新建"。
                  未匹配客户可选择自动创建（带 tag "Excel导入"）。
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 预览 */}
          {step === "preview" && (
            <div className="preview-step">
              <div className="preview-summary">
                <span className="preview-stat">
                  <strong>{rows.length}</strong> 条记录
                </span>
                <span className="preview-stat success">
                  ✓ {matchedCount} 个客户已匹配
                </span>
                <span className="preview-stat warn">
                  + {newCustomerCount} 个客户将新建
                </span>
                <span className="preview-stat income">
                  ↗ {rows.filter((r) => r.type === "income").length} 笔收入
                </span>
                <span className="preview-stat expense">
                  ↘ {rows.filter((r) => r.type === "expense").length} 笔支出
                </span>
                <span className="preview-stat amount">
                  ¥{rows.reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0).toLocaleString()} 净额
                </span>
                <span className="filename">
                  📄 {filename}
                </span>
              </div>

              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>日期</th>
                      <th>类型</th>
                      <th>分类</th>
                      <th>金额</th>
                      <th>客户</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r) => {
                      const m = matches[r.rowIndex];
                      return (
                        <tr key={r.rowIndex} className={m?.matched ? "" : "row-new"}>
                          <td>{r.rowIndex}</td>
                          <td>{r.transDate}</td>
                          <td>
                            <span className={`status-pill status-${r.type === "income" ? "active" : "inactive"}`}>
                              {r.type === "income" ? "收入" : "支出"}
                            </span>
                          </td>
                          <td>{r.category}</td>
                          <td className="amount">
                            {r.type === "income" ? "+" : "-"}¥{r.amount.toLocaleString()}
                          </td>
                          <td>{r.customerName || "—"}</td>
                          <td>
                            {m?.matched ? (
                              <span className="match-tag match">
                                ✓ {m.customerCode}
                              </span>
                            ) : r.customerName ? (
                              <span className="match-tag new">+ 新建</span>
                            ) : (
                              <span className="match-tag none">未关联</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > 100 && (
                  <p className="muted small">... 还有 {rows.length - 100} 行</p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: 完成 */}
          {step === "done" && summary && (
            <div className="done-step">
              <div className="done-icon success">
                <CheckCircle2 size={64} />
              </div>
              <h3>导入完成</h3>
              <div className="done-stats">
                <div><strong>{summary.total}</strong> 条总数</div>
                <div><strong style={{ color: "#059669" }}>{summary.imported}</strong> 导入成功</div>
                <div><strong style={{ color: "#dc2626" }}>{summary.failed}</strong> 失败</div>
                <div><strong style={{ color: "#8b5cf6" }}>{summary.newCustomers}</strong> 新建客户</div>
                <div><strong style={{ color: "#10b981" }}>{summary.matched}</strong> 匹配已有客户</div>
              </div>
              {summary.errors.length > 0 && (
                <details className="error-details">
                  <summary>查看失败详情（{summary.errors.length}）</summary>
                  <ul>
                    {summary.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          {step === "preview" && (
            <>
              <span className="muted small">
                ⚠️ 将创建 {newCustomerCount} 个新客户 + {rows.length} 条交易
              </span>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setStep("upload")}>
                  重新选择
                </button>
                <button
                  className="primary-button"
                  onClick={handleImport}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      导入中...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      确认导入 ({rows.length} 条)
                    </>
                  )}
                </button>
              </div>
            </>
          )}
          {step === "done" && (
            <button className="primary-button" onClick={onClose}>
              关闭
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ================== 工具函数 ==================

/** 查找列索引（容错匹配）*/
function findHeader(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h === c.toLowerCase() || h.includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 解析日期为 YYYY-MM-DD */
function parseDate(value: any): string {
  if (!value) return "";
  // Excel 数字（日期序列号）
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const str = String(value).trim();
  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  // MM/DD/YYYY
  const m2 = str.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (m2) {
    return `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  }
  // 尝试 Date 解析
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return "";
}

/** 解析类型 */
function parseType(value: any): "income" | "expense" {
  const str = String(value).trim().toLowerCase();
  if (str.includes("支出") || str.includes("expense") || str === "支出" || str === "-" || str === "out") return "expense";
  return "income";
}

/** 解析金额 */
function parseAmount(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return Math.abs(value);
  const str = String(value).replace(/[¥,\s元￥]/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}