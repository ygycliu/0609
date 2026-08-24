import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  LoaderCircle,
  Save,
  Trash2,
  User
} from "lucide-react";
import { api, listTransactions } from "../lib/api";

const STATUS_OPTIONS = [
  { value: "active", label: "活跃" },
  { value: "inactive", label: "暂停" },
  { value: "archived", label: "归档" }
];

const STAGE_OPTIONS = [
  { value: "", label: "（未设置）" },
  { value: "潜在", label: "潜在" },
  { value: "接触", label: "接触" },
  { value: "报价", label: "报价" },
  { value: "签约", label: "签约" },
  { value: "服务中", label: "服务中" },
  { value: "续约", label: "续约" },
  { value: "流失", label: "流失" }
];

const SCALE_OPTIONS = [
  { value: "", label: "（未设置）" },
  { value: "微型", label: "微型（< 20 人）" },
  { value: "小型", label: "小型（20-99 人）" },
  { value: "中型", label: "中型（100-499 人）" },
  { value: "大型", label: "大型（≥ 500 人）" }
];

const SOURCE_OPTIONS = [
  { value: "", label: "（未设置）" },
  { value: "老客户介绍", label: "老客户介绍" },
  { value: "招标", label: "招标" },
  { value: "网络推广", label: "网络推广" },
  { value: "地推陌拜", label: "地推陌拜" },
  { value: "商会活动", label: "商会活动" }
];

interface CustomerDetail {
  id?: string;
  customerCode: string;
  name: string;
  industry: string;
  employeeCount: string;
  region: string;
  address: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  creditCode: string;
  scale: string;
  businessScope: string;
  sourceChannel: string;
  serviceStage: string;
  status: string;
  tags: string;
  notes: string;
  source: string;
  satisfactionScore: string;
  totalRevenue: string;
  serviceCount: string;
}

const EMPTY: CustomerDetail = {
  customerCode: "",
  name: "",
  industry: "",
  employeeCount: "",
  region: "",
  address: "",
  contactPerson: "",
  contactPhone: "",
  contactEmail: "",
  creditCode: "",
  scale: "",
  businessScope: "",
  sourceChannel: "",
  serviceStage: "",
  status: "active",
  tags: "",
  notes: "",
  source: "",
  satisfactionScore: "",
  totalRevenue: "",
  serviceCount: "0"
};

export function CustomerDetailPage({
  customerId,
  onBack,
  onChanged
}: {
  customerId: string | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const isNew = customerId === null;
  const [form, setForm] = useState<CustomerDetail>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [projects, setProjects] = useState<Array<{
    id: string;
    projectCode: string;
    name: string;
    status: string;
    contractAmount: number;
    startedAt: string | null;
    completedAt: string | null;
    notes: string | null;
  }>>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [projectsAmount, setProjectsAmount] = useState(0);

  useEffect(() => {
    if (customerId === null) {
      // 新建：自动生成客户编号
      const next = `CUST-${new Date().getFullYear()}-${String(
        Math.floor(Math.random() * 9000) + 1000
      )}`;
      setForm({ ...EMPTY, customerCode: next });
      setError("");
      setSuccess("");
      return;
    }
    setLoading(true);
    setError("");
    api
      .getCustomer(customerId)
      .then((data) => {
        setForm({
          customerCode: data.customerCode ?? "",
          name: data.name ?? "",
          industry: data.industry ?? "",
          employeeCount: data.employeeCount ? String(data.employeeCount) : "",
          region: data.region ?? "",
          address: data.address ?? "",
          contactPerson: data.contactPerson ?? "",
          contactPhone: data.contactPhone ?? "",
          contactEmail: data.contactEmail ?? "",
          creditCode: data.creditCode ?? "",
          scale: data.scale ?? "",
          businessScope: data.businessScope ?? "",
          sourceChannel: data.sourceChannel ?? "",
          serviceStage: data.serviceStage ?? "",
          status: data.status ?? "active",
          tags: Array.isArray(data.tags) ? data.tags.join(", ") : "",
          notes: data.notes ?? "",
          source: data.source ?? "",
          satisfactionScore: data.satisfactionScore ? String(data.satisfactionScore) : "",
          totalRevenue: data.totalRevenue ? String(data.totalRevenue) : "",
          serviceCount: data.serviceCount != null ? String(data.serviceCount) : "0"
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [customerId]);

  function setField<K extends keyof CustomerDetail>(key: K, value: CustomerDetail[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // 加载客户的项目（历史认证）
  useEffect(() => {
    if (customerId === null) {
      setProjects([]);
      return;
    }
    setProjectsLoading(true);
    api.listProjects({ customer_id: customerId, limit: 100 })
      .then((r) => {
        setProjects(r.data || []);
        setProjectsTotal(r.total || 0);
        const sum = (r.data || []).reduce(
          (s: number, p: any) => s + Number(p.contractAmount || 0),
          0
        );
        setProjectsAmount(sum);
      })
      .catch(() => {
        setProjects([]);
        setProjectsTotal(0);
        setProjectsAmount(0);
      })
      .finally(() => setProjectsLoading(false));
  }, [customerId]);

  async function handleSave() {
    if (!form.name.trim()) {
      setError("客户名称不能为空");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");

    const payload: Record<string, unknown> = {
      customerCode: form.customerCode.trim(),
      name: form.name.trim(),
      industry: form.industry.trim() || null,
      employeeCount: form.employeeCount ? Number(form.employeeCount) : null,
      region: form.region.trim() || null,
      address: form.address.trim() || null,
      contactPerson: form.contactPerson.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      creditCode: form.creditCode.trim() || null,
      scale: form.scale || null,
      businessScope: form.businessScope.trim() || null,
      sourceChannel: form.sourceChannel || null,
      serviceStage: form.serviceStage || null,
      status: form.status,
      tags: form.tags
        ? form.tags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      notes: form.notes.trim() || null,
      source: form.source.trim() || null,
      satisfactionScore: form.satisfactionScore ? Number(form.satisfactionScore) : null
    };

    try {
      if (isNew) {
        await api.createCustomer(payload);
        setSuccess("已创建客户");
        setTimeout(onChanged, 600);
      } else {
        await api.updateCustomer(customerId!, payload);
        setSuccess("已保存修改");
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    if (!window.confirm(`确认删除客户「${form.name}」？此操作不可撤销。`)) return;
    setSaving(true);
    try {
      await api.deleteCustomer(customerId!);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (isNew || !customerId) return;
    const nextStatus = form.status === "archived" ? "active" : "archived";
    const verb = nextStatus === "archived" ? "归档" : "恢复";
    if (!window.confirm(`确认${verb}客户「${form.name}」？`)) return;
    setSaving(true);
    setError("");
    try {
      await api.updateCustomer(customerId, { status: nextStatus });
      setForm((prev) => ({ ...prev, status: nextStatus }));
      setSuccess(`${verb}成功`);
      setTimeout(() => setSuccess(""), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${verb}失败`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-row">
        <LoaderCircle className="spin" size={20} /> 正在加载客户...
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <button className="ghost-button back-btn" onClick={onBack}>
            <ArrowLeft size={16} /> 返回列表
          </button>
          <h1>{isNew ? "新建客户" : form.name || "客户详情"}</h1>
          {!isNew && <p className="muted">客户编号 {form.customerCode}</p>}
        </div>
        <div className="header-actions">
          {!isNew && (
            <>
              <button
                className="ghost-button"
                onClick={handleArchiveToggle}
                disabled={saving}
                type="button"
                title={form.status === "archived" ? "恢复为活跃" : "归档此客户"}
              >
                {form.status === "archived" ? <Check size={16} /> : <Archive size={16} />}
                {form.status === "archived" ? "恢复" : "归档"}
              </button>
              <button
                className="danger-button"
                onClick={handleDelete}
                disabled={saving}
                type="button"
              >
                <Trash2 size={16} /> 删除
              </button>
            </>
          )}
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={saving}
            type="button"
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
            保存
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {success && (
        <div className="success-banner">
          <Check size={16} /> {success}
        </div>
      )}

      <section className="customer-form">
        <fieldset>
          <legend>基本信息</legend>
          <div className="form-grid two-col">
            <label className="field">
              <span>客户编号 *</span>
              <input
                value={form.customerCode}
                onChange={(e) => setField("customerCode", e.target.value)}
              />
            </label>
            <label className="field">
              <span>客户名称 *</span>
              <input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>行业</span>
              <input
                value={form.industry}
                onChange={(e) => setField("industry", e.target.value)}
                placeholder="如：化工 / 制造 / 食品"
              />
            </label>
            <label className="field">
              <span>企业规模</span>
              <select
                value={form.scale}
                onChange={(e) => setField("scale", e.target.value)}
              >
                {SCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>员工人数</span>
              <input
                type="number"
                value={form.employeeCount}
                onChange={(e) => setField("employeeCount", e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>统一社会信用代码</span>
              <input
                value={form.creditCode}
                onChange={(e) => setField("creditCode", e.target.value)}
                placeholder="91xxxx..."
              />
            </label>
            <label className="field full">
              <span>经营范围</span>
              <input
                value={form.businessScope}
                onChange={(e) => setField("businessScope", e.target.value)}
              />
            </label>
            <label className="field full">
              <span>地址</span>
              <input
                value={form.address}
                onChange={(e) => setField("address", e.target.value)}
              />
            </label>
            <label className="field">
              <span>所在区域</span>
              <input
                value={form.region}
                onChange={(e) => setField("region", e.target.value)}
                placeholder="省/市"
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <User size={16} /> 联系信息
          </legend>
          <div className="form-grid two-col">
            <label className="field">
              <span>联系人</span>
              <input
                value={form.contactPerson}
                onChange={(e) => setField("contactPerson", e.target.value)}
              />
            </label>
            <label className="field">
              <span>联系电话</span>
              <input
                value={form.contactPhone}
                onChange={(e) => setField("contactPhone", e.target.value)}
              />
            </label>
            <label className="field full">
              <span>邮箱</span>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setField("contactEmail", e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>业务信息</legend>
          <div className="form-grid two-col">
            <label className="field">
              <span>服务阶段</span>
              <select
                value={form.serviceStage}
                onChange={(e) => setField("serviceStage", e.target.value)}
              >
                {STAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>状态</span>
              <select
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>获客渠道</span>
              <select
                value={form.sourceChannel}
                onChange={(e) => setField("sourceChannel", e.target.value)}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>客户来源备注</span>
              <input
                value={form.source}
                onChange={(e) => setField("source", e.target.value)}
                placeholder="如：老客户张总介绍"
              />
            </label>
            <label className="field">
              <span>累计营收（¥）</span>
              <input
                type="number"
                value={form.totalRevenue}
                onChange={(e) => setField("totalRevenue", e.target.value)}
              />
            </label>
            <label className="field">
              <span>服务次数</span>
              <input
                type="number"
                value={form.serviceCount}
                onChange={(e) => setField("serviceCount", e.target.value)}
              />
            </label>
            <label className="field">
              <span>满意度评分（1-5）</span>
              <input
                type="number"
                min="1"
                max="5"
                value={form.satisfactionScore}
                onChange={(e) => setField("satisfactionScore", e.target.value)}
              />
            </label>
            <label className="field full">
              <span>标签（逗号分隔）</span>
              <input
                value={form.tags}
                onChange={(e) => setField("tags", e.target.value)}
                placeholder="VIP, 化工, 长三角"
              />
            </label>
            <label className="field full">
              <span>备注</span>
              <textarea
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </fieldset>

        {/* 历史认证项目子表（来自 finance_project）*/}
        {!isNew && (
          <fieldset className="form-section">
            <legend>
              <span className="legend-icon">📜</span> 历史认证项目
              <span className="legend-meta">
                {projectsTotal > 0 && `· ${projectsTotal} 个项目 / 合计 ¥${projectsAmount.toLocaleString()}`}
              </span>
            </legend>
            <div className="cert-history">
              {projectsLoading ? (
                <div className="loading-row">
                  <LoaderCircle className="spin" size={18} /> 加载认证历史...
                </div>
              ) : projects.length === 0 ? (
                <div className="empty-row">
                  <span className="muted">该客户暂无历史认证项目</span>
                  <small>可从财务流水或项目管理中创建</small>
                </div>
              ) : (
                <table className="cert-history-table">
                  <thead>
                    <tr>
                      <th>项目编号</th>
                      <th>认证项目</th>
                      <th>认证金额</th>
                      <th>起始日期</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => {
                      // 名称格式："客户名 | 描述"
                      const parts = (p.name || "").split(" | ");
                      const certName = parts.length > 1 ? parts.slice(1).join(" | ") : p.name;
                      return (
                        <tr key={p.id}>
                          <td className="mono">{p.projectCode}</td>
                          <td>
                            <strong>{certName}</strong>
                            {p.notes && (
                              <small className="muted">{p.notes}</small>
                            )}
                          </td>
                          <td className="amount">
                            ¥{Number(p.contractAmount || 0).toLocaleString()}
                          </td>
                          <td className="mono">
                            {p.startedAt
                              ? new Date(p.startedAt).toLocaleDateString("zh-CN")
                              : "—"}
                          </td>
                          <td>
                            <span className={`status-pill status-${p.status === "completed" ? "completed" : p.status === "in_progress" ? "active" : "default"}`}>
                              {p.status === "completed" ? "已完成"
                                : p.status === "in_progress" ? "进行中"
                                : p.status === "cancelled" ? "已取消"
                                : p.status || "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {projects.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="mono">合计</td>
                        <td className="amount"><strong>¥{projectsAmount.toLocaleString()}</strong></td>
                        <td colSpan={2} className="muted">{projectsTotal} 个项目</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </fieldset>
        )}
      </section>
    </div>
  );
}