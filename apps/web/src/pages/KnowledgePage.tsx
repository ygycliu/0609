import { BookOpen, Eye, FileUp, History, LoaderCircle, Search, Sparkles, Trash2, X, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { ToastManager } from "../components/Toast";
import type { KnowledgeItem } from "../types";

const categories = [
  "01-行业知识",
  "02-AI能力",
  "03-数字化咨询",
  "04-数字孪生",
  "05-项目案例",
  "06-培训课程",
  "07-政策法规",
  "08-产品体系",
  "09-模板库",
  "10-实施经验",
  "11-个人方法论",
  "12-视频资料",
  "13-项目文档",
  "14-客户案例",
  "15-持续更新"
];

interface KnowledgePageProps {
  knowledge: KnowledgeItem[];
  onChange: (items: KnowledgeItem[]) => void;
  currentUser?: { role?: string; isAdmin?: boolean };  // V2.0 权限
}

export function KnowledgePage({ knowledge, onChange, currentUser }: KnowledgePageProps) {
  // V2.0：权限判断
  const canUpload = currentUser?.isAdmin || currentUser?.role === "admin";
  const canDelete = canUpload;
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [versionsDoc, setVersionsDoc] = useState<{ id: string; title: string } | null>(null);
  const [versions, setVersions] = useState<Array<{ version: number; change_summary: string; creator: string | null; created_at: string }>>([]);
  // V2.0：预览状态
  // 纠错弹窗状态
  const [correctingItem, setCorrectingItem] = useState<KnowledgeItem | null>(null);
  const [correctContent, setCorrectContent] = useState("");
  const [correctComment, setCorrectComment] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState("");

  // 预览状态
  const [previewDoc, setPreviewDoc] = useState<KnowledgeItem | null>(null);
  // V2.0：本地 loading 状态（prop 为空时自己 fetch）
  const [localKnowledge, setLocalKnowledge] = useState<KnowledgeItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  function previewItem(item: KnowledgeItem) {
    setPreviewDoc(item);
  }

  // V2.0 兜底：如果父组件没传 knowledge，自动 fetch
  useEffect(() => {
    if (knowledge && knowledge.length > 0) {
      setLocalKnowledge(null);  // 用 prop 的数据
      return;
    }
    // prop 空，自己 fetch（调用 list 接口而不是 search，避免 tokenize 慢）
    setLoading(true);
    api.listKnowledgeLight(100)
      .then((items: any) => {
        const arr = Array.isArray(items) ? items : [];
        setLocalKnowledge(arr);
        onChange(arr);
      })
      .catch((e: any) => {
        console.error("KnowledgePage fallback fetch failed", e);
        setError(e?.message || "加载知识库失败");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 实际数据源：prop 优先，否则用本地 fetch
  const effectiveKnowledge = knowledge && knowledge.length > 0
    ? knowledge
    : (localKnowledge || []);

  async function showVersions(item: KnowledgeItem) {
    setVersionsDoc({ id: item.id, title: item.title });
    setVersions([]);
    try {
      const v = await api.knowledgeVersions(item.id);
      setVersions(v);
    } catch (e: any) {
      setError(e?.message ?? "加载版本失败");
    }
  }
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [tags, setTags] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.toLowerCase();
    return effectiveKnowledge.filter((item) =>
      `${item.title} ${item.category} ${(item.tags || []).join(" ")}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [effectiveKnowledge, query]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("category", category);
    form.append("tags", tags);
    try {
      // V2.0：OFD 文件走专门接口（自动转 Word + 自动审批入库）
      if (file.name.toLowerCase().endsWith(".ofd")) {
        const result: any = await api.ofdToKnowledge(form);
        const msg = result?.message || `OFD 已转换为 Word 并入库：${result?.title || title}`;
        ToastManager.success(msg);
      } else {
        const result: any = await api.uploadKnowledge(form);
        const msg = result?.data?.message || result?.message || "已提交审核，请等待管理员审核";
        ToastManager.info(`✅ ${msg}\n\n您可以在「知识中心 → 知识审核」查看审核进度。`);
      }
      setFile(null);
      setTitle("");
      setTags("");
      const input = document.getElementById("knowledge-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "上传失败";
      setError(msg);
      ToastManager.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function remove(item: KnowledgeItem) {
    if (!window.confirm(`确认删除知识条目“${item.title}”？`)) return;
    try {
      await api.deleteKnowledge(item.id);
      onChange(effectiveKnowledge.filter((entry) => entry.id !== item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">知识中心</span>
          <h1>把项目资料转化为可检索知识</h1>
          <p>支持常用文本、PDF、DOCX 和 PPTX，入库后自动参与咨询与文档分析。</p>
        </div>
      </header>

      <section className="knowledge-layout">
        {canUpload && (
        <form className="upload-panel" onSubmit={upload}>
          <div className="panel-title">
            <FileUp size={20} />
            <div>
              <h2>新增知识</h2>
              <p>单个文件不超过 200MB</p>
            </div>
          </div>
          <label className="file-drop" htmlFor="knowledge-file">
            <FileUp size={24} />
            <strong>{file ? file.name : "选择知识文件"}</strong>
            <span>TXT / MD / CSV / JSON / PDF / DOCX / PPTX</span>
            <input
              id="knowledge-file"
              type="file"
              accept=".txt,.md,.csv,.json,.pdf,.docx,.pptx,.ofd"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
              }}
              required
            />
          </label>
          {file?.name.toLowerCase().endsWith(".ofd") && (
            <div className="ofd-hint">
              <Sparkles size={14} /> OFD 文件将自动转换为 Word 格式后入库
            </div>
          )}
          <label className="field">
            <span>知识标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="field">
            <span>分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>标签</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="用逗号分隔，例如：消防, 政策"
            />
          </label>
          <button className="primary-button full-button" disabled={uploading || !file}>
            {uploading ? <LoaderCircle className="spin" size={18} /> : <FileUp size={18} />}
            {uploading ? "正在解析并入库" : "解析并加入知识库"}
          </button>
          {error && <div className="error-banner">{error}</div>}
        </form>
        )}

        <section className="knowledge-list-panel">
          <div className="list-toolbar">
            <div>
              <h2>知识条目</h2>
              <span>{loading ? "加载中..." : `${effectiveKnowledge.length} 条${filtered.length !== effectiveKnowledge.length ? `（已筛选 ${filtered.length}）` : ""}`}</span>
            </div>
            <label className="search-field">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、分类或标签"
              />
            </label>
          </div>

          <div className="knowledge-list">
            {filtered.length ? (
              filtered.map((item) => (
                <article className="knowledge-row" key={item.id}>
                  <div className="file-badge"><BookOpen size={18} /></div>
                  <div className="knowledge-main">
                    <div className="knowledge-heading">
                      <h3>{item.title}</h3>
                      <span>{item.fileType ? item.fileType.toUpperCase() : "TXT"}</span>
                    </div>
                    <p>{item.content.slice(0, 130)}{item.content.length > 130 ? "..." : ""}</p>
                    <div className="knowledge-meta">
                      <span>{item.category}</span>
                      <span>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span>
                      {(item.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}
                    </div>
                  </div>
                  <div className="knowledge-actions">
                    <button
                      className="ghost-icon"
                      onClick={() => showVersions(item)}
                      aria-label={`查看 ${item.title} 版本历史`}
                      title="查看版本历史"
                    >
                      <History size={17} />
                    </button>
                    <button
                      className="ghost-icon"
                      onClick={() => previewItem(item)}
                      aria-label={`预览 ${item.title}`}
                      title="预览内容"
                    >
                      <Eye size={17} />
                    </button>
                    <button
                      className="ghost-icon"
                      onClick={() => {
                        setCorrectingItem(item);
                        setCorrectContent(item.content);
                        setCorrectComment("");
                        setCorrectError("");
                      }}
                      aria-label={`纠错 ${item.title}`}
                      title="纠错"
                    >
                      <AlertCircle size={17} />
                    </button>
                    {canDelete && (
                    <button
                      className="danger-icon"
                      onClick={() => remove(item)}
                      aria-label={`删除 ${item.title}`}
                      title="删除知识"
                    >
                      <Trash2 size={17} />
                    </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <BookOpen size={28} />
                <h3>没有匹配的知识条目</h3>
                <p>调整搜索条件，或上传一份新的资料。</p>
              </div>
            )}
          </div>
        </section>
      </section>

      {versionsDoc && (
        <div className="modal-scrim" onClick={() => setVersionsDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3>版本历史：{versionsDoc.title}</h3>
              <button className="ghost-icon" onClick={() => setVersionsDoc(null)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {versions.length === 0 ? (
                <p className="empty">暂无版本历史（首次创建未修改）</p>
              ) : (
                <ol className="version-list">
                  {versions.map((v) => (
                    <li key={v.version} className="version-item">
                      <strong>v{v.version}</strong>
                      <span>{v.change_summary}</span>
                      <small>{v.creator ?? "系统"} · {new Date(v.created_at).toLocaleString("zh-CN")}</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* V2.0：预览弹窗 */}
      {previewDoc && (
        <div className="modal-scrim" onClick={() => setPreviewDoc(null)}>
          <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>{previewDoc.title}</h3>
                <div className="preview-meta">
                  <span className={`status-pill status-${previewDoc.fileType ? "completed" : "cancelled"}`}>
                    {previewDoc.fileType ? previewDoc.fileType.toUpperCase() : "TXT"}
                  </span>
                  <span className="muted small">{previewDoc.category}</span>
                  {(previewDoc.tags || []).map((tag) => (
                    <span key={tag} className="muted small">#{tag}</span>
                  ))}
                </div>
              </div>
              <button className="ghost-icon" onClick={() => setPreviewDoc(null)} title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body preview-body">
              <pre>{previewDoc.content}</pre>
            </div>
            <footer className="modal-footer">
              <span className="muted small">
                共 {previewDoc.content.length} 字符 · 创建于 {new Date(previewDoc.createdAt).toLocaleString("zh-CN")}
              </span>
              <button className="primary-button small" onClick={() => {
                navigator.clipboard.writeText(previewDoc.content);
                alert("已复制到剪贴板");
              }}>
                复制内容
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 纠错弹窗 */}
      {correctingItem && (
        <div className="modal-scrim" onClick={() => setCorrectingItem(null)}>
          <div className="modal" style={{maxWidth: 680}} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>纠错：{correctingItem.title}</h3>
                <div className="preview-meta">
                  <span className="muted small">{correctingItem.category}</span>
                  <span className="muted small">doc_code: {correctingItem.id}</span>
                </div>
              </div>
              <button className="ghost-icon" onClick={() => setCorrectingItem(null)} title="关闭">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <p style={{fontSize:13, color:'var(--muted)', margin:'0 0 12px'}}>
                请修改下方内容后提交。管理员审核通过后，新内容将替换当前版本。
              </p>
              <label className="field" style={{marginBottom:12}}>
                <span>建议的新内容</span>
                <textarea
                  rows={10}
                  style={{width:'100%',background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',color:'var(--text)',fontSize:13,resize:'vertical',fontFamily:'monospace'}}
                  value={correctContent}
                  onChange={(e) => setCorrectContent(e.target.value)}
                  placeholder="请输入正确的内容"
                />
              </label>
              <label className="field">
                <span>纠错说明（选填）</span>
                <input
                  type="text"
                  style={{width:'100%',background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',color:'var(--text)',fontSize:13}}
                  value={correctComment}
                  onChange={(e) => setCorrectComment(e.target.value)}
                  placeholder="例如：第3行数据有误，应为 xxx"
                />
              </label>
              {correctError && <div className="login-error" style={{marginTop:10}}>{correctError}</div>}
            </div>
            <footer className="modal-footer">
              <span className="muted small">提交后将进入审核流程</span>
              <button
                className="primary-button"
                style={{marginLeft:'auto'}}
                disabled={correcting || !correctContent.trim() || correctContent === correctingItem.content}
                onClick={async () => {
                  if (!correctContent.trim()) { setCorrectError("内容不能为空"); return; }
                  if (correctContent === correctingItem.content) { setCorrectError("内容未做任何修改"); return; }
                  setCorrecting(true);
                  setCorrectError("");
                  try {
                    await api.postFeedback(correctingItem.id, {
                      isHelpful: true,
                      correctContent: correctContent.trim(),
                      comment: correctComment.trim()
                    });
                    setCorrectingItem(null);
                    alert("纠错已提交，等待管理员审核");
                  } catch (err: any) {
                    setCorrectError(err?.message || "提交失败，请重试");
                  } finally {
                    setCorrecting(false);
                  }
                }}
              >
                {correcting ? "提交中..." : "提交纠错"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
