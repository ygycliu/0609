/**
 * V2.0 数据导出导入工具
 *
 * 支持：
 * 1. 客户导出/导入（CSV）
 * 2. 财务交易导出/导入（CSV）
 * 3. 批量调用 API
 */

import * as XLSX from "xlsx";
import { api } from "./api";

/** UTF-8 BOM（Excel 识别中文）*/
const UTF8_BOM = "\uFEFF";

/** 转义 CSV 字段 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
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
  const lines = [headers.map(escapeCSV).join(","), ...rows.map((row) => row.map(escapeCSV).join(","))];
  return UTF8_BOM + lines.join("\r\n");
}

/** 触发文件下载 */
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

// ============================================================
// 客户导出/导入
// ============================================================

/** 客户 CSV 导出（拉全部 500+）*/
export async function exportCustomersCSV(): Promise<number> {
  // 分页拉全部
  const all: any[] = [];
  let offset = 0;
  const limit = 200;
  while (true) {
    const res = await api.listCustomers({ limit, offset });
    const arr = res?.data ?? [];
    all.push(...arr);
    if (arr.length < limit) break;
    offset += limit;
    if (offset > 5000) break;
  }

  const headers = [
    "客户编号", "客户名称", "行业", "员工人数", "地区",
    "联系人", "联系电话", "邮箱", "地址", "状态", "标签",
    "来源", "创建时间", "更新时间", "备注"
  ];

  const rows = all.map((c: any) => [
    c.customerCode ?? c.customer_code ?? "",
    c.name ?? "",
    c.industry ?? "",
    c.employeeCount ?? c.employee_count ?? "",
    c.region ?? "",
    c.contactPerson ?? c.contact_person ?? "",
    c.contactPhone ?? c.contact_phone ?? "",
    c.contactEmail ?? c.contact_email ?? "",
    c.address ?? "",
    c.status ?? "active",
    Array.isArray(c.tags) ? c.tags.join(";") : (c.tags ?? ""),
    c.source ?? "",
    c.createdAt ?? c.created_at ?? "",
    c.updatedAt ?? c.updated_at ?? "",
    c.notes ?? ""
  ]);

  const date = new Date().toISOString().slice(0, 10);
  const csv = generateCSV(headers, rows);
  downloadFile(csv, `客户数据-${date}.csv`);
  return all.length;
}

/** 客户 CSV 导入结果 */
export interface CustomerImportResult {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** 客户 CSV 导入 */
export async function importCustomersCSV(
  file: File,
  options: { mode: "create" | "upsert"; onProgress?: (current: number, total: number) => void } = { mode: "create" }
): Promise<CustomerImportResult> {
  const result: CustomerImportResult = {
    total: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 2) throw new Error("文件无数据");

  // 找表头
  const headers = raw[0].map((h: any) => String(h).trim().toLowerCase());
  const idx = (name: string, candidates: string[]): number => {
    for (const c of candidates) {
      const i = headers.findIndex((h) => h === c.toLowerCase() || h.includes(c.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const colCode = idx("客户编号", ["客户编号", "customer_code", "customerCode", "编号"]);
  const colName = idx("客户名称", ["客户名称", "name", "客户名"]);
  const colIndustry = idx("行业", ["行业", "industry"]);
  const colEmployeeCount = idx("员工人数", ["员工人数", "employee_count", "employeeCount"]);
  const colRegion = idx("地区", ["地区", "region"]);
  const colContact = idx("联系人", ["联系人", "contact_person", "contactPerson"]);
  const colPhone = idx("联系电话", ["联系电话", "contact_phone", "contactPhone"]);
  const colEmail = idx("邮箱", ["邮箱", "contact_email", "contactEmail"]);
  const colAddress = idx("地址", ["地址", "address"]);
  const colStatus = idx("状态", ["状态", "status"]);
  const colTags = idx("标签", ["标签", "tags"]);
  const colNotes = idx("备注", ["备注", "notes"]);

  if (colName < 0) {
    throw new Error("缺少关键列：客户名称");
  }

  result.total = raw.length - 1;

  // 拉现有客户（用于 upsert 判断）
  const existing: Map<string, any> = new Map();
  if (options.mode === "upsert") {
    try {
      const list = await api.listCustomers({ limit: 500 });
      const arr = list?.data ?? [];
      arr.forEach((c: any) => {
        if (c.customerCode) existing.set(c.customerCode, c);
      });
    } catch {
      // 忽略
    }
  }

  // 逐行处理
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every((c) => !c)) continue;
    const name = String(row[colName] || "").trim();
    if (!name) {
      result.skipped++;
      continue;
    }

    options.onProgress?.(i, raw.length - 1);

    const payload: any = {
      customerCode: colCode >= 0 ? String(row[colCode] || "").trim() : `CUST-IMP-${Date.now().toString(36).toUpperCase().slice(-6)}-${i}`,
      name,
      industry: colIndustry >= 0 ? String(row[colIndustry] || "").trim() : "",
      employeeCount: colEmployeeCount >= 0 ? Number(row[colEmployeeCount]) || 0 : 0,
      region: colRegion >= 0 ? String(row[colRegion] || "").trim() : "",
      contactPerson: colContact >= 0 ? String(row[colContact] || "").trim() : "",
      contactPhone: colPhone >= 0 ? String(row[colPhone] || "").trim() : "",
      contactEmail: colEmail >= 0 ? String(row[colEmail] || "").trim() : "",
      address: colAddress >= 0 ? String(row[colAddress] || "").trim() : "",
      notes: colNotes >= 0 ? String(row[colNotes] || "").trim() : "",
      status: colStatus >= 0 && row[colStatus] ? String(row[colStatus]).trim() : "active",
      tags: colTags >= 0 && row[colTags] ? String(row[colTags]).split(/[,，;；]/).map((t: string) => t.trim()).filter(Boolean) : []
    };

    try {
      const isExisting = existing.has(payload.customerCode);
      if (isExisting && options.mode === "upsert") {
        await api.updateCustomer(existing.get(payload.customerCode)!.id, payload);
        result.updated++;
      } else if (isExisting && options.mode === "create") {
        result.skipped++;
      } else {
        await api.createCustomer(payload);
        result.imported++;
      }
    } catch (e: any) {
      result.failed++;
      result.errors.push(`第 ${i + 1} 行 "${name}" 失败：${e?.message ?? "未知错误"}`);
    }
  }

  return result;
}

// ============================================================
// 财务交易导出/导入
// ============================================================

/** 财务交易 CSV 导出（拉全部 1623+）*/
export async function exportFinanceTransactionsCSV(filters: {
  startDate: string;
  endDate: string;
  type?: "income" | "expense";
}): Promise<number> {
  const all: any[] = [];
  let offset = 0;
  const limit = 200;
  while (true) {
    const res = await api.listTransactions({
      type: filters.type,
      start_date: filters.startDate,
      end_date: filters.endDate,
      limit,
      offset
    });
    const arr = res?.data ?? [];
    all.push(...arr);
    if (arr.length < limit) break;
    offset += limit;
    if (offset > 50000) break; // 财务数据安全上限
  }

  const headers = [
    "日期", "类型", "客户编号", "客户名称", "项目编号",
    "分类", "金额", "描述", "创建时间"
  ];
  const rows = all.map((t: any) => [
    (t.transDate || t.transaction_date || t.trans_date || "").slice(0, 10),
    t.type === "income" ? "收入" : "支出",
    t.customerCode ?? t.customer_code ?? "",
    t.customerName ?? t.customer_name ?? "",
    t.projectCode ?? t.project_code ?? "",
    t.category ?? "",
    Number(t.amount ?? 0),
    t.description ?? t.note ?? "",
    t.createdAt ?? t.created_at ?? ""
  ]);

  const date = new Date().toISOString().slice(0, 10);
  const csv = generateCSV(headers, rows);
  downloadFile(csv, `财务交易-${filters.startDate}_${filters.endDate}-${date}.csv`);
  return all.length;
}

/** 财务交易 CSV 导入结果 */
export interface TransactionImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
  newCustomers: number;
}

/** 财务交易 CSV 导入 */
export async function importFinanceTransactionsCSV(
  file: File,
  options: { autoCreateCustomers?: boolean; onProgress?: (current: number, total: number) => void } = {}
): Promise<TransactionImportResult> {
  const result: TransactionImportResult = {
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    newCustomers: 0
  };

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 2) throw new Error("文件无数据");

  const headers = raw[0].map((h: any) => String(h).trim().toLowerCase());
  const findCol = (candidates: string[]) => {
    for (const c of candidates) {
      const i = headers.findIndex((h) => h === c.toLowerCase() || h.includes(c.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  const colDate = findCol(["日期", "transDate", "trans_date"]);
  const colType = findCol(["类型", "type"]);
  const colCustCode = findCol(["客户编号", "customerCode", "customer_code"]);
  const colCustName = findCol(["客户名称", "customerName", "customer_name", "客户"]);
  const colProjCode = findCol(["项目编号", "projectCode", "project_code"]);
  const colCategory = findCol(["分类", "category"]);
  const colAmount = findCol(["金额", "amount"]);
  const colDescription = findCol(["描述", "description", "备注", "note"]);

  if (colDate < 0 || colAmount < 0) {
    throw new Error("缺少关键列：日期、金额");
  }

  result.total = raw.length - 1;

  // 拉所有客户（按编号或名称匹配）
  const customersByCode = new Map<string, any>();
  const customersByName = new Map<string, any>();
  try {
    const list = await api.listCustomers({ limit: 500 });
    const arr = list?.data ?? [];
    arr.forEach((c: any) => {
      if (c.customerCode) customersByCode.set(c.customerCode, c);
      if (c.name) customersByName.set(c.name, c);
    });
  } catch {
    // ignore
  }

  // 缓存新建的客户
  const newCustomerCache = new Map<string, string>(); // name -> id

  const parseDate = (val: any): string => {
    if (typeof val === "number") {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    const str = String(val).trim();
    const m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return "";
  };

  const parseType = (val: any): "income" | "expense" => {
    const str = String(val).trim().toLowerCase();
    if (str.includes("支出") || str.includes("expense") || str === "out" || str === "-") return "expense";
    return "income";
  };

  const parseAmount = (val: any): number => {
    if (typeof val === "number") return Math.abs(val);
    const str = String(val).replace(/[¥,\s元￥]/g, "").trim();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : Math.abs(num);
  };

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.every((c) => !c)) continue;

    const transDate = parseDate(row[colDate]);
    const amount = parseAmount(row[colAmount]);
    if (!transDate || amount <= 0) {
      result.skipped++;
      continue;
    }

    options.onProgress?.(i, raw.length - 1);

    // 匹配客户
    let customerId: string | null = null;
    const custCode = colCustCode >= 0 ? String(row[colCustCode] || "").trim() : "";
    const custName = colCustName >= 0 ? String(row[colCustName] || "").trim() : "";

    if (custCode && customersByCode.has(custCode)) {
      customerId = customersByCode.get(custCode).id;
    } else if (custName && customersByName.has(custName)) {
      customerId = customersByName.get(custName).id;
    } else if (custName && options.autoCreateCustomers) {
      // 自动创建客户
      if (newCustomerCache.has(custName)) {
        customerId = newCustomerCache.get(custName)!;
      } else {
        try {
          const code = `CUST-IMP-${Date.now().toString(36).toUpperCase().slice(-6)}-${i}`;
          const created: any = await api.createCustomer({
            customerCode: code,
            name: custName,
            tags: ["Excel导入"],
            status: "active"
          });
          const newId = created?.data?.id ?? created?.id;
          newCustomerCache.set(custName, newId);
          customerId = newId;
          result.newCustomers++;
        } catch (e: any) {
          result.errors.push(`第 ${i + 1} 行自动创建客户 "${custName}" 失败：${e?.message ?? "未知"}`);
        }
      }
    }

    const projectCode = colProjCode >= 0 ? String(row[colProjCode] || "").trim() : "";
    const description = colDescription >= 0 ? String(row[colDescription] || "").trim() : (projectCode ? `项目 ${projectCode}` : "");

    try {
      await api.createTransaction({
        type: colType >= 0 ? parseType(row[colType]) : "income",
        transDate,
        category: colCategory >= 0 ? String(row[colCategory] || "其他").trim() : "其他",
        amount,
        description,
        customerId,
        projectId: null  // 项目映射暂时跳过
      });
      result.imported++;
    } catch (e: any) {
      result.failed++;
      result.errors.push(`第 ${i + 1} 行 "${description}" 失败：${e?.message ?? "未知错误"}`);
    }
  }

  return result;
}

// ============================================================
// 模板生成（让用户先下载模板，再填数据）
// ============================================================

/** 下载客户导入模板 */
export function downloadCustomerTemplate() {
  const headers = ["客户编号", "客户名称", "行业", "员工人数", "地区", "联系人", "联系电话", "邮箱", "地址", "状态", "标签", "备注"];
  const example = [
    "CUST-001", "示例公司（宁夏）有限公司", "制造业", "100", "宁夏银川", "张三", "13800000000", "zhangsan@example.com", "宁夏银川市...", "active", "VIP;客户", "示例备注"
  ];
  downloadFile(generateCSV(headers, [example]), "客户导入模板.csv");
}

/** 下载财务交易模板 */
export function downloadTransactionTemplate() {
  const headers = ["日期", "类型", "客户编号", "客户名称", "项目编号", "分类", "金额", "描述"];
  const example = [
    "2026-01-15", "收入", "CUST-001", "示例公司（宁夏）有限公司", "PRJ-000529", "认证费收入", "15000", "QES 三体系初次认证"
  ];
  downloadFile(generateCSV(headers, [example]), "财务交易导入模板.csv");
}