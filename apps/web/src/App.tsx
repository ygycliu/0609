import { AlertCircle, LoaderCircle, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { PageAssistant } from "./components/PageAssistant";
import { api } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { PasswordChangePage } from "./pages/PasswordChangePage";
import { CertificationQuotePage } from "./pages/CertificationQuotePage";
import { KnowledgeReviewPage } from "./pages/KnowledgeReviewPage";
import { ConsultPage } from "./pages/ConsultPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { OverviewPage } from "./pages/OverviewPage";
import { ResultsPage } from "./pages/ResultsPage";
import { SystemEnumPage } from "./pages/SystemEnumPage";
import { AuditorProfilePage } from "./pages/AuditorProfilePage";
import { CertificateExpiryPage } from "./pages/CertificateExpiryPage";
import { DataExchangePage } from "./pages/DataExchangePage";
import { AuditorPage } from "./pages/AuditorPage";
import { FilesPage } from "./pages/FilesPage";
import { PdfToWordPage } from "./pages/PdfToWordPage";
import { CustomerListPage } from "./pages/CustomerListPage";
import ContractsPage from "./pages/ContractsPage";
import TemplateEnginePage from "./pages/TemplateEnginePage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { FinanceDashboard } from "./pages/FinanceDashboard";
import { FollowUpPage } from "./pages/FollowUpPage";
import { LlmConfigPage } from "./pages/LlmConfigPage";
import { TodoPage } from "./pages/TodoPage";
import { ProjectWorkspace } from "./pages/ProjectWorkspace";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { BaseDataPage } from "./pages/BaseDataPage";
import type {
  ConsultationRecord,
  Employee,
  KnowledgeItem,
  ModelOption,
  Page
} from "./types";
import { usePermissions } from "./lib/usePermissions";
import { PermissionDenied } from "./components/PermissionDenied";
import { ToastContainer, useToasts } from "./components/Toast";

/** 行业网站链接 — 用于页脚上方的"行业网站链接"板块
 * 优先尝试 logoUrl；加载失败自动回退到首字母圆形（截图样式）
 */
const INDUSTRY_LINKS: { name: string; url: string; logoUrl?: string; fallback: string }[] = [
  { name: "认证认可协会", url: "https://www.ccaa.cn", logoUrl: "https://www.ccaa.cn/favicon.ico", fallback: "认" },
  { name: "CCAA综合服务平台", url: "https://service.ccaa.cn", logoUrl: "https://service.ccaa.cn/favicon.ico", fallback: "C" },
  { name: "CCAA从业人员", url: "https://www.ccaa.cn/person/", logoUrl: "https://www.ccaa.cn/favicon.ico", fallback: "C" },
  { name: "全国认证认可信息公共服务平台", url: "https://cx.cnca.cn", logoUrl: "https://cx.cnca.cn/favicon.ico", fallback: "全" },
  { name: "国家企业信用信息公示系统", url: "https://www.gsxt.gov.cn", logoUrl: "https://www.gsxt.gov.cn/favicon.ico", fallback: "国" },
  { name: "全国特种设备公示信息查询", url: "https://cnse.samr.gov.cn", logoUrl: "https://cnse.samr.gov.cn/favicon.ico", fallback: "特" },
  { name: "特种作业操作证查询", url: "https://www.mem.gov.cn", logoUrl: "https://www.mem.gov.cn/favicon.ico", fallback: "作" },
  { name: "排污许可证管理信息平台", url: "https://permit.mee.gov.cn", logoUrl: "https://permit.mee.gov.cn/favicon.ico", fallback: "排" },
  { name: "职业病危害项目申报", url: "https://www.chinacdc.cn", logoUrl: "https://www.chinacdc.cn/favicon.ico", fallback: "职" },
  { name: "全国建筑市场监管公共服务平台", url: "http://jzsc.mohurd.gov.cn", logoUrl: "http://jzsc.mohurd.gov.cn/favicon.ico", fallback: "建" },
];

export default function App() {
  const [auth, setAuth] = useState<{ user: any } | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("ai-center-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // V2.0：用户权限（从 auth.user.role 派生）
  const { permissions } = usePermissions(auth?.user?.role);
  // V2.0：全局 toast 订阅
  const { toasts, dismiss } = useToasts();


  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ai-center-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    api.me()
      .then(({ user }) => setAuth({ user }))
      .catch(() => setAuth(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!auth) return;  // 未登录不加载
    // V2.0：每个调用独立处理（避免一个失败导致全部失败）
    api.employees()
      .then((employeeData) => setEmployees(employeeData))
      .catch(() => setEmployees([]));
    api.models()
      .then((modelData) => setModels(modelData))
      .catch(() => setModels([]));
    api.knowledge()
      .then((knowledgeData) => setKnowledge(knowledgeData))
      .catch(() => setKnowledge([]));
    api.consultations()
      .then((consultationData) => setConsultations(consultationData))
      .catch(() => setConsultations([]));
  }, [auth]);

  if (loading) {
    return (
      <main className="app-state">
        <LoaderCircle className="spin" size={28} />
        <strong>正在连接咨询中心</strong>
        <span>加载模型、知识库和历史成果...</span>
      </main>
    );
  }

  // 未登录 → 显示登录页
  if (!auth) {
    return <LoginPage onLogin={(user) => setAuth({ user })} />;
  }

  if (auth.user.mustChangePassword) {
    return <PasswordChangePage onChanged={() => setAuth(null)} />;
  }

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {}
    setAuth(null);
  };

  if (error) {
    return (
      <main className="app-state error-state">
        <AlertCircle size={30} />
        <strong>无法连接后端服务</strong>
        <span>{error}</span>
        <button className="primary-button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        open={sidebarOpen}
        onNavigate={setPage}
        onOpen={() => setSidebarOpen(true)}
        onClose={() => setSidebarOpen(false)}
        currentUser={auth.user}
        permissions={permissions}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <main className="main-content">
        <div className="global-topbar">
          <div className="topbar-spacer" />
          {auth.user && (
            <div className="user-pill">
              <div className="user-meta">
                <strong>{auth.user.displayName || auth.user.username || "管理员"}</strong>
                <span className="user-role-pill">{(auth.user as any).role === "admin" ? "系统管理员" : "用户"}</span>
              </div>
              <button
                className="logout-pill-btn"
                onClick={() => void handleLogout()}
                title="登出"
              >
                登出
              </button>
            </div>
          )}
        </div>
        {page === "overview" && (
          <OverviewPage
            employees={employees}
            knowledge={knowledge}
            consultations={consultations}
            models={models}
            onNavigate={setPage}
          />
        )}
        {page === "consult" && (
          <ConsultPage
            employees={employees}
            models={models}
            onCreated={(record) => setConsultations((items) => [record, ...items])}
          />
        )}
        {page === "certification-quote" && <CertificationQuotePage />}
        {page === "knowledge-review" && <KnowledgeReviewPage currentUser={auth.user} />}
        {page === "knowledge" && (
          <KnowledgePage
            knowledge={knowledge}
            onChange={setKnowledge}
            currentUser={{ ...auth.user, isAdmin: permissions.isAdmin }}
          />
        )}
        {page === "documents" && <DocumentsPage models={models} />}
        {page === "results" && (
          <ResultsPage consultations={consultations} employees={employees} />
        )}
        {page === "auditor" && <AuditorPage />}
        {page === "files" && <FilesPage />}
        {page === "pdf-to-word" && <PdfToWordPage />}
        {page === "system-enum" && (
          permissions.modules.SYSTEM_BASIC_DATA
            ? <SystemEnumPage />
            : <PermissionDenied permission="SYSTEM_BASIC_DATA" hint="系统基础数据（签约主体/外协/风险等级）只对管理员开放。" />
        )}
        {page === "auditor-profile" && (
          <AuditorProfilePage currentUser={{ isAdmin: permissions.isAdmin, role: permissions.isAdmin ? "admin" : "regular" }} />
        )}
        {page === "cert-expiry" && (
          <CertificateExpiryPage />
        )}
        {page === "data-exchange" && (
          permissions.isAdmin
            ? <DataExchangePage />
            : <PermissionDenied permission="SYSTEM_BASIC_DATA" hint="数据导入导出涉及全量数据操作，仅管理员可访问。" />
        )}
        {page === "llm-config" && (
          permissions.modules.SYSTEM_BASIC_DATA
            ? <LlmConfigPage currentUser={auth.user} onLogout={handleLogout} />
            : <PermissionDenied permission="SYSTEM_BASIC_DATA" hint="大模型配置涉及全平台 AI 调用入口，仅管理员可访问。" />
        )}
        {page === "follow-up" && (
          <FollowUpPage
            onOpenCustomer={(id) => setPage(`customer-detail:${id}` as Page)}
          />
        )}
        {page === "todo" && <TodoPage />}
        {page === "project-workspace" && (
          <ProjectWorkspace
            onNavigate={(p) => setPage(p as Page)}
            onOpenProject={(id) => setPage(`project-detail:${id}` as Page)}
          />
        )}
        {page === "base-data" && (
          <BaseDataPage
            onOpenCustomer={(id) => setPage(`customer-detail:${id || ""}` as Page)}
          />
        )}
        {page === "project-new" && (
          <NewProjectPage
            onBack={() => setPage("project-workspace")}
            onCreated={(id) => setPage(`project-detail:${id}` as Page)}
          />
        )}
        {page.startsWith("project-detail:") && (
          <ProjectDetailPage
            projectId={page.replace("project-detail:", "")}
            onBack={() => setPage("project-workspace")}
          />
        )}
        {page === "customer-list" && (
          <CustomerListPage
            onOpen={(id) => setPage(`customer-detail:${id}` as Page)}
            onCreate={() => setPage("customer-detail")}
          />
        )}
        {page.startsWith("customer-detail:") && (
          <CustomerDetailPage
            customerId={page === "customer-detail" ? null : page.replace("customer-detail:", "")}
            onBack={() => setPage("customer-list")}
            onChanged={() => {
              /* 列表页会通过 page 切换重新加载 */
            }}
            onOpenFollowUp={() => {
              setPage("follow-up");
            }}
          />
        )}
        {page === "contracts" && <ContractsPage />}
        {page === "template-engine" && <TemplateEnginePage />}
        {page === "finance-dashboard" && (
          permissions.modules.FINANCE_DASHBOARD
            ? <FinanceDashboard
                onOpenTransaction={(id) => {
                  window.alert(`交易 ${id} 详情页待实现`);
                }}
                currentUser={{ ...auth.user, isAdmin: permissions.isAdmin }}
              />
            : <PermissionDenied permission="FINANCE_DASHBOARD" hint="财务报表涉及敏感数据，仅管理员可查看。" />
        )}

        {/* V2.0：全局 toast 容器 */}
        <ToastContainer toasts={toasts} onClose={dismiss} />

        {/* 行业网站链接 */}
        <section className="industry-links" aria-label="行业网站链接">
          <h2 className="industry-links__title">行业网站链接</h2>
          <div className="industry-links__grid">
            {INDUSTRY_LINKS.map((item) => (
              <a
                key={item.name}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="industry-link"
                title={item.name}
              >
                {item.logoUrl ? (
                  <img
                    src={item.logoUrl}
                    alt={item.name}
                    className="industry-link__logo"
                    loading="lazy"
                    onError={(e) => {
                      // favicon 加载失败回退到首字母
                      const target = e.currentTarget as HTMLImageElement;
                      const parent = target.parentElement;
                      if (parent && !parent.querySelector('.industry-link__fallback')) {
                        const fb = document.createElement('span');
                        fb.className = 'industry-link__fallback';
                        fb.textContent = item.fallback;
                        parent.appendChild(fb);
                        target.style.display = 'none';
                      }
                    }}
                  />
                ) : (
                  <span className="industry-link__fallback">{item.fallback}</span>
                )}
                <span className="industry-link__name">{item.name}</span>
              </a>
            ))}
          </div>
        </section>

        <footer className="app-copyright" aria-label="版权信息">
          版权所有上海缘起卢卡智能科技有限公司
        </footer>
      </main>

      {/* 页面助手：悬浮右下角 */}
      <PageAssistant currentPage={page} />
    </div>
  );

}
