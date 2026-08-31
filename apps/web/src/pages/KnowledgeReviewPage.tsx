import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ReviewItem } from "../types";

interface KnowledgeReviewPageProps {
  currentUser?: { role: string; username: string };
}

/** 解析上传型审核的元数据 */
function parseUploadMeta(json: string): {
  title: string; category: string; fileType: string; tags: string[];
  content: string; sourceName: string;
} {
  try {
    return JSON.parse(json);
  } catch {
    return {
      title: "未知", category: "", fileType: "txt", tags: [],
      content: "", sourceName: ""
    };
  }
}

export function KnowledgeReviewPage({ currentUser }: KnowledgeReviewPageProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<"pending" | "all" | "applied" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const isAdmin = currentUser?.role === "admin";

  // V2.0：预览和编辑状态
  const [previewItem, setPreviewItem] = useState<ReviewItem | null>(null);
  const [editingItem, setEditingItem] = useState<ReviewItem | null>(null);
  const [editedMeta, setEditedMeta] = useState<{
    title: string; category: string; tags: string; content: string;
  }>({ title: "", category: "", tags: "", content: "" });

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.qualityReviews(filter);
      setItems(data);
    } catch (e: any) {
      setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReviews(); }, [filter]);

  const handleDecision = async (id: string, action: "approve" | "reject") => {
    setProcessing(id);
    setError(null);
    try {
      const note = decisionNote[id] ?? "";
      await api.reviewDecision(id, { action, note });
      await fetchReviews();
      setDecisionNote((m) => ({ ...m, [id]: "" }));
    } catch (e: any) {
      setError(e?.message ?? "操作失败");
    } finally {
      setProcessing(null);
    }
  };

  // V2.0：进入预览模式（只读）
  const openPreview = (item: ReviewItem) => {
    setPreviewItem(item);
  };

  // V2.0：进入修改模式（编辑内容后再批准）
  const openEdit = (item: ReviewItem) => {
    setEditingItem(item);
    if (item.review_type === "upload") {
      const meta = parseUploadMeta(item.proposed_content);
      setEditedMeta({
        title: meta.title,
        category: meta.category,
        tags: Array.isArray(meta.tags) ? meta.tags.join(", ") : "",
        content: meta.content || ""
      });
    } else {
      setEditedMeta({
        title: item.document_title || "",
        category: "",
        tags: "",
        content: item.proposed_content
      });
    }
  };

  // V2.0：批准+应用（带编辑后的内容）
  const handleApproveWithEdit = async () => {
    if (!editingItem) return;
    setProcessing(editingItem.id);
    setError(null);
    try {
      const note = decisionNote[editingItem.id] ?? "";

      // V2.0：如果有编辑，先调用内容更新接口
      if (editingItem.review_type === "upload") {
        const meta = parseUploadMeta(editingItem.proposed_content);
        const editedTags = editedMeta.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean);

        // 构建新的 proposed_content
        const newProposed = JSON.stringify({
          title: editedMeta.title,
          category: editedMeta.category || meta.category,
          fileType: meta.fileType,
          tags: editedTags,
          content: editedMeta.content,
          sourceName: meta.sourceName
        });

        // 直接调用决策（approve），传入新的 proposed_content
        await api.reviewDecision(editingItem.id, {
          action: "approve",
          note: note ? `${note}（已编辑）` : "已编辑后批准",
          editedContent: newProposed  // V2.0：传递编辑后的内容
        } as any);
      } else {
        // correction 类型：编辑后内容
        await api.reviewDecision(editingItem.id, {
          action: "approve",
          note: note ? `${note}（已编辑）` : "已编辑后批准",
          editedContent: editedMeta.content
        } as any);
      }

      await fetchReviews();
      setEditingItem(null);
      setDecisionNote((m) => ({ ...m, [editingItem.id]: "" }));
    } catch (e: any) {
      setError(e?.message ?? "操作失败");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="page knowledge-review-page">
      <header className="page-header">
        <h2>知识审核</h2>
        <p className="page-subtitle">
          用户反馈"建议纠正"提交的内容需管理员审核后才会应用到知识库。每次审核会创建新版本。
        </p>
      </header>

      <div className="review-tabs">
        {(["pending", "applied", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? "review-tab active" : "review-tab"}
            onClick={() => setFilter(f)}
          >
            {f === "pending" ? "待处理" : f === "applied" ? "已应用" : f === "rejected" ? "已拒绝" : "全部"}
          </button>
        ))}
      </div>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
      {loading && <p>加载中...</p>}

      {!loading && items.length === 0 && (
        <div className="empty-state-card">
          <div className="empty-icon">📋</div>
          <h3>暂无{filter === "pending" ? "待审核" : filter === "applied" ? "已应用" : filter === "rejected" ? "已拒绝" : ""}内容</h3>
          <p>
            {filter === "pending"
              ? "没有待审核内容。可以在「知识中心」上传文件或提交内容纠正。"
              : "切换其他标签查看更多审核记录。"}
          </p>
        </div>
      )}

      <div className="review-list">
        {items.map((it) => (
          <div key={it.id} className={`review-card status-${it.status}`}>
            <div className="review-head">
              <div>
                <span className={`badge badge-${it.status}`}>{it.status}</span>
                <strong className="review-title">{it.document_title}</strong>
                {it.doc_code && <code className="review-doc-code">{it.doc_code}</code>}
              </div>
              <div className="review-meta">
                <span>{it.review_type === "upload" ? "上传文件" : it.review_type === "correction" ? "内容纠正" : it.review_type}</span>
                <span>·</span>
                <span>{new Date(it.created_at).toLocaleString("zh-CN")}</span>
              </div>
            </div>

            <div className="review-body">
              <div className="review-section">
                <h4>提交人</h4>
                <p>{it.submitter_display ?? "匿名"}</p>
              </div>
              <div className="review-section">
                <h4>原因</h4>
                <p>{it.reason}</p>
              </div>
              {it.review_type === "upload" ? (
                (() => {
                  const meta = parseUploadMeta(it.proposed_content);
                  return (
                    <div className="review-section">
                      <h4>待入库文件信息</h4>
                      <p><strong>标题：</strong>{meta.title}</p>
                      <p><strong>分类：</strong>{meta.category}</p>
                      <p><strong>来源：</strong>{meta.sourceName}</p>
                      <p><strong>标签：</strong>{Array.isArray(meta.tags) ? meta.tags.join(", ") : meta.tags}</p>
                      <p><strong>字数：</strong>{meta.content?.length ?? 0} 字符</p>
                      <button
                        className="ghost-button small"
                        onClick={() => openPreview(it)}
                        style={{ marginTop: 8 }}
                      >
                        👁️ 预览完整内容
                      </button>
                    </div>
                  );
                })()
              ) : (
                <div className="review-section">
                  <h4>建议新内容</h4>
                  <pre className="review-content">{it.proposed_content}</pre>
                </div>
              )}
              {it.review_note && (
                <div className="review-section">
                  <h4>审核意见</h4>
                  <p>{it.review_note}</p>
                  <p className="review-reviewer">
                    {it.reviewer_display} · {it.reviewed_at ? new Date(it.reviewed_at).toLocaleString("zh-CN") : ""}
                    {it.new_version && ` · 创建 v${it.new_version}`}
                  </p>
                </div>
              )}
            </div>

            {isAdmin && it.status === "pending" && (
              <div className="review-actions">
                <input
                  type="text"
                  placeholder="审核意见（可选）"
                  value={decisionNote[it.id] ?? ""}
                  onChange={(e) => setDecisionNote({ ...decisionNote, [it.id]: e.target.value })}
                  className="review-note-input"
                />
                {/* V2.0：预览按钮（只读） */}
                <button
                  className="btn btn-secondary"
                  onClick={() => openPreview(it)}
                  disabled={processing === it.id}
                >
                  👁️ 预览
                </button>
                {/* V2.0：修改并批准按钮 */}
                <button
                  className="btn btn-edit"
                  onClick={() => openEdit(it)}
                  disabled={processing === it.id}
                >
                  ✏️ 修改并批准
                </button>
                <button
                  className="btn btn-reject"
                  onClick={() => handleDecision(it.id, "reject")}
                  disabled={processing === it.id}
                >
                  拒绝
                </button>
                <button
                  className="btn btn-approve"
                  onClick={() => handleDecision(it.id, "approve")}
                  disabled={processing === it.id}
                >
                  {processing === it.id ? "处理中..." : "批准并应用"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* V2.0：预览弹窗（只读）*/}
      {previewItem && (
        <div className="modal-scrim" onClick={() => setPreviewItem(null)}>
          <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>👁️ 预览：{previewItem.document_title}</h3>
                <div className="preview-meta">
                  <span className={`status-pill status-${previewItem.status}`}>
                    {previewItem.status}
                  </span>
                  <span className="muted small">
                    {previewItem.review_type === "upload" ? "上传文件" : "内容纠正"}
                  </span>
                </div>
              </div>
              <button className="ghost-icon" onClick={() => setPreviewItem(null)} title="关闭">×</button>
            </header>
            <div className="modal-body preview-body">
              {previewItem.review_type === "upload" ? (
                (() => {
                  const meta = parseUploadMeta(previewItem.proposed_content);
                  return (
                    <>
                      <div className="preview-meta-info">
                        <p><strong>标题：</strong>{meta.title}</p>
                        <p><strong>分类：</strong>{meta.category}</p>
                        <p><strong>来源：</strong>{meta.sourceName}</p>
                        <p><strong>类型：</strong>{meta.fileType}</p>
                        <p><strong>标签：</strong>{Array.isArray(meta.tags) ? meta.tags.join(", ") : ""}</p>
                        <p><strong>字数：</strong>{meta.content?.length ?? 0} 字符</p>
                      </div>
                      <hr />
                      <h4>完整内容</h4>
                      <pre className="preview-content-text">{meta.content}</pre>
                    </>
                  );
                })()
              ) : (
                <>
                  <div className="preview-meta-info">
                    <p><strong>提交人：</strong>{previewItem.submitter_display ?? "匿名"}</p>
                    <p><strong>原因：</strong>{previewItem.reason}</p>
                  </div>
                  <hr />
                  <h4>建议新内容</h4>
                  <pre className="preview-content-text">{previewItem.proposed_content}</pre>
                </>
              )}
            </div>
            <footer className="modal-footer">
              <span className="muted small">
                {previewItem.created_at && new Date(previewItem.created_at).toLocaleString("zh-CN")}
              </span>
              <div className="preview-actions">
                <button className="ghost-button" onClick={() => setPreviewItem(null)}>关闭</button>
                <button
                  className="btn btn-edit"
                  onClick={() => {
                    const item = previewItem;
                    setPreviewItem(null);
                    openEdit(item);
                  }}
                >
                  ✏️ 修改并批准
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* V2.0：修改弹窗（编辑后批准）*/}
      {editingItem && (
        <div className="modal-scrim" onClick={() => setEditingItem(null)}>
          <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h3>✏️ 修改并批准：{editingItem.document_title}</h3>
                <div className="preview-meta">
                  <span className="muted small">
                    修改后将直接批准并入库到知识库
                  </span>
                </div>
              </div>
              <button className="ghost-icon" onClick={() => setEditingItem(null)} title="关闭">×</button>
            </header>
            <div className="modal-body edit-body">
              <label className="field">
                <span>标题</span>
                <input
                  value={editedMeta.title}
                  onChange={(e) => setEditedMeta({ ...editedMeta, title: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>分类</span>
                <input
                  value={editedMeta.category}
                  onChange={(e) => setEditedMeta({ ...editedMeta, category: e.target.value })}
                  placeholder="如：01-行业知识、15-持续更新"
                />
              </label>
              <label className="field">
                <span>标签（用逗号分隔）</span>
                <input
                  value={editedMeta.tags}
                  onChange={(e) => setEditedMeta({ ...editedMeta, tags: e.target.value })}
                  placeholder="如：消防, 政策"
                />
              </label>
              <label className="field">
                <span>内容（{editedMeta.content.length} 字符）</span>
                <textarea
                  value={editedMeta.content}
                  onChange={(e) => setEditedMeta({ ...editedMeta, content: e.target.value })}
                  rows={16}
                  className="edit-textarea"
                  placeholder="知识内容"
                />
              </label>
              <label className="field">
                <span>审核意见（可选）</span>
                <input
                  value={decisionNote[editingItem.id] ?? ""}
                  onChange={(e) => setDecisionNote({ ...decisionNote, [editingItem.id]: e.target.value })}
                  placeholder="如：已修正日期错误"
                />
              </label>
            </div>
            <footer className="modal-footer">
              <span className="muted small">
                ⚠️ 修改后将创建新版本并直接应用
              </span>
              <div className="edit-actions">
                <button className="ghost-button" onClick={() => setEditingItem(null)}>取消</button>
                <button
                  className="btn btn-reject"
                  onClick={() => {
                    handleDecision(editingItem.id, "reject");
                    setEditingItem(null);
                  }}
                  disabled={processing === editingItem.id}
                >
                  拒绝
                </button>
                <button
                  className="btn btn-approve"
                  onClick={handleApproveWithEdit}
                  disabled={processing === editingItem.id || !editedMeta.title.trim()}
                >
                  {processing === editingItem.id ? "处理中..." : "✅ 修改并应用"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}