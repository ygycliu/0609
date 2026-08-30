import {
  ArrowRight,
  BookOpenText,
  Bot,
  Calculator,
  CheckCircle2,
  Database,
  Receipt,
  Route,
  ShieldCheck
} from "lucide-react";
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
  'auditor-digital': ShieldCheck,         // 数字审核员 - 盾牌 ✓
  'quote-specialist': Calculator,         // 报价员 - 计算器 ✓
  'trainer': BookOpenText,                // 培训讲师 - 书本 ✓
  'knowledge-assistant': Database,         // 知识助手 - 数据库 ✓
  'certification-expert': CheckCircle2,    // 认证专家 - 勾 ✓
};

// 按员工 ID 映射主题色
const ROLE_COLORS: Record<string, string> = {
  'auditor-digital': '#10b981',           // 绿（审核通过感）
  'quote-specialist': '#f59e0b',          // 橙（价格感）
  'trainer': '#3b82f6',                   // 蓝（学习感）
  'knowledge-assistant': '#8b5cf6',       // 紫（智能感）
  'certification-expert': '#ec4899',      // 粉（认证感）
};
const roleIcons = [Route, Bot, BookOpenText, Database, CheckCircle2];

export function OverviewPage({
  employees,
  knowledge,
  consultations,
  models,
  onNavigate
}: OverviewPageProps) {
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
            { key: "consult", label: "开始咨询", desc: "AI 多角色协同", color: "yellow", icon: "💬" },
            { key: "certification-quote", label: "认证报价", desc: "QES 三体系", color: "purple", icon: "📋" },
            { key: "auditor", label: "数字审核员", desc: "智能模拟外审", color: "pink", icon: "✓" },
            { key: "customer-list", label: "客户管理", desc: "CRM 基础数据", color: "green", icon: "👥" },
            { key: "files", label: "文件浏览", desc: "知识资产", color: "cyan", icon: "📁" },
            { key: "knowledge", label: "知识中心", desc: "标准与法规", color: "blue", icon: "📚" }
          ].map((item) => (
            <button
              key={item.key}
              className={`category-card cat-${item.color}`}
              onClick={() => onNavigate(item.key as Page)}
            >
              <span className="cat-icon">{item.icon}</span>
              <strong>{item.label}</strong>
              <small>{item.desc}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="metric-grid" aria-label="运行概览">
        <div className="metric">
          <span>AI 专业角色</span>
          <strong>{employees.length}</strong>
          <small>覆盖咨询、方案、培训、知识</small>
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

      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">专业分工</span>
            <h2>AI 数字员工协同交付</h2>
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
