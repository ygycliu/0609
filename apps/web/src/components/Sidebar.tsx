import {
  Award,
  BookOpen,
  BrainCircuit,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  FolderOpen,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  X
} from "lucide-react";
import type { Page } from "../types";

const navigation: Array<{
  id: Page;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "中心总览", icon: LayoutDashboard },
  { id: "consult", label: "开始咨询", icon: MessageSquareText },
  { id: "certification-quote", label: "认证报价", icon: Calculator },
  { id: "auditor", label: "数字审核员", icon: ClipboardList },
  { id: "files", label: "文件浏览", icon: FolderOpen },
  { id: "knowledge", label: "知识中心", icon: BookOpen },
  { id: "knowledge-review", label: "知识审核", icon: ClipboardCheck },
  { id: "documents", label: "文档分析", icon: FileSearch },
  { id: "results", label: "历史成果", icon: History }
];

interface SidebarProps {
  page: Page;
  open: boolean;
  onNavigate: (page: Page) => void;
  onOpen: () => void;
  onClose: () => void;
  currentUser?: { username: string; role: string; displayName?: string };
  onLogout?: () => void | Promise<void>;
}

export function Sidebar({
  page,
  open,
  onNavigate,
  onOpen,
  onClose,
  currentUser,
  onLogout
}: SidebarProps) {
  return (
    <>
      <button className="mobile-menu" onClick={onOpen} aria-label="打开导航">
        <Menu size={20} />
      </button>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="关闭导航" />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BrainCircuit size={23} />
          </div>
          <div>
            <strong>AI数字化</strong>
            <span>咨询中心</span>
          </div>
          <button className="sidebar-close" onClick={onClose} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="主导航">
          <span className="nav-label">工作台</span>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={page === item.id ? "nav-item active" : "nav-item"}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
              >
                <Icon size={18} strokeWidth={1.8} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          {currentUser && (
            <div className="sidebar-user">
              <div className="user-info">
                <strong>{currentUser.displayName || currentUser.username}</strong>
                <span className={`user-role role-${currentUser.role}`}>{currentUser.role === "admin" ? "管理员" : "用户"}</span>
              </div>
              {onLogout && (
                <button className="logout-btn" onClick={() => void onLogout()} title="登出">
                  登出
                </button>
              )}
            </div>
          )}
          <div className="status-line">
            <span className="status-dot" />
            MVP V1.0
          </div>
          <p>知识库、模型与咨询工作流已连接</p>
        </div>
      </aside>
    </>
  );
}
