import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ReviewItem } from "../types";

interface KnowledgeReviewPageProps {
  currentUser?: { role: string; username: string };
}

export function KnowledgeReviewPage({ currentUser }: KnowledgeReviewPageProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<"pending" | "all" | "applied" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const isAdmin = currentUser?.role === "admin";

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
              ? "目前没有用户提交纠正建议。可以去「知识中心」文档页选择「建议纠正」来提交审核。"
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
                <code className="review-doc-code">{it.doc_code}</code>
              </div>
              <div className="review-meta">
                <span>{it.review_type}</span>
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
              <div className="review-section">
                <h4>建议新内容</h4>
                <pre className="review-content">{it.proposed_content}</pre>
              </div>
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
    </div>
  );
}