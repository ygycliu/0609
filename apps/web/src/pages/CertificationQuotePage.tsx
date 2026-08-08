import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Check,
  ChevronRight,
  Download,
  FileDown,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import { api } from "../lib/api";
import type {
  CertificationOption,
  CertificationQuote
} from "../types";

/** 推荐组合（按企业类型） */
const RECOMMENDATIONS: Record<
  string,
  Array<{ name: string; certIds: string[]; highlight?: string }>
> = {
  制造业: [
    { name: "QES 三体系（最常见）", certIds: ["QES"] },
    { name: "QES + 能源管理", certIds: ["QES", "能源"] },
    { name: "QES + 碳管理", certIds: ["QES", "碳管理"] }
  ],
  食品: [
    { name: "HACCP 食品安全", certIds: ["HACCP"] },
    { name: "HACCP + 商品售后", certIds: ["HACCP", "商品售后服务"] },
    { name: "ISO 22000 + GAP", certIds: ["食品安全管理", "GAP"] }
  ],
  IT: [
    { name: "27001 信息安全（首选）", certIds: ["27001"] },
    { name: "双信息（最高单价）", certIds: ["双信息"], highlight: "推荐" },
    { name: "QES + 27001", certIds: ["QES", "27001"] }
  ],
  物业: [
    { name: "商品售后认证", certIds: ["商品售后服务"] },
    { name: "QES + 商品售后", certIds: ["QES", "商品售后服务"] },
    { name: "餐饮服务", certIds: ["餐饮服务"] }
  ],
  化工: [
    { name: "QES + 能源管理", certIds: ["QES", "能源"] },
    { name: "QES + HSE", certIds: ["QES"] },
    { name: "能源 + 碳管理", certIds: ["能源", "碳管理"] }
  ]
};

/** 分类展示配置 */
const CATEGORY_META: Record<string, { icon: string; color: string; description: string }> = {
  通用: { icon: "📋", color: "#3b82f6", description: "通用基础三体系" },
  信息安全: { icon: "🔒", color: "#8b5cf6", description: "信息安全 / IT 服务" },
  食品: { icon: "🍱", color: "#f59e0b", description: "食品安全" },
  农业: { icon: "🌾", color: "#10b981", description: "良好农业规范" },
  服务: { icon: "🏪", color: "#06b6d4", description: "服务行业认证" },
  社会责任: { icon: "🤝", color: "#ec4899", description: "社会责任" },
  能源: { icon: "⚡", color: "#eab308", description: "能源管理" },
  碳: { icon: "🌱", color: "#22c55e", description: "碳管理 / 双碳" },
  供应链: { icon: "🔗", color: "#6366f1", description: "供应链管理" }
};

export function CertificationQuotePage() {
  const [options, setOptions] = useState<CertificationOption[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [riskLevels, setRiskLevels] = useState<{ value: "medium" | "high"; label: string }[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [employeeCount, setEmployeeCount] = useState<number>(100);
  const [riskLevel, setRiskLevel] = useState<"medium" | "high">("medium");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<CertificationQuote | null>(null);

  useEffect(() => {
    api
      .certificationOptions()
      .then((data) => {
        setIndustries(data.industries);
        setRiskLevels(data.riskLevels ?? []);
        setOptions(data.certifications);
        if (data.industries.length > 0) setIndustry(data.industries[0]);
      })
      .catch((caught) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  // 按 category 分组
  const grouped = useMemo(() => {
    const map = new Map<string, CertificationOption[]>();
    for (const cert of options) {
      if (!map.has(cert.category)) map.set(cert.category, []);
      map.get(cert.category)!.push(cert);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const order = ["通用", "信息安全", "食品", "农业", "服务", "社会责任", "能源", "碳", "供应链"];
      return order.indexOf(a) - order.indexOf(b);
    });
  }, [options]);

  // 推荐组合（按 industry 变）
  const recommendations = useMemo(() => {
    return RECOMMENDATIONS[industry] ?? [];
  }, [industry]);

  function toggleCert(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyRecommendation(certIds: string[]) {
    setSelected(new Set(certIds));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // 估算当前选中总价（按后端规则）
  const estimatedSubtotal = useMemo(() => {
    let total = 0;
    for (const id of selected) {
      const cert = options.find((c) => c.id === id);
      if (!cert) continue;
      // 简化估算：基价 × 行业系数
      const basePriceMap: Record<string, number> = {
        QES: 12000, Q: 5000, QE: 8000, ES: 9000, QJES: 17000,
        "27001": 13000, "20000": 10000, "双信息": 21500,
        HACCP: 8500, "食品安全管理": 8000, GAP: 10000,
        "商品售后服务": 7000, "餐饮服务": 6000,
        "社会责任": 13000, "能源": 12000, "碳管理": 10000,
        "绿色供应链": 6500
      };
      const base = basePriceMap[id] ?? 0;
      total += base;
    }
    return total;
  }, [selected, options]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!companyName.trim()) {
      setError("请填写企业名称");
      return;
    }
    if (selected.size === 0) {
      setError("至少选择一项认证证书");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.certificationQuote({
        companyName: companyName.trim(),
        industry,
        employeeCount,
        certifications: Array.from(selected),
        riskLevel
      });
      setQuote(result);
      // 滚动到报价区域
      setTimeout(() => {
        document.querySelector(".quote-result")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function exportDocx() {
    if (!quote) return;
    setExporting(true);
    try {
      const blob = await api.exportQuoteDocx({
        companyName: quote.companyName,
        quote
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.companyName}-认证报价单.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  function reset() {
    setQuote(null);
  }

  if (loading) {
    return (
      <main className="app-state">
        <LoaderCircle className="spin" size={28} />
        <strong>加载认证证书清单…</strong>
      </main>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">
            <Calculator size={14} /> 认证专家 · 报价工作台
          </span>
          <h1>认证证书报价</h1>
          <p>
            选择证书类型、填写企业类型和人数，系统按 2026 年实际报价规则计算。
          </p>
        </div>
      </header>

      <form className="cert-quote-layout" onSubmit={submit}>
        {/* ============ 第 1 步：选证书 ============ */}
        <section className="cert-card cert-pick">
          <h2>
            <span className="step">1</span> 选择认证证书
          </h2>

          {/* 推荐组合 */}
          {recommendations.length > 0 && (
            <div className="cert-recommend">
              <div className="cert-recommend-head">
                <Sparkles size={16} />
                <span>基于 <strong>{industry}</strong> 行业推荐组合</span>
              </div>
              <div className="cert-recommend-grid">
                {recommendations.map((rec, i) => {
                  const isApplied =
                    rec.certIds.length === selected.size &&
                    rec.certIds.every((id) => selected.has(id));
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`cert-recommend-card ${isApplied ? "applied" : ""}`}
                      onClick={() => applyRecommendation(rec.certIds)}
                    >
                      {rec.highlight && <span className="badge">{rec.highlight}</span>}
                      <div className="cert-recommend-name">{rec.name}</div>
                      <div className="cert-recommend-certs">
                        {rec.certIds.map((id) => {
                          const certOption = options.find((o) => o.id === id);
                          return <span key={id} className="cert-tag">{certOption?.name ?? id}</span>;
                        })}
                      </div>
                      <div className="cert-recommend-action">
                        {isApplied ? (
                          <><Check size={14} /> 已选择</>
                        ) : (
                          <>一键选择 <ChevronRight size={14} /></>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="cert-divider">
            <span>或选择单项证书</span>
          </div>

          {/* 单项选择 - 按分组 */}
          {grouped.map(([category, certs]) => {
            const meta = CATEGORY_META[category] ?? { icon: "📄", color: "#6b7280", description: category };
            return (
              <div key={category} className="cert-group">
                <div className="cert-group-header" style={{ borderLeftColor: meta.color }}>
                  <span className="cert-group-icon">{meta.icon}</span>
                  <div>
                    <h3>{category}</h3>
                    <p>{meta.description}</p>
                  </div>
                  <span className="cert-group-count">
                    {certs.filter((c) => selected.has(c.id)).length} / {certs.length}
                  </span>
                </div>
                <div className="cert-grid">
                  {certs.map((cert) => {
                    const isSelected = selected.has(cert.id);
                    return (
                      <label
                        key={cert.id}
                        className={`cert-item ${isSelected ? "selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCert(cert.id)}
                        />
                        <div className="cert-item-check">
                          {isSelected && <Check size={14} />}
                        </div>
                        <div className="cert-item-body">
                          <div className="cert-item-name">{cert.name}</div>
                          <div className="cert-item-id">{cert.id}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 实时统计条 */}
          <div className="cert-stats">
            <div className="cert-stat-item">
              <span>已选</span>
              <strong>{selected.size}</strong> 项
            </div>
            <div className="cert-stat-item">
              <span>预估基价</span>
              <strong>¥ {estimatedSubtotal.toLocaleString()}</strong>
            </div>
            {selected.size >= 2 && (
              <div className="cert-stat-discount">
                🎁 多证折扣{" "}
                <strong>
                  {selected.size === 2 ? "95" : selected.size === 3 ? "90" : "85"}%
                </strong>
              </div>
            )}
            {selected.size > 0 && (
              <button type="button" className="cert-clear" onClick={clearSelection}>
                清空
              </button>
            )}
          </div>
        </section>

        {/* ============ 第 2 步：企业信息 ============ */}
        <section className="cert-card cert-info">
          <h2>
            <span className="step">2</span> 企业基础信息
          </h2>
          <div className="cert-form-grid">
            <label className="cert-field cert-field-wide">
              <span>
                <ShieldCheck size={13} /> 企业名称
              </span>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="例：宁夏某科技有限公司"
                required
              />
            </label>
            <label className="cert-field">
              <span>企业类型</span>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                required
              >
                {industries.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label className="cert-field">
              <span>
                <Users size={13} /> 企业人数
              </span>
              <input
                type="number"
                min={1}
                max={100000}
                value={employeeCount}
                onChange={(e) =>
                  setEmployeeCount(Math.max(1, Number(e.target.value) || 1))
                }
                required
              />
            </label>
            <label className="cert-field cert-field-wide">
              <span>
                <ShieldCheck size={13} /> 风险级别
              </span>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as "medium" | "high")}
              >
                {riskLevels.length > 0
                  ? riskLevels.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))
                  : (
                    <>
                      <option value="medium">中级审核员（常规）</option>
                      <option value="high">高级审核员（高风险行业）</option>
                    </>
                  )}
              </select>
              <small className="cert-field-hint">
                {riskLevel === "high"
                  ? "⚠️ 高风险行业（化工、重工、医疗器械等）建议选高级审核员，人日更多"
                  : "✓ 常规行业用中级审核员即可"}
              </small>
            </label>
          </div>
          <div className="cert-size-hint">
            <span>人数系数：</span>
            ≤30 → 85% ｜ 31-100 → 100% ｜ 101-300 → 115% ｜ 301-500 → 130% ｜
            501-1000 → 150% ｜ &gt;1000 → 180%
          </div>
        </section>

        <button
          type="submit"
          className="primary-button quote-button"
          disabled={submitting || selected.size === 0}
        >
          {submitting ? (
            <>
              <LoaderCircle className="spin" size={18} /> 计算中…
            </>
          ) : (
            <>
              <Sparkles size={18} /> 立即生成报价
            </>
          )}
        </button>

        {error && <div className="cert-error">{error}</div>}
      </form>

      {/* ============ 报价结果 ============ */}
      {quote && (
        <section className="quote-result" aria-live="polite">
          <header className="quote-header">
            <div>
              <h2>📋 报价单</h2>
              <p>
                {quote.companyName} · {quote.industry} · {quote.employeeCount} 人
              </p>
            </div>
            <div className="quote-header-actions">
              <button
                className="primary-button quote-export"
                onClick={exportDocx}
                disabled={exporting}
              >
                {exporting ? (
                  <><LoaderCircle className="spin" size={16} /> 导出中…</>
                ) : (
                  <><FileDown size={16} /> 导出报价单 DOCX</>
                )}
              </button>
              <button className="ghost-button" onClick={reset}>
                重新报价
              </button>
            </div>
          </header>

          <table className="quote-table">
            <thead>
              <tr>
                <th>证书</th>
                <th>基价</th>
                <th>行业系数</th>
                <th>调整后</th>
                <th>人日</th>
              </tr>
            </thead>
            <tbody>
              {quote.certifications.map((item) => (
                <tr key={item.certId}>
                  <td>
                    <strong>{item.certName}</strong>
                    <br />
                    <small>{item.certId}</small>
                  </td>
                  <td>¥ {item.basePrice.toLocaleString()}</td>
                  <td>× {item.industryFactor}</td>
                  <td>¥ {item.adjustedBase.toLocaleString()}</td>
                  <td>
                    {item.initialAuditDays}/{item.supervisionAuditDays}/{item.recertificationAuditDays}
                    <br />
                    <small>{item.auditorLevel}审核员</small>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>小计</td>
                <td>¥ {quote.subtotal.toLocaleString()}</td>
              </tr>
              <tr>
                <td colSpan={3}>人数系数（{quote.sizeTier}）</td>
                <td>× {quote.sizeFactor}</td>
              </tr>
              <tr>
                <td colSpan={3}>小计 × 人数</td>
                <td>¥ {quote.afterSizeFactor.toLocaleString()}</td>
              </tr>
              <tr>
                <td colSpan={3}>多证折扣（{quote.bundleTier}）</td>
                <td>× {quote.bundleDiscount}</td>
              </tr>
            </tfoot>
          </table>

          <div className="quote-total">
            <div className="quote-total-main">
              <span>初审报价（包干）</span>
              <strong>¥ {quote.initialPrice.toLocaleString()}</strong>
            </div>
            <div className="quote-total-sub">
              <div>
                <span>监督审核（次年）</span>
                <strong>¥ {quote.supervisionPrice.toLocaleString()}</strong>
              </div>
              <div>
                <span>预估审核人日</span>
                <strong>{quote.estimatedAuditDays} 天</strong>
              </div>
            </div>
          </div>

          <div className="quote-notes">
            <div>
              <h4>✓ 价格包含</h4>
              <ul>
                {quote.priceIncludes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>✗ 不包含</h4>
              <ul>
                {quote.priceExcludes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}