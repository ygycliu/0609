import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  ChevronRight,
  Clock,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  importYoooclawRecording,
  listImportedRecordings
} from "../lib/api";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "priority-urgent",
  high: "priority-high",
  normal: "priority-normal",
  low: "priority-low"
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  normal: "普通",
  low: "低"
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待办",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消"
};

interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category?: string;
  dueAt?: string;
  customerName?: string;
  source?: string;
  recordingId?: string;
  createdAt: string;
  completedAt?: string;
}

export function TodoPage() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    knowledge: number;
    todo: number;
    follow_up: number;
  } | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    listTodos({ status: statusFilter || undefined, limit: 200 })
      .then((r) => {
        setItems(r.data || []);
        setTotal(r.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleToggle = async (item: TodoItem) => {
    const nextStatus = item.status === "done" ? "pending" : "done";
    try {
      await updateTodo(item.id, { status: nextStatus });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新失败");
    }
  };

  const handleDelete = async (item: TodoItem) => {
    if (!confirm(`确认删除待办「${item.title}」？`)) return;
    try {
      await deleteTodo(item.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleImport = async () => {
    let payload: any;
    try {
      payload = JSON.parse(importJson);
    } catch (e) {
      alert("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (!payload.recordingId || !payload.transcript) {
      alert("需要 recordingId + transcript");
      return;
    }
    setImporting(true);
    try {
      const r = await importYoooclawRecording(payload);
      setImportResult(r.data.summary);
      load();
    } catch (e) {
      alert("导入失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">认证业务中心 · 个人</span>
          <h1>待办事项</h1>
          <p>来自手动创建、YoooClaw 通知和录音转写智能提取的待办任务。</p>
        </div>
        <div className="page-header-actions">
          <button className="ghost-button" onClick={() => setShowImport(true)}>
            <Upload size={16} /> 录音导入
          </button>
          <button className="primary-button" onClick={() => setShowCreate(true)}>
            <Plus size={18} /> 新建待办
          </button>
        </div>
      </header>

      {/* 状态筛选 */}
      <section className="finance-toolbar">
        {[
          { key: "pending", label: "待办" },
          { key: "in_progress", label: "进行中" },
          { key: "done", label: "已完成" },
          { key: "", label: "全部" }
        ].map((s) => (
          <button
            key={s.key}
            className={statusFilter === s.key ? "type-pill active" : "type-pill"}
            onClick={() => setStatusFilter(s.key)}
          >
            {s.label}
          </button>
        ))}
        <div className="toolbar-group" style={{ marginLeft: "auto" }}>
          <span>共 <strong>{total}</strong> 条</span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {/* 列表 */}
      <section className="customer-list">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={20} /> 正在加载...
          </div>
        ) : items.length === 0 ? (
          <div className="empty-row">暂无待办</div>
        ) : (
          <table className="customer-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>标题</th>
                <th>优先级</th>
                <th>到期</th>
                <th>客户</th>
                <th>来源</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className={t.status === "done" ? "done" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => handleToggle(t)}
                    />
                  </td>
                  <td>
                    <strong className={t.status === "done" ? "line-through" : ""}>{t.title}</strong>
                    {t.description && (
                      <small className="muted">{t.description}</small>
                    )}
                  </td>
                  <td>
                    <span className={`status-pill ${PRIORITY_COLORS[t.priority] || "status-default"}`}>
                      {PRIORITY_LABEL[t.priority] || t.priority}
                    </span>
                  </td>
                  <td className="mono">
                    {t.dueAt ? new Date(t.dueAt).toLocaleDateString("zh-CN") : "—"}
                  </td>
                  <td>{t.customerName || "—"}</td>
                  <td>
                    {t.source === "yoooclaw_recording" ? (
                      <span className="cert-tag">🎙️ 录音</span>
                    ) : (
                      <span className="muted">手动</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="ghost-button small danger"
                      onClick={() => handleDelete(t)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 新建待办 Modal */}
      {showCreate && (
        <CreateTodoModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {/* 录音导入 Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <Bell size={20} />
              <h2>导入 YoooClaw 录音</h2>
              <button className="ghost-button close-btn" onClick={() => setShowImport(false)}>×</button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                💡 粘贴从 Hermes Agent 用 <code>recording-query</code> 拿到的转写内容
                （含摘要、待办、跟进）
              </p>
              <details className="schema-hint">
                <summary>查看 JSON 格式示例</summary>
                <pre>{`{
  "recordingId": "ABC-123",
  "recordingName": "2026-08-24 客户沟通",
  "transcript": "客户说...",
  "summary": "简要摘要",
  "durationSec": 120,
  "todos": [
    {
      "title": "跟进 QES 复评",
      "description": "...",
      "dueAt": "2026-08-30T00:00:00Z",
      "priority": "high",
      "category": "follow_up",
      "customerName": "宁夏希望信息产业"
    }
  ],
  "followUps": [
    {
      "customerName": "宁夏希望信息产业",
      "stage": "quoted",
      "year": 2026,
      "certificationType": "QES",
      "issuingBody": "zhongren",
      "contractAmount": 85000,
      "summary": "客户已发报价"
    }
  ]
}`}</pre>
              </details>
              <textarea
                className="json-input"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={14}
                placeholder='粘贴 JSON 对象...'
              />
              {importResult && (
                <div className="import-result">
                  <strong>导入成功：</strong>
                  <span className="result-tag created">知识 {importResult.knowledge}</span>
                  <span className="result-tag updated">待办 {importResult.todo}</span>
                  <span className="result-tag new">跟进 {importResult.follow_up}</span>
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button className="ghost-button" onClick={() => setShowImport(false)}>关闭</button>
              <button
                className="primary-button"
                onClick={handleImport}
                disabled={importing || !importJson.trim()}
              >
                {importing ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                导入
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTodoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert("请输入标题");
      return;
    }
    setSaving(true);
    try {
      await createTodo({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null
      });
      onCreated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <Plus size={20} />
          <h2>新建待办</h2>
          <button className="ghost-button close-btn" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>标题 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="做什么？"
              autoFocus
            />
          </label>
          <label className="field">
            <span>描述</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>优先级</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </label>
            <label className="field">
              <span>到期日</span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
          </div>
        </div>
        <footer className="modal-footer">
          <button className="ghost-button" onClick={onClose}>取消</button>
          <button
            className="primary-button"
            onClick={handleSubmit}
            disabled={saving || !title.trim()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            创建
          </button>
        </footer>
      </div>
    </div>
  );
}