/**
 * V2.3.8：帮助中心 FAQ 页面
 *
 * 两个核心功能：
 *   1. 常见问题**处理**（左侧列表，按分类/搜索筛选 + 卡片式 + 详情预览）
 *   2. 常见问题**录入**（右侧表单，问题/答案/分类/标签/错误码/关联模块）
 *
 * 设计目标：
 *   - 列表与录入同屏，无需切换页面
 *   - 录入后立即出现在列表中（无需刷新）
 *   - 详情预览为 modal，显示完整答案（支持 Markdown 简单换行）
 */
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  LoaderCircle,
  PlusCircle,
  Search,
  Tag,
  X,
  Eye,
  Trash2,
  HelpCircle,
  Filter,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { api } from "../lib/api";
import { ToastManager } from "../components/Toast";
import type { FaqItem } from "../types";

const CATEGORIES = ["合同", "客户", "认证", "财务", "审核", "系统", "其他"] as const;
const MODULES = ["contract", "customer", "audit", "finance", "system", "knowledge", "其他"] as const;
const MODULE_LABEL: Record<string, string> = {
  contract: "合同",
  customer: "客户",
  audit: "审核",
  finance: "财务",
  system: "系统",
  knowledge: "知识库",
};

interface HelpPageProps {
  currentUser?: { role?: string; isAdmin?: boolean; username?: string; id?: string };
}

export function HelpPage({ currentUser }: HelpPageProps) {
  const isAdmin = currentUser?.isAdmin || currentUser?.role === "admin";
  const userId = currentUser?.id;

  // === 列表 ===
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterModule, setFilterModule] = useState<string>("");
  const [error, setError] = useState("");

  // === 详情 ===
  const [preview, setPreview] = useState<FaqItem | null>(null);

  // === 录入 ===
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    category: "其他" as typeof CATEGORIES[number],
    question: "",
    answer: "",
    tagsInput: "",
    error_code: "",
    related_module: "" as "" | typeof MODULES[number],
  });
  const [formError, setFormError] = useState("");

  // === 折叠状态（按分类折叠）===
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  async function loadFaqs() {
    setLoading(true);
    setError("");
    try {
      const res = await api.listFaqs({
        q: query.trim() || undefined,
        category: filterCategory || undefined,
        module: filterModule || undefined,
        pageSize: 100,
      });
      setFaqs(res?.data ?? []);
      setTotal(res?.total ?? 0);
    } catch (e: any) {
      setError(e?.message || "加载 FAQ 失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFaqs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory, filterModule]);

  // 输入框触发搜索（debounce 简单版）
  useEffect(() => {
    const t = setTimeout(() => { loadFaqs(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 按分类分组
  const grouped = useMemo(() => {
    const map: Record<string, FaqItem[]> = {};
    for (const f of faqs) {
      (map[f.category] ||= []).push(f);
    }
    return map;
  }, [faqs]);

  // 总分类统计（包含空分类）
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORIES) counts[cat] = 0;
    for (const f of faqs) counts[f.category] = (counts[f.category] || 0) + 1;
    return counts;
  }, [faqs]);

  async function submitForm(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError("");
    if (form.question.trim().length < 2) { setFormError("问题至少 2 字"); return; }
    if (form.answer.trim().length < 2) { setFormError("答案至少 2 字"); return; }
    const tags = form.tagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    setSubmitting(true);
    try {
      await api.createFaq({
        category: form.category,
        question: form.question.trim(),
        answer: form.answer.trim(),
        tags,
        error_code: form.error_code.trim() || undefined,
        related_module: form.related_module || undefined,
      });
      ToastManager.success("FAQ 已录入");
      setForm({ category: "其他", question: "", answer: "", tagsInput: "", error_code: "", related_module: "" });
      loadFaqs();
    } catch (e: any) {
      setFormError(e?.message || "录入失败");
      ToastManager.error(e?.message || "录入失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeFaq(item: FaqItem) {
    if (!window.confirm(`确认归档 FAQ"${item.question.slice(0, 30)}..."？`)) return;
    try {
      await api.deleteFaq(item.id);
      ToastManager.success("已归档");
      loadFaqs();
    } catch (e: any) {
      ToastManager.error(e?.message || "归档失败");
    }
  }

  function renderAnswer(text: string) {
    // 简单 Markdown：保留换行 + 识别 `- list` 与 `1. list`
    return text.split("\n").map((line, i) => {
      const t = line.trim();
      if (/^[-*]\s+/.test(t)) {
        return <div key={i} style={{ paddingLeft: 18, marginBottom: 2 }}>• {t.replace(/^[-*]\s+/, "")}</div>;
      }
      if (/^\d+\.\s+/.test(t)) {
        return <div key={i} style={{ paddingLeft: 18, marginBottom: 2 }}>{t}</div>;
      }
      return <div key={i} style={{ marginBottom: 6 }}>{line || "\u00a0"}</div>;
    });
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">帮助中心</span>
          <h1>常见问题处理 + 常见问题录入</h1>
          <p>把团队经验沉淀到知识库，所有成员都可查阅、可录入；管理员可归档。</p>
        </div>
      </header>

      <section className="help-layout">
        {/* ===== 左：录入表单 ===== */}
        <form className="help-form-panel" onSubmit={submitForm}>
          <div className="panel-title">
            <PlusCircle size={20} />
            <div>
              <h2>常见问题录入</h2>
              <p>录入后会立即出现在右侧列表中</p>
            </div>
          </div>

          <label className="field">
            <span>分类 <span style={{ color: "var(--danger)" }}>*</span></span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as any })}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="field">
            <span>问题 <span style={{ color: "var(--danger)" }}>*</span></span>
            <input
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              placeholder="例如：合同金额为 0 怎么补齐？"
              maxLength={500}
              required
            />
          </label>

          <label className="field">
            <span>答案 <span style={{ color: "var(--danger)" }}>*</span></span>
            <textarea
              rows={6}
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              placeholder="详细处理步骤（支持换行）"
              maxLength={10000}
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>关联模块</span>
              <select
                value={form.related_module}
                onChange={(e) => setForm({ ...form, related_module: e.target.value as any })}
              >
                <option value="">（无）</option>
                {MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m] || m}</option>)}
              </select>
            </label>
            <label className="field">
              <span>错误码（可选）</span>
              <input
                value={form.error_code}
                onChange={(e) => setForm({ ...form, error_code: e.target.value })}
                placeholder="如：500 / E_TIMEOUT"
                maxLength={100}
              />
            </label>
          </div>

          <label className="field">
            <span>标签（逗号分隔）</span>
            <input
              value={form.tagsInput}
              onChange={(e) => setForm({ ...form, tagsInput: e.target.value })}
              placeholder="如：合同, 金额, 回溯"
            />
          </label>

          <button type="submit" className="primary-button full-button" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <PlusCircle size={18} />}
            {submitting ? "录入中..." : "录入 FAQ"}
          </button>
          {formError && <div className="error-banner">{formError}</div>}
        </form>

        {/* ===== 右：列表 + 筛选 ===== */}
        <section className="help-list-panel">
          <div className="list-toolbar">
            <div>
              <h2>常见问题列表</h2>
              <span>
                {loading ? "加载中..." : `共 ${total} 条${faqs.length !== total ? `（当前 ${faqs.length}）` : ""}`}
              </span>
            </div>
            <label className="search-field">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索问题、答案、标签"
              />
            </label>
          </div>

          <div className="filter-bar">
            <Filter size={15} />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">全部分类</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c} ({categoryStats[c] || 0})</option>
              ))}
            </select>
            <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)}>
              <option value="">全部模块</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>{MODULE_LABEL[m] || m}</option>
              ))}
            </select>
            {(filterCategory || filterModule || query) && (
              <button
                type="button"
                className="ghost-button small"
                onClick={() => { setFilterCategory(""); setFilterModule(""); setQuery(""); }}
              >
                <X size={13} /> 清空筛选
              </button>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="help-list">
            {faqs.length === 0 && !loading ? (
              <div className="empty-state">
                <HelpCircle size={28} />
                <h3>暂无 FAQ</h3>
                <p>暂无符合条件的常见问题。请在左侧录入第一条。</p>
              </div>
            ) : (
              Object.keys(grouped).sort().map((cat) => {
                const items = grouped[cat];
                if (items.length === 0) return null;
                const isCollapsed = collapsed[cat];
                return (
                  <div key={cat} className="help-category-block">
                    <button
                      type="button"
                      className="help-category-header"
                      onClick={() => setCollapsed({ ...collapsed, [cat]: !isCollapsed })}
                    >
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      <strong>{cat}</strong>
                      <span className="badge">{items.length}</span>
                    </button>
                    {!isCollapsed && items.map((item) => (
                      <article className="help-card" key={item.id}>
                        <div className="help-card-head">
                          <h3 onClick={() => setPreview(item)} title="点击查看详情">
                            {item.question}
                          </h3>
                          <div className="help-card-actions">
                            <button
                              className="ghost-icon"
                              onClick={() => setPreview(item)}
                              title="查看详情"
                            >
                              <Eye size={16} />
                            </button>
                            {(isAdmin || item.created_by === userId) && (
                              <button
                                className="danger-icon"
                                onClick={() => removeFaq(item)}
                                title="归档"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="help-card-preview">
                          {item.answer.length > 130 ? item.answer.slice(0, 130) + "..." : item.answer}
                        </p>
                        <div className="help-card-meta">
                          {item.related_module && (
                            <span className="muted small">
                              <BookOpen size={11} /> {MODULE_LABEL[item.related_module] || item.related_module}
                            </span>
                          )}
                          {item.error_code && (
                            <span className="muted small">
                              <AlertCircle size={11} /> {item.error_code}
                            </span>
                          )}
                          <span className="muted small">👁 {item.view_count}</span>
                          {(item.tags || []).slice(0, 4).map((t) => (
                            <span key={t} className="tag-pill">#{t}</span>
                          ))}
                          <span className="muted small">
                            {new Date(item.updated_at).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </section>

      {/* ===== 详情 modal ===== */}
      {preview && (
        <div className="modal-scrim" onClick={() => setPreview(null)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>{preview.question}</h3>
                <div className="preview-meta">
                  <span className="status-pill status-completed">{preview.category}</span>
                  {preview.related_module && (
                    <span className="muted small">{MODULE_LABEL[preview.related_module] || preview.related_module}</span>
                  )}
                  {preview.error_code && (
                    <span className="muted small">错误码: {preview.error_code}</span>
                  )}
                </div>
              </div>
              <button className="ghost-icon" onClick={() => setPreview(null)} title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {renderAnswer(preview.answer)}
            </div>
            <footer className="modal-footer">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(preview.tags || []).map((t) => (
                  <span key={t} className="tag-pill"><Tag size={11} /> {t}</span>
                ))}
              </div>
              <span className="muted small">
                共 {preview.answer.length} 字符 · 浏览 {preview.view_count} 次
              </span>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}