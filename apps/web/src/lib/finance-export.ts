/**
 * V2.0 财务导出工具
 *
 * - CSV（前端生成，无需后端）
 * - Excel（CSV 格式 .xls/.xlsx 都支持，Excel 自动识别 CSV）
 * - PDF（后端生成 PDFKit）
 */

/** 客户收支汇总 */
interface CustomerSummary {
  customerId: string;
  customerName: string | null;
  total: number;
}

/** 类目收支汇总 */
interface CategorySummary {
  category: string;
  total: number;
  count: number;
}

/** UTF-8 BOM（让 Excel 正确识别中文）*/
const UTF8_BOM = "\uFEFF";

/** 转义 CSV 字段 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // 包含逗号、引号、换行的需要引号包裹
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 生成 CSV 内容 */
export function generateCSV(
  headers: string[],
  rows: Array<Array<any>>
): string {
  const lines = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(","));
  }
  return UTF8_BOM + lines.join("\r\n");
}

/** 触发下载 */
export function downloadFile(content: string, filename: string, mimeType: string = "text/csv") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 财务汇总导出（CSV 格式）*/
export function exportFinanceSummary(
  summary: {
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
    incomeByCategory: CategorySummary[];
    expenseByCategory: CategorySummary[];
    incomeByCustomer: CustomerSummary[];
    expenseByCustomer: CustomerSummary[];
  },
  period: { start: string; end: string }
): void {
  const filename = `财务汇总-${period.start}_${period.end}.csv`;

  // Sheet 1：财务总览
  const overviewRows = [
    ["指标", "金额（元）"],
    ["总收入", summary.totalIncome],
    ["总支出", summary.totalExpense],
    ["净利润", summary.netProfit],
    ["利润率", summary.totalIncome > 0
      ? `${((summary.netProfit / summary.totalIncome) * 100).toFixed(2)}%`
      : "0%"]
  ];

  // Sheet 2：收入分类
  const incomeByCategoryRows = summary.incomeByCategory.map((c) => [
    c.category, c.count, c.total
  ]);

  // Sheet 3：支出分类
  const expenseByCategoryRows = summary.expenseByCategory.map((c) => [
    c.category, c.count, c.total
  ]);

  // Sheet 4：客户收支
  const customerRows = new Map<string, { name: string; income: number; expense: number }>();
  for (const c of summary.incomeByCustomer) {
    customerRows.set(c.customerId, {
      name: c.customerName ?? "未关联",
      income: c.total,
      expense: 0
    });
  }
  for (const c of summary.expenseByCustomer) {
    const existing = customerRows.get(c.customerId);
    if (existing) {
      existing.expense = c.total;
    } else {
      customerRows.set(c.customerId, {
        name: c.customerName ?? "未关联",
        income: 0,
        expense: c.total
      });
    }
  }

  const customerRowsArr = Array.from(customerRows.values()).map((c) => [
    c.name, c.income, c.expense, c.income - c.expense
  ]);

  // 合并所有 sheet（用空行+分隔符）
  const allLines: string[] = [];
  allLines.push(generateCSV(["指标", "金额"], overviewRows).replace(UTF8_BOM, ""));
  allLines.push("");
  allLines.push("=== 收入分类 ===");
  allLines.push(generateCSV(["分类", "笔数", "金额"], incomeByCategoryRows).replace(UTF8_BOM, ""));
  allLines.push("");
  allLines.push("=== 支出分类 ===");
  allLines.push(generateCSV(["分类", "笔数", "金额"], expenseByCategoryRows).replace(UTF8_BOM, ""));
  allLines.push("");
  allLines.push("=== 客户收支 ===");
  allLines.push(generateCSV(["客户", "收入", "支出", "净额"], customerRowsArr).replace(UTF8_BOM, ""));

  const fullCSV = UTF8_BOM + allLines.join("\r\n");
  downloadFile(fullCSV, filename);
}

/** 交易明细导出 */
export function exportTransactions(
  transactions: any[],
  period: { start: string; end: string }
): void {
  const filename = `交易明细-${period.start}_${period.end}.csv`;
  const headers = ["日期", "类型", "客户", "类目", "金额", "说明", "项目"];
  const rows = transactions.map((tx) => [
    (tx.transactionDate || tx.transaction_date || tx.createdAt || tx.created_at || "").slice(0, 10),
    tx.type === "income" ? "收入" : "支出",
    tx.customerName || tx.customer_name || "未关联",
    tx.category || "",
    Number(tx.amount ?? 0),
    tx.description || tx.note || "",
    tx.projectName || tx.project_name || ""
  ]);
  const csv = generateCSV(headers, rows);
  downloadFile(csv, filename);
}