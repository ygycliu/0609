/**
 * V2.0 财务交易录入表单
 *
 * 支持：
 * - 收入/支出切换
 * - 客户/项目下拉
 * - 分类自动建议（按 type）
 * - 提交后回调刷新
 */

import { useEffect, useState } from "react";
import { X, Save, LoaderCircle } from "lucide-react";
import { api } from "../lib/api";

interface TransactionFormProps {
  /** 弹窗关闭回调 */
  onClose: () => void;
  /** 提交成功回调 */
  onSuccess: () => void;
  /** 默认类型 */
  defaultType?: "income" | "expense";
}

/** V2.0 默认分类建议（按 type）*/
const DEFAULT_CATEGORIES: Record<"income" | "expense", string[]> = {
  income: [
    "认证费收入",
    "咨询服务收入",
    "审核费收入",
    "培训收入",
    "检测费收入",
    "其他收入"
  ],
  expense: [
    "审核员差旅",
    "审核员工资",
    "办公费",
    "市场推广",
    "房租水电",
    "其他支出"
  ]
};

export function TransactionForm({ onClose, onSuccess, defaultType = "income" }: TransactionFormProps) {
  const [type, setType] = useState<"income" | "expense">(defaultType);
  const [transDate, setTransDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[defaultType][0]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 下拉数据
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; projectCode: string; name?: string }>>([]);
  const [loadingDeps, setLoadingDeps] = useState(true);

  useEffect(() => {
    setLoadingDeps(true);
    Promise.all([
      api.listCustomers({ limit: 200 }).catch(() => ({ data: [] })),
      api.listProjects({ limit: 200 }).catch(() => ({ data: [] }))
    ])
      .then(([custs, projs]: any) => {
        // listCustomers 响应处理
        const cs = Array.isArray(custs) ? custs : (custs?.data?.items || custs?.data || []);
        const customerList = (cs as any[]).map((c: any) => ({
          id: c.id ?? c.customerId,
          name: c.name ?? c.customerName ?? "未命名客户"
        }));
        setCustomers(customerList);

        // listProjects 响应处理
        const ps = Array.isArray(projs) ? projs : (projs?.data || []);
        const projectList = (ps as any[]).map((p: any) => ({
          id: p.id,
          projectCode: p.projectCode ?? p.code ?? "",
          name: p.name ?? p.projectName ?? ""
        }));
        setProjects(projectList);
      })
      .finally(() => setLoadingDeps(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError("请填写有效的金额");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.createTransaction({
        type,
        transDate,
        category,
        amount: Number(amount),
        description,
        customerId: customerId || null,
        projectId: projectId || null
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 类型切换时重置分类
  useEffect(() => {
    if (!DEFAULT_CATEGORIES[type].includes(category)) {
      setCategory(DEFAULT_CATEGORIES[type][0]);
    }
  }, [type, category]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal transaction-form-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{type === "income" ? "➕ 新增收入" : "➖ 新增支出"}</h3>
          <button className="ghost-icon" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        <form className="modal-body transaction-form-body" onSubmit={handleSubmit}>
          {/* 类型切换 */}
          <div className="type-toggle-group">
            <button
              type="button"
              className={`type-toggle-btn income ${type === "income" ? "active" : ""}`}
              onClick={() => setType("income")}
            >
              💰 收入
            </button>
            <button
              type="button"
              className={`type-toggle-btn expense ${type === "expense" ? "active" : ""}`}
              onClick={() => setType("expense")}
            >
              💸 支出
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="form-grid">
            <label className="field">
              <span>日期 *</span>
              <input
                type="date"
                value={transDate}
                onChange={(e) => setTransDate(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>分类 *</span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list={`category-suggestions-${type}`}
                required
                placeholder="如：认证费收入"
              />
              <datalist id={`category-suggestions-${type}`}>
                {DEFAULT_CATEGORIES[type].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="field">
              <span>金额 *（元）</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                placeholder="0.00"
              />
            </label>

            <label className="field">
              <span>关联客户（可选）</span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={loadingDeps}
              >
                <option value="">未关联</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>关联项目（可选）</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={loadingDeps}
              >
                <option value="">未关联</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} {p.name ? `· ${p.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field full">
            <span>描述 / 备注</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="例如：QES 三体系初次认证 / 评审员差旅 6.1-6.3"
            />
          </label>

          <footer className="modal-footer">
            <span className="muted small">
              ⚠️ 提交后即时入账，会影响 KPI 和应收统计
            </span>
            <div className="form-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={submitting || !amount}
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="spin" size={16} />
                    提交中...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    保存入账
                  </>
                )}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}