import { AlertCircle, LoaderCircle, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
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
import { AuditorPage } from "./pages/AuditorPage";
import { FilesPage } from "./pages/FilesPage";
import type {
  ConsultationRecord,
  Employee,
  KnowledgeItem,
  ModelOption,
  Page
} from "./types";

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
    Promise.all([
      api.employees(),
      api.models(),
      api.knowledge(),
      api.consultations()
    ])
      .then(([employeeData, modelData, knowledgeData, consultationData]) => {
        setEmployees(employeeData);
        setModels(modelData);
        setKnowledge(knowledgeData);
        setConsultations(consultationData);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "初始化失败");
      });
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
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <main className="main-content">
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
          <KnowledgePage knowledge={knowledge} onChange={setKnowledge} />
        )}
        {page === "documents" && <DocumentsPage models={models} />}
        {page === "results" && (
          <ResultsPage consultations={consultations} employees={employees} />
        )}
        {page === "auditor" && <AuditorPage />}
        {page === "files" && <FilesPage />}
        <footer className="app-copyright" aria-label="版权信息">
          版权所有上海缘起卢卡智能科技有限公司
        </footer>
      </main>
    </div>
  );
}
