import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import {
  assistantChat,
  assistantConfirm,
  type AssistantMessage
} from "../lib/api";

interface PageAssistantProps {
  currentPage?: string;
}

const SUGGESTED_QUESTIONS = [
  "项目工作台是做什么的？",
  "状态机有哪些状态？",
  "如何创建项目？",
  "报价怎么算？",
  "怎么用 YoooClaw 自动生成待办？",
  "查一下最近的项目"
];

export function PageAssistant({ currentPage }: PageAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingTool, setPendingTool] = useState<{
    toolName: string;
    args: any;
    display: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载历史
  useEffect(() => {
    const saved = localStorage.getItem("assistant_history");
    if (saved) {
      try { setMessages(JSON.parse(saved)); } catch {}
    }
  }, []);

  // 保存历史
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("assistant_history", JSON.stringify(messages.slice(-30)));
    }
  }, [messages]);

  // 滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const sendMessage = async (msg: string) => {
    if (!msg.trim() || sending) return;

    const newMessages: AssistantMessage[] = [
      ...messages,
      { role: "user", content: msg }
    ];
    setMessages(newMessages);
    setInput("");
    setSending(true);

    try {
      const r = await assistantChat({
        message: msg,
        history: newMessages.slice(-10),  // 后端只保留 10 条
        context: { currentPage }
      });
      const data = r.data || r;  // 兼容 request 解包

      if (data.needsConfirmation && data.toolCalls?.[0]) {
        const tc = data.toolCalls[0];
        setPendingTool({
          toolName: tc.name,
          args: tc.args,
          display: data.reply
        });
        setMessages([...newMessages, { role: "assistant", content: data.reply }]);
      } else {
        setMessages([...newMessages, { role: "assistant", content: data.reply || "（无回复）" }]);
      }
    } catch (e: any) {
      setMessages([...newMessages, {
        role: "assistant",
        content: `❌ 错误：${e?.message || "未知错误"}`
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingTool) return;
    setSending(true);
    try {
      const r = await assistantConfirm({
        toolName: pendingTool.toolName,
        args: pendingTool.args
      });
      const data = (r as any).data || r;
      setMessages(m => [...m, {
        role: "assistant",
        content: data.reply || "已执行"
      }]);
      setPendingTool(null);
    } catch (e: any) {
      setMessages(m => [...m, {
        role: "assistant",
        content: `❌ 执行失败：${e?.message || "未知错误"}`
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = () => {
    setMessages(m => [...m, { role: "assistant", content: "好的，已取消该操作。" }]);
    setPendingTool(null);
  };

  const clearHistory = () => {
    if (confirm("确认清空对话历史？")) {
      setMessages([]);
      localStorage.removeItem("assistant_history");
    }
  };

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        className={`page-assistant-fab ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        title="AI 助手"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && messages.length > 0 && (
          <span className="page-assistant-badge">{messages.length > 99 ? "99+" : messages.length}</span>
        )}
      </button>

      {/* 聊天窗口 */}
      {open && (
        <div className="page-assistant-panel">
          <header className="page-assistant-header">
            <div className="page-assistant-title">
              <Sparkles size={18} />
              <div>
                <strong>AI 助手</strong>
                <small>{currentPage ? `当前：${currentPage}` : "在线"}</small>
              </div>
            </div>
            <div className="page-assistant-actions">
              {messages.length > 0 && (
                <button className="page-assistant-icon-btn" onClick={clearHistory} title="清空历史">
                  <span style={{ fontSize: 11 }}>清空</span>
                </button>
              )}
              <button className="page-assistant-icon-btn" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="page-assistant-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="page-assistant-welcome">
                <Sparkles size={32} className="welcome-icon" />
                <h3>我是 AI 助手</h3>
                <p>可以：</p>
                <ul>
                  <li>📚 讲解系统功能（项目/报价/状态机）</li>
                  <li>🔍 查询数据（项目/客户/待办）</li>
                  <li>⚡ 执行操作（创建项目等）</li>
                </ul>
                <div className="suggested-questions">
                  <p>试试问：</p>
                  {SUGGESTED_QUESTIONS.slice(0, 4).map((q, i) => (
                    <button key={i} className="suggested-btn" onClick={() => sendMessage(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`page-assistant-msg msg-${m.role}`}>
                <div className="msg-bubble">{m.content}</div>
              </div>
            ))}

            {pendingTool && (
              <div className="page-assistant-confirm">
                <div className="confirm-tool">⚙️ 待确认操作</div>
                <button className="confirm-btn confirm-yes" onClick={handleConfirm} disabled={sending}>
                  ✓ 确认执行
                </button>
                <button className="confirm-btn confirm-no" onClick={handleCancel} disabled={sending}>
                  ✗ 取消
                </button>
              </div>
            )}

            {sending && (
              <div className="page-assistant-msg msg-assistant">
                <div className="msg-bubble">
                  <LoaderCircle size={14} className="spin" /> 思考中...
                </div>
              </div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="page-assistant-suggestions">
              {SUGGESTED_QUESTIONS.slice(4).map((q, i) => (
                <button key={i} className="suggested-pill" onClick={() => sendMessage(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            className="page-assistant-input"
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问我任何问题..."
              disabled={sending}
              autoFocus
            />
            <button type="submit" disabled={!input.trim() || sending}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}