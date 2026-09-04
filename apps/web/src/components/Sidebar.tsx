import {
  Award,
  ArrowLeftRight,
  Banknote,
  Bell,
  BookOpen,
  BrainCircuit,
  Briefcase,
  Calculator,
  ChevronDown,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileSearch,
  FileType,
  FileText,
  FolderOpen,
  Activity,
  History,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquareText,
  Moon,
  Sun,
  UserCheck,
  Users,
  Wrench,
  X
} from "lucide-react";
import type { Page } from "../types";
import { useState, useEffect } from "react";

type IconType = typeof LayoutDashboard;

type NavItem = {
  id: Page;
  label: string;
  icon: IconType;
  color?: string; // V2.0 业务联动色（与员工卡片同色）
  requireModule?: string; // V2.0 权限：需要的模块权限
};

type NavGroup = {
  id: string;
  label: string;
  icon: IconType;
  items?: NavItem[];
  page?: Page; // 一级菜单自身跳转页面（可选）
  requireModule?: string; // V2.0 权限：整个 group 需要的权限
};

const navigation: NavGroup[] = [
  // 工作台（一级 - 默认入口，所有人可见）
  {
    id: "overview",
    label: "工作台",
    icon: LayoutDashboard,
    page: "overview"
  },
  // 客户与项目（业务主线，所有登录用户可见）
  {
    id: "customer-group",
    label: "客户与项目",
    icon: Users,
    items: [
      { id: "customer-list", label: "客户管理", icon: Users, color: "#ec4899" },
      { id: "contracts", label: "合同管理", icon: FileText, color: "#8b5cf6" },
      { id: "template-engine", label: "模板引擎", icon: FileText, color: "#06b6d4" },
      { id: "project-workspace", label: "项目工作台", icon: Briefcase, color: "#64748b" },
      { id: "follow-up", label: "客户跟进", icon: Activity, color: "#ec4899" },
      { id: "cert-expiry", label: "认证预警", icon: Bell, color: "#f59e0b" }
    ]
  },
  // 认证业务（核心 AI 能力）
  {
    id: "biz-center",
    label: "认证业务",
    icon: Award,
    items: [
      { id: "consult", label: "AI 咨询", icon: MessageSquareText, color: "#3b82f6" },
      { id: "auditor", label: "数字审核", icon: ClipboardCheck, color: "#10b981" },
      { id: "certification-quote", label: "认证报价", icon: Calculator, color: "#ec4899" },
      { id: "todo", label: "待办事项", icon: CheckSquare, color: "#10b981" }
    ]
  },
  // 财务（仅管理员）
  {
    id: "finance-group",
    label: "财务",
    icon: Banknote,
    requireModule: "FINANCE_DASHBOARD",  // 仅 admin 可见
    items: [
      { id: "finance-dashboard", label: "财务看板", icon: Banknote, color: "#64748b" }
    ]
  },
  // 知识资产（知识库/文件浏览所有人可见；知识审核仅管理员）
  {
    id: "knowledge-group",
    label: "知识中心",
    icon: BookOpen,
    items: [
      { id: "knowledge", label: "知识库", icon: BookOpen, color: "#8b5cf6" },
      { id: "knowledge-review", label: "知识审核", icon: ClipboardCheck, color: "#8b5cf6", requireModule: "KNOWLEDGE_REVIEW" },
      { id: "files", label: "文件浏览", icon: FolderOpen, color: "#8b5cf6" }
    ]
  },
  // 工具（系统基础数据 + 数据导入导出 仅管理员）
  {
    id: "tools",
    label: "工具",
    icon: Wrench,
    items: [
      { id: "documents", label: "文档分析", icon: FileSearch, color: "#64748b" },
      { id: "pdf-to-word", label: "PDF 转 Word", icon: FileType, color: "#64748b" },
      { id: "system-enum", label: "系统基础数据", icon: ListChecks, color: "#3b82f6", requireModule: "SYSTEM_BASIC_DATA" },
      { id: "auditor-profile", label: "审核员档案", icon: UserCheck, color: "#8b5cf6", requireModule: "AUDITOR_PROFILE" },
      { id: "data-exchange", label: "数据导入导出", icon: ArrowLeftRight, color: "#10b981", requireModule: "SYSTEM_BASIC_DATA" },
      { id: "llm-config", label: "🧠 大模型配置", icon: BrainCircuit, color: "#a855f7", requireModule: "SYSTEM_BASIC_DATA" }
    ]
  },
  // 历史成果（所有人可见）
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
  permissions?: {
    isAdmin: boolean;
    modules: Record<string, boolean>;
    actions: Record<string, boolean>;
    roleLabel: string;
  };
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
  permissions,
  onLogout,
  theme,
  onToggleTheme
}: SidebarProps) {
  // V2.0 权限：根据 permissions 过滤菜单项
  const filteredNavigation = navigation
    .map((group) => {
      // group 级权限检查
      if (group.requireModule && !permissions?.modules[group.requireModule]) {
        return null;
      }
      // item 级权限过滤
      const items = group.items
        ?.filter((item) => !item.requireModule || permissions?.modules[item.requireModule])
        ?.filter((item) => permissions?.isAdmin || (!item.id.includes("review") && !item.id.includes("financial")))
        .map((item) => item);
      // group 无 item 时（自身跳转），保留
      if (!group.items) return group;
      // 如果过滤后无 item，group 也不显示
      if (!items || items.length === 0) return null;
      return { ...group, items };
    })
    .filter(Boolean) as NavGroup[];

  // 默认展开包含当前页的 group
  const getInitialOpen = () => {
    const openGroups = new Set<string>();
    filteredNavigation.forEach((group) => {
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
    filteredNavigation.forEach((group) => {
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
            <strong>AI数字化认证</strong>
            <span>中心</span>
          </div>
          <button className="sidebar-close" onClick={onClose} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="主导航">
          <span className="nav-label">工作台</span>
          {filteredNavigation.map((group) => {
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
                      const itemColor = item.color || "var(--green)";
                      return (
                        <button
                          key={item.id}
                          className={isActive ? "nav-item nav-subitem active" : "nav-item nav-subitem"}
                          style={isActive ? {
                            background: itemColor + '15',
                            color: itemColor,
                            borderLeftColor: itemColor,
                          } : undefined}
                          onClick={() => {
                            onNavigate(item.id);
                            onClose();
                          }}
                          title={item.label}
                        >
                          <ItemIcon
                            size={16}
                            strokeWidth={1.8}
                            style={{ color: isActive ? itemColor : 'inherit' }}
                          />
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