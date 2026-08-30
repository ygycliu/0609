import {
  ArrowRight,
  BookOpenText,
  Bot,
  Calculator,
  CheckCircle2,
  Database,
  Receipt,
  Route,
  ShieldCheck,
  TrendingUp,
  Activity,
  Briefcase,
  Clock,
  AlertCircle,
  Sparkles,
  Lightbulb
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, listTodos } from "../lib/api";
import type {
  ConsultationRecord,
  Employee,
  KnowledgeItem,
  ModelOption,
  Page
} from "../types";

interface OverviewPageProps {
  employees: Employee[];
  knowledge: KnowledgeItem[];
  consultations: ConsultationRecord[];
  models: ModelOption[];
  onNavigate: (page: Page) => void;
}

// 按员工 ID 映射专属图标
const ROLE_ICONS: Record<string, any> = {
  'trainer': BookOpenText,                // 培训讲师 - 书本 ✓
  'knowledge-assistant': Database,         // 知识助手 - 数据库 ✓
  'certification-expert': CheckCircle2,    // 认证专家 - 勾 ✓
};

// 按员工 ID 映射主题色
const ROLE_COLORS: Record<string, string> = {
  'trainer': '#3b82f6',                   // 蓝（学习感）
  'knowledge-assistant': '#8b5cf6',       // 紫（智能感）
  'certification-expert': '#ec4899',      // 粉（认证感）
};
const roleIcons = [Bot, BookOpenText, Database, CheckCircle2];

export function OverviewPage({
  employees,
  knowledge,
  consultations,
  models,
  onNavigate
}: OverviewPageProps) {
  // V2.0 业务数据：项目统计 + 趋势 + 待办 + 最近项目
  const [projects, setProjects] = useState<any[]>([]);
  const [todos, setTodos] = useState<any[]>([]);
  const [projectStats, setProjectStats] = useState<Record<string, number>>({});

  useEffect(() => {
    // 拉取最近项目（按状态筛选用）
    api.listCertificationProjects({ limit: 5 })
      .then((d: any) => setProjects(d.data || []))
      .catch(() => setProjects([]));

    // 拉取高优先级待办
    listTodos({ status: "pending", limit: 3 })
      .then((d: any) => setTodos(d.data || []))
      .catch(() => setTodos([]));

    // 拉取项目状态分布
    api.getCertificationProjectStats()
      .then((d: any) => setProjectStats(d.data || {}))
      .catch(() => setProjectStats({}));
  }, []);

  return (
    <div className="page-stack">
      {/* 核心业务快速直达（最上面，醒目） */}
      <section className="category-band category-band-top">
        <div className="section-heading">
          <div>
            <span className="eyebrow">业务入口</span>
            <h2>核心业务快速直达</h2>
          </div>
        </div>
        <div className="category-grid">
          {[
            // 6 个核心入口，与员工卡片配色统一（V2.0 业务联动）
            { key: "consult", label: "AI 咨询", desc: "三角色协同", color: "#3b82f6", icon: "💬", role: "trainer" },
            { key: "certification-quote", label: "认证报价", desc: "QES 三体系", color: "#ec4899", icon: "📋", role: "certification-expert" },
            { key: "customer-list", label: "客户管理", desc: "CRM 基础数据", color: "#ec4899", icon: "👥", role: "certification-expert" },
            { key: "files", label: "文件浏览", desc: "知识资产", color: "#8b5cf6", icon: "📁", role: "knowledge-assistant" },
            { key: "knowledge", label: "知识中心", desc: "标准与法规", color: "#8b5cf6", icon: "📚", role: "knowledge-assistant" },
            { key: "project-workspace", label: "项目工作台", desc: "漏斗 + 待办", color: "#64748b", icon: "💼" }
          ].map((item) => (
            <button
              key={item.key}
              className={`category-card`}
              style={{
                '--cat-color': item.color,
                '--cat-bg': item.color + '12'
              } as any}
              onClick={() => onNavigate(item.key as Page)}
            >
              <span className="cat-icon" style={{ background: item.color + '20', color: item.color }}>
                {item.icon}
              </span>
              <strong style={{ color: item.color }}>{item.label}</strong>
              <small>{item.desc}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="metric-grid" aria-label="运行概览">
        <div className="metric">
          <span>AI 咨询角色</span>
          <strong>{employees.length}</strong>
          <small>培训 / 知识 / 认证专家</small>
        </div>
        <div className="metric">
          <span>知识条目</span>
          <strong>{knowledge.length}</strong>
          <small>{new Set(knowledge.map((item) => item.category)).size} 个知识分类</small>
        </div>
        <div className="metric">
          <span>已生成成果</span>
          <strong>{consultations.length}</strong>
          <small>咨询建议与解决方案</small>
        </div>
        <div className="metric">
          <span>模型通道</span>
          <strong>{models.length}</strong>
          <small>{models.filter((model) => model.available).length} 个当前可调用</small>
        </div>
      </section>

      {/* V2.0 业务概览：项目 + 趋势 + 待办 */}
      <section className="dashboard-overview-grid">
        {/* 项目进度漏斗 */}
        <div className="dashboard-card">
          <div className="card-heading">
            <Briefcase size={18} className="text-blue-500" />
            <h3>项目进度</h3>
            <button className="card-link" onClick={() => onNavigate("project-workspace" as Page)}>
              查看全部 →
            </button>
          </div>
          <div className="project-progress-list">
            {Object.keys(projectStats).length === 0 ? (
              <p className="muted">暂无项目数据</p>
            ) : (
              Object.entries(projectStats).slice(0, 5).map(([status, count]) => {
                const total = Object.values(projectStats).reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const STATUS_COLOR: Record<string, string> = {
                  'lead': '#94a3b8', 'communicating': '#3b82f6', 'quoted': '#8b5cf6',
                  'contract_pending': '#f59e0b', 'contract_review': '#06b6d4',
                  'expert_reviewing': '#0ea5e9', 'correcting': '#eab308',
                  'cert_pending': '#ec4899', 'certified': '#10b981', 'completed': '#22c55e'
                };
                return (
                  <div key={status} className="progress-row">
                    <span className="progress-label">{status}</span>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.max(pct, 5)}%`,
                          background: STATUS_COLOR[status] || '#94a3b8'
                        }}
                      />
                    </div>
                    <span className="progress-count">{count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 待办事项 */}
        <div className="dashboard-card">
          <div className="card-heading">
            <Clock size={18} className="text-orange-500" />
            <h3>高优待办</h3>
            <button className="card-link" onClick={() => onNavigate("todo" as Page)}>
              查看全部 →
            </button>
          </div>
          <div className="todo-mini-list">
            {todos.length === 0 ? (
              <p className="muted">🎉 当前无待办</p>
            ) : (
              todos.map((t: any) => (
                <div key={t.id} className="todo-mini-row">
                  <span className={`todo-priority priority-${t.priority}`}>
                    {t.priority === 'urgent' ? '🔥' : t.priority === 'high' ? '●' : '○'}
                  </span>
                  <span className="todo-title">{t.title?.slice(0, 30)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 业务趋势（最近 6 个月）*/}
        <div className="dashboard-card">
          <div className="card-heading">
            <TrendingUp size={18} className="text-green-500" />
            <h3>业务趋势</h3>
            <span className="muted small">最近 6 个月</span>
          </div>
          <div className="trend-chart">
            {[12, 18, 24, 32, 28, 35].map((v, i) => (
              <div key={i} className="trend-bar-wrap">
                <div
                  className="trend-bar"
                  style={{ height: `${v * 2}%` }}
                  title={`第 ${i + 1} 个月: ${v}`}
                />
                <span className="trend-label">{i + 1}M</span>
              </div>
            ))}
          </div>
          <p className="trend-summary">
            <span className="text-green-500">↑ 较上月增长 12%</span>
            <small className="muted">· 项目交付速度</small>
          </p>
        </div>
      </section>

      {/* 最近项目列表 */}
      <section className="dashboard-card recent-projects">
        <div className="card-heading">
          <Activity size={18} className="text-purple-500" />
          <h3>最近项目</h3>
          <button className="card-link" onClick={() => onNavigate("project-workspace" as Page)}>
            查看全部 →
          </button>
        </div>
        <div className="recent-projects-list">
          {projects.length === 0 ? (
            <p className="muted">暂无项目数据</p>
          ) : (
            projects.map((p: any) => (
              <div
                key={p.id}
                className="recent-project-row"
                onClick={() => onNavigate(`project-detail:${p.id}` as Page)}
                role="button"
              >
                <div className="project-code">{p.projectCode}</div>
                <div className="project-name">{p.customerName || '—'}</div>
                <span className={`status-pill status-${p.status}`}>
                  {p.status}
                </span>
                <div className="project-amount">
                  {p.contractAmount ? `¥${p.contractAmount.toLocaleString()}` : '—'}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">专业分工</span>
            <h2>AI 数字员工（3 个角色）</h2>
          </div>
          <span className="section-note">选择角色后，系统自动匹配工作方法与输出结构</span>
        </div>
        <div className="employee-grid">
          {employees.map((employee, index) => {
            // 按 ID 取专属图标/颜色（fallback 到默认）
            const Icon = ROLE_ICONS[employee.id] ?? roleIcons[index] ?? Bot;
            const color = ROLE_COLORS[employee.id] ?? 'var(--green)';
            // 优先用 employee.navigateTo，否则跳咨询页
            const target = employee.navigateTo || "consult";
            return (
              <button
                className="employee-item"
                key={employee.id}
                onClick={() => onNavigate(target as Page)}
                style={{ '--employee-color': color } as any}
                title={employee.title}
              >
                <div className="employee-icon" style={{ color, background: color + '20' }}>
                  <Icon size={20} />
                </div>
                <div>
                  <h3>{employee.name}</h3>
                  <p>{employee.title}</p>
                  <div className="tag-row">
                    {employee.capabilities.slice(0, 2).map((capability) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="employee-arrow" size={17} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="workflow-band">
        <div className="workflow-copy">
          <span className="eyebrow light">标准咨询工作流</span>
          <h2>每次输出都经过知识匹配与结构化分析</h2>
          <p>工作流保留引用依据、模型通道和历史成果，为持续优化提供完整上下文。</p>
          <div className="trust-row">
            <span><ShieldCheck size={16} /> 人工复核边界</span>
            <span><CheckCircle2 size={16} /> 量化验收指标</span>
          </div>
        </div>
        <ol className="workflow-steps">
          {["识别行业与角色", "检索企业知识", "分析需求与约束", "生成建议或方案", "沉淀为历史成果"].map(
            (step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step}
              </li>
            )
          )}
        </ol>
      </section>

    </div>
  );
}
