import {
  Award,
  BookOpen,
  BrainCircuit,
  Calculator,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  FolderOpen,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  Sun,
  X
} from "lucide-react";
import type { Page } from "../types";
import { useState, useEffect } from "react";

type IconType = typeof LayoutDashboard;

type NavItem = {
  id: Page;
  label: string;
  icon: IconType;
};

type NavGroup = {
  id: string;
  label: string;
  icon: IconType;
  items?: NavItem[];
  page?: Page; // 一级菜单自身跳转页面（可选）
};

const navigation: NavGroup[] = [
  {
    id: "overview",
    label: "中心总览",
    icon: LayoutDashboard,
    page: "overview"
  },
  {
    id: "biz-center",
    label: "认证业务中心",
    icon: Award,
    items: [
      { id: "consult", label: "开始咨询", icon: MessageSquareText },
      { id: "certification-quote", label: "认证报价", icon: Calculator },
      { id: "auditor", label: "数字审核员", icon: ClipboardList }
    ]
  },
  {
    id: "files",
    label: "文件浏览",
    icon: FolderOpen,
    page: "files"
  },
  {
    id: "knowledge-group",
    label: "知识中心",
    icon: BookOpen,
    items: [
      { id: "knowledge", label: "知识中心", icon: BookOpen },
      { id: "knowledge-review", label: "知识审核", icon: ClipboardCheck }
    ]
  },
  {
    id: "documents",
    label: "文档分析",
    icon: FileSearch,
    page: "documents"
  },
  {
    id: "tools",
    label: "工具",
    icon: FileSearch,
    items: [
      { id: "pdf-to-word", label: "PDF 转 Word", icon: FileSearch }
    ]
  },
  {
    id: "results",
    label: "历史成果",
    icon: History,
    page: "results"
  }
];

interface SidebarProps {
  page: Page;
  open: boolean;
  onNavigate: (page: Page) => void;
  onOpen: () => void;
  onClose: () => void;
  currentUser?: { username: string; role: string; displayName?: string };
  onLogout?: () => void | Promise<void>;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function Sidebar({
  page,
  open,
  onNavigate,
  onOpen,
  onClose,
  currentUser,
  onLogout,
  theme,
  onToggleTheme
}: SidebarProps) {
  // 默认展开包含当前页的 group
  const getInitialOpen = () => {
    const openGroups = new Set<string>();
    navigation.forEach((group) => {
      if (group.items) {
        if (group.items.some((item) => item.id === page)) {
          openGroups.add(group.id);
        }
      } else if (group.page === page) {
        openGroups.add(group.id);
      }
    });
    // 默认认证业务中心展开
    openGroups.add("biz-center");
    return openGroups;
  };

  const [expanded, setExpanded] = useState<Set<string>>(getInitialOpen());

  useEffect(() => {
    // 当前页面变化时，自动展开对应 group
    navigation.forEach((group) => {
      if (group.items && group.items.some((item) => item.id === page)) {
        setExpanded((prev) => new Set([...Array.from(prev), group.id]));
      }
    });
  }, [page]);

  const toggleGroup = (groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

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
          {navigation.map((group) => {
            const GroupIcon = group.icon;
            const isExpanded = expanded.has(group.id);
            const isActiveGroup =
              group.items?.some((item) => item.id === page) ||
              group.page === page;

            if (!group.items) {
              // 单项菜单
              return (
                <button
                  key={group.id}
                  className={isActiveGroup ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    if (group.page) onNavigate(group.page);
                    onClose();
                  }}
                >
                  <GroupIcon size={18} strokeWidth={1.8} />
                  {group.label}
                </button>
              );
            }

            // 分组菜单
            return (
              <div key={group.id} className="nav-group">
                <button
                  className={
                    isActiveGroup ? "nav-item nav-group-header active" : "nav-item nav-group-header"
                  }
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isExpanded}
                >
                  <GroupIcon size={18} strokeWidth={1.8} />
                  <span className="nav-group-label">{group.label}</span>
                  <ChevronDown
                    size={14}
                    className={isExpanded ? "nav-chevron expanded" : "nav-chevron"}
                  />
                </button>
                {isExpanded && (
                  <div className="nav-subitems">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isActive = page === item.id;
                      return (
                        <button
                          key={item.id}
                          className={isActive ? "nav-item nav-subitem active" : "nav-item nav-subitem"}
                          onClick={() => {
                            onNavigate(item.id);
                            onClose();
                          }}
                        >
                          <ItemIcon size={16} strokeWidth={1.8} />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label="切换主题"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "浅色" : "深色"}
          </button>
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