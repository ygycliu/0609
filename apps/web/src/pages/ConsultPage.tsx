import { ArrowRight, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  ConsultationRecord,
  Employee,
  EmployeeRole,
  ModelOption,
  ModelProvider
} from "../types";
import { MarkdownResult } from "../components/MarkdownResult";

interface ConsultPageProps {
  employees: Employee[];
  models: ModelOption[];
  onCreated: (record: ConsultationRecord) => void;
}

export function ConsultPage({ employees, models, onCreated }: ConsultPageProps) {
  const [role, setRole] = useState<EmployeeRole>("consultant");
  const [industry, setIndustry] = useState("企业数字化");
  const [companyContext, setCompanyContext] = useState("");
  const [request, setRequest] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [model, setModel] = useState<ModelProvider>("demo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConsultationRecord | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === role) ?? employees[0],
    [employees, role]
  );

  useEffect(() => {
    if (selectedEmployee) setDeliverable(selectedEmployee.deliverables[0]);
  }, [selectedEmployee]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const record = await api.createConsultation({
        role,
        industry,
        companyContext,
        request,
        deliverable,
        model
      });
      setResult(record);
      onCreated(record);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">咨询工作台</span>
          <h1>描述问题，获得一份可执行成果</h1>
          <p>系统会自动检索知识库，并按所选 AI 角色的专业方法组织答案。</p>
        </div>
      </header>

      <div className="consult-layout">
        <form className="consult-form" onSubmit={submit}>
          <fieldset className="form-section">
            <legend>1. 选择 AI 专业角色</legend>
            <div className="role-selector">
              {employees.map((employee) => (
                <label
                  key={employee.id}
                  className={role === employee.id ? "role-option selected" : "role-option"}
                >
                  <input
                    type="radio"
                    name="role"
                    value={employee.id}
                    checked={role === employee.id}
                    onChange={() => setRole(employee.id)}
                  />
                  <span>{employee.name}</span>
                  <small>{employee.title}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-section">
            <h2>2. 提供咨询背景</h2>
            <div className="form-grid">
              <label className="field">
                <span>行业 / 领域</span>
                <input
                  value={industry}
                  onChange={(event) => setIndustry(event.target.value)}
                  placeholder="例如：消防、电力、应急管理"
                  required
                />
              </label>
              <label className="field">
                <span>期望交付物</span>
                <select
                  value={deliverable}
                  onChange={(event) => setDeliverable(event.target.value)}
                >
                  {selectedEmployee?.deliverables.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>企业现状</span>
              <textarea
                rows={4}
                value={companyContext}
                onChange={(event) => setCompanyContext(event.target.value)}
                placeholder="简述现有系统、团队、数据基础、预算周期和主要约束..."
              />
            </label>
            <label className="field">
              <span>建设需求 / 待解决问题</span>
              <textarea
                rows={7}
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                placeholder="例如：希望在 3 个月内建设企业知识助手，现有资料分散在 Word 和 PDF 中，需要给出 MVP 范围、技术路线和实施计划。"
                minLength={10}
                required
              />
              <small>{request.length} / 至少 10 字</small>
            </label>
          </div>

          <div className="generation-bar">
            <label className="field compact-field">
              <span>模型通道</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value as ModelProvider)}
              >
                {models.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.available}>
                    {item.name}{item.available ? "" : "（未配置）"}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button generate-button" disabled={loading}>
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  正在分析
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  生成{deliverable}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </form>

        <aside className="consult-aside">
          <span className="eyebrow">当前角色</span>
          <h2>{selectedEmployee?.name}</h2>
          <p>{selectedEmployee?.description}</p>
          <div className="aside-block">
            <span>工作能力</span>
            <ul>
              {selectedEmployee?.capabilities.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="aside-block">
            <span>生成过程</span>
            <ol>
              <li>读取咨询背景</li>
              <li>匹配知识条目</li>
              <li>执行角色方法论</li>
              <li>生成结构化成果</li>
            </ol>
          </div>
        </aside>
      </div>

      {result && (
        <MarkdownResult
          content={result.result}
          title={result.deliverable}
          consultation={result}
        />
      )}
    </div>
  );
}
