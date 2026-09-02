/**
 * V2.2 客户匹配算法 - 智能找客户
 * 用于 PDF 导入/发票/邮件等场景下，匹配合同上的客户名到 customer 表
 */
import { query } from "../db/pool.js";

export interface MatchResult {
  customer: { id: string; name: string } | null;
  matchType: "exact" | "alias" | "fuzzy" | "substring" | null;
  confidence: number; // 0-1
  matchedVia?: string; // "name" | "alias" | "short_name"
}

/**
 * 标准化客户名（去除空格、括号、有限公司等）
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[\s（）()「」【】《》·,，:：]/g, "")
    .replace(/有限公司/g, "")
    .replace(/有限责任公司/g, "")
    .replace(/股份/g, "")
    .replace(/集团/g, "")
    .toLowerCase();
}

/**
 * 匹配客户
 */
export async function findCustomerByName(
  companyId: string,
  rawName: string | null
): Promise<MatchResult> {
  if (!rawName || rawName.trim().length === 0) {
    return { customer: null, matchType: null, confidence: 0 };
  }

  const name = rawName.trim();

  // 1. 完全匹配
  const exact = await query<any>(
    `SELECT id, name FROM customer
     WHERE company_id = $1 AND deleted_at IS NULL
       AND (LOWER(name) = LOWER($2) OR name = $2)
     LIMIT 1`,
    [companyId, name]
  );
  if (exact.rows.length > 0) {
    return { customer: exact.rows[0], matchType: "exact", confidence: 1.0 };
  }

  // 2. 别名匹配（customer_alias 表）
  const alias = await query<any>(
    `SELECT ca.customer_id, ca.alias_name, cu.name
     FROM customer_alias ca
     JOIN customer cu ON cu.id = ca.customer_id AND cu.deleted_at IS NULL
     WHERE ca.company_id = $1 AND LOWER(ca.alias_name) = LOWER($2)
     LIMIT 1`,
    [companyId, name]
  );
  if (alias.rows.length > 0) {
    return {
      customer: { id: alias.rows[0].customer_id, name: alias.rows[0].name },
      matchType: "alias",
      confidence: 0.95,
      matchedVia: "alias"
    };
  }

  // 3. 标准化后匹配
  const norm = normalizeName(name);
  if (norm.length < 3) return { customer: null, matchType: null, confidence: 0 };

  const allCustomers = await query<any>(
    `SELECT id, name FROM customer
     WHERE company_id = $1 AND deleted_at IS NULL
       AND LENGTH(name) >= $2`,
    [companyId, norm.length - 2] // 长度相近
  );
  for (const c of allCustomers.rows) {
    const cn = normalizeName(c.name);
    if (cn === norm) {
      return { customer: c, matchType: "fuzzy", confidence: 0.9 };
    }
  }

  // 4. 子串匹配（双向包含）
  for (const c of allCustomers.rows) {
    const cn = normalizeName(c.name);
    if (cn.length >= 3 && (cn.includes(norm) || norm.includes(cn))) {
      // 子串匹配置信度低一些（避免误匹配）
      const confidence = 0.7;
      return { customer: c, matchType: "substring", confidence, matchedVia: "short_name" };
    }
  }

  // 5. 模糊匹配（Levenshtein 或 LIKE）
  for (const c of allCustomers.rows) {
    if (c.name.includes(name) || name.includes(c.name)) {
      const confidence = 0.6;
      return { customer: c, matchType: "substring", confidence };
    }
  }

  // 6. 没匹配
  return { customer: null, matchType: null, confidence: 0 };
}

/**
 * 批量匹配（用于批量导入）
 */
export async function batchMatchCustomers(
  companyId: string,
  names: string[]
): Promise<Map<string, MatchResult>> {
  const result = new Map<string, MatchResult>();
  for (const name of names) {
    const m = await findCustomerByName(companyId, name);
    result.set(name, m);
  }
  return result;
}

/**
 * 从合同反向补全客户信息
 * 已知 customer_id，根据已有合同回填缺失字段
 */
export async function enrichCustomerFromContracts(companyId: string, customerId: string): Promise<{
  updated: string[];
  hints: Record<string, any>;
}> {
  const updated: string[] = [];
  const hints: Record<string, any> = {};

  // 1. 收集所有该客户的合同
  const contracts = await query<any>(
    `SELECT bank_name, bank_account, bank_holder, contact_person, contact_phone,
            certification_types, signed_at
     FROM contract
     WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL
     ORDER BY signed_at DESC`,
    [companyId, customerId]
  );

  if (contracts.rows.length === 0) {
    return { updated, hints };
  }

  // 2. 看客户当前缺失什么
  const customer = await query<any>(
    `SELECT * FROM customer WHERE id = $1`,
    [customerId]
  );
  if (customer.rows.length === 0) return { updated, hints };
  const cu = customer.rows[0];

  // 3. 联系人/电话（用最新合同的）
  if (!cu.contact_person && contracts.rows[0].contact_person) {
    await query(
      `UPDATE customer SET contact_person = $2, updated_at = NOW() WHERE id = $1`,
      [customerId, contracts.rows[0].contact_person]
    );
    updated.push(`contact_person = "${contracts.rows[0].contact_person}"`);
  }
  if (!cu.contact_phone && contracts.rows[0].contact_phone) {
    await query(
      `UPDATE customer SET contact_phone = $2, updated_at = NOW() WHERE id = $1`,
      [customerId, contracts.rows[0].contact_phone]
    );
    updated.push(`contact_phone = "${contracts.rows[0].contact_phone}"`);
  }

  // 4. 银行信息（用最新合同的）
  if (!cu.bank_name && contracts.rows[0].bank_name) {
    await query(
      `UPDATE customer SET bank_name = $2, updated_at = NOW() WHERE id = $1`,
      [customerId, contracts.rows[0].bank_name]
    );
    updated.push(`bank_name = "${contracts.rows[0].bank_name}"`);
  }

  // 5. 行业（根据认证体系推断）
  if (!cu.industry) {
    const allTypes = new Set<string>();
    contracts.rows.forEach((c: any) => (c.certification_types || []).forEach((t: string) => allTypes.add(t)));
    if (allTypes.size > 0) {
      const industries = [];
      if (allTypes.has("HACCP") || allTypes.has("FSS")) industries.push("食品");
      if (allTypes.has("OHSMS")) industries.push("安全");
      if (allTypes.has("QMS")) industries.push("制造");
      if (allTypes.has("ISMS")) industries.push("IT");
      const guessed = industries[0] || "通用";
      await query(
        `UPDATE customer SET industry = $2, updated_at = NOW() WHERE id = $1`,
        [customerId, guessed]
      );
      updated.push(`industry = "${guessed}"（从认证体系推断）`);
    }
  }

  // 6. Notes 汇总
  const contractSummary = contracts.rows.length + " 份合同";
  hints.contractCount = contracts.rows.length;
  hints.contracts = contracts.rows.map((c: any) => ({
    bank: c.bank_name,
    amount: c.contract_amount,
    signed: c.signed_at
  }));

  return { updated, hints };
}