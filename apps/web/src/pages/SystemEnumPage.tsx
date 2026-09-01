/**
 * V2.0 系统基础数据管理页面
 *
 * 四个 Tab：
 * 1. 签约主体（signing_entity）- A/B/C 主体
 * 2. 外协单位（partner_cert_unit）- 动态外协认证机构
 * 3. 风险等级（risk_level）- low/medium/high/extreme + 倍率
 * 4. 单位信息（customer）- 客户管理，支持导出/导入 CSV
 *
 * 每个 Tab 支持：新增、编辑、删除
 * 单位信息额外支持：CSV 导出/导入
 */

import { useEffect, useState, useRef } from "react";
import { Plus, Trash2, Edit3, Save, X, AlertTriangle, Download, Upload } from "lucide-react";
import { api } from "../lib/api";
import { ToastManager } from "../components/Toast";

type EnumType = "signing" | "partner" | "risk" | "customer";

export function SystemEnumPage() {
  const [activeTab, setActiveTab] = useState<EnumType>("signing");

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">工具 · 系统配置</span>
          <h1>系统基础数据</h1>
          <p>管理签约主体、外协认证单位、风险等级等业务基础数据。所有改动会立即影响新建项目。</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="enum-tabs">
        {[
          { key: "signing" as EnumType, label: "🏢 签约主体", desc: "A/B/C 主体" },
          { key: "partner" as EnumType, label: "🤝 外协单位", desc: "外协认证机构" },
          { key: "risk" as EnumType, label: "⚠️ 风险等级", desc: "审核员等级 + 倍率" },
          { key: "customer" as EnumType, label: "🏛️ 单位信息", desc: "客户列表 + 导出/导入" }
        ].map((t) => (
          <button
            key={t.key}
            className={activeTab === t.key ? "enum-tab active" : "enum-tab"}
            onClick={() => setActiveTab(t.key)}
          >
            <strong>{t.label}</strong>
            <small>{t.desc}</small>
          </button>
        ))}
      </div>

      {activeTab === "signing" && <SigningEntityTab />}
      {activeTab === "partner" && <PartnerTab />}
      {activeTab === "risk" && <RiskLevelTab />}
      {activeTab === "customer" && <CustomerUnitTab />}
    </div>
  );
}

/* ============== 签约主体 ============== */

interface SigningEntity {
  id: string;
  entity_code: string;
  name: string;
  short_name?: string;
  contact_person?: string;
  contact_phone?: string;
  address?: string;
  status: string;
  notes?: string;
}

function SigningEntityTab() {
  const [items, setItems] = useState<SigningEntity[]>([]);
  const [editing, setEditing] = useState<SigningEntity | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.listSigningEntities()
      .then((data) => setItems(data || []))
      .catch(() => setItems([]));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除？删除后已用此主体的项目不受影响。")) return;
    await api.deleteSigningEntity(id);
    load();
  };

  return (
    <div className="enum-panel">
      <div className="panel-header">
        <h2>签约主体列表（{items.length}）</h2>
        <button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> 新增签约主体
        </button>
      </div>

      {showForm && (
        <SigningEntityForm
          initial={editing || undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>简称</th>
            <th>联系人</th>
            <th>电话</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td><code>{it.entity_code}</code></td>
              <td>{it.name}</td>
              <td>{it.short_name || "—"}</td>
              <td>{it.contact_person || "—"}</td>
              <td>{it.contact_phone || "—"}</td>
              <td>
                <span className={`status-pill status-${it.status === "active" ? "completed" : "cancelled"}`}>
                  {it.status === "active" ? "启用" : "停用"}
                </span>
              </td>
              <td>
                <button className="ghost-icon" onClick={() => { setEditing(it); setShowForm(true); }} title="编辑">
                  <Edit3 size={15} />
                </button>
                <button className="ghost-icon danger" onClick={() => handleDelete(it.id)} title="删除">
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={7} className="muted center">暂无数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SigningEntityForm({ initial, onClose, onSaved }: {
  initial?: SigningEntity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    entity_code: initial?.entity_code ?? "",
    name: initial?.name ?? "",
    short_name: initial?.short_name ?? "",
    contact_person: initial?.contact_person ?? "",
    contact_phone: initial?.contact_phone ?? "",
    address: initial?.address ?? "",
    status: initial?.status ?? "active",
    notes: initial?.notes ?? ""
  });

  const handleSave = async () => {
    if (!form.entity_code || !form.name) {
      alert("代码和名称必填");
      return;
    }
    if (initial) {
      await api.updateSigningEntity(initial.id, form);
    } else {
      await api.createSigningEntity(form);
    }
    onSaved();
  };

  return (
    <div className="enum-form">
      <h3>{initial ? "编辑签约主体" : "新增签约主体"}</h3>
      <div className="form-grid">
        <label>
          <span>代码 *</span>
          <input value={form.entity_code} onChange={(e) => setForm({...form, entity_code: e.target.value.toUpperCase()})} placeholder="A / B / C" />
        </label>
        <label>
          <span>名称 *</span>
          <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="华中国际认证..." />
        </label>
        <label>
          <span>简称</span>
          <input value={form.short_name} onChange={(e) => setForm({...form, short_name: e.target.value})} />
        </label>
        <label>
          <span>联系人</span>
          <input value={form.contact_person} onChange={(e) => setForm({...form, contact_person: e.target.value})} />
        </label>
        <label>
          <span>电话</span>
          <input value={form.contact_phone} onChange={(e) => setForm({...form, contact_phone: e.target.value})} />
        </label>
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </label>
        <label className="full-width">
          <span>备注</span>
          <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
        </label>
      </div>
      <div className="form-actions">
        <button className="ghost-button" onClick={onClose}><X size={16} /> 取消</button>
        <button className="primary-button" onClick={handleSave}><Save size={16} /> 保存</button>
      </div>
    </div>
  );
}

/* ============== 外协单位 ============== */

interface Partner {
  id: string;
  name: string;
  contact_name?: string;
  contact_phone?: string;
  address?: string;
  status: string;
  remark?: string;
}

function PartnerTab() {
  const [items, setItems] = useState<Partner[]>([]);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.listPartners()
      .then((data) => setItems(data || []))
      .catch(() => setItems([]));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除此外协单位？")) return;
    await api.deletePartner(id);
    load();
  };

  return (
    <div className="enum-panel">
      <div className="panel-header">
        <h2>外协单位列表（{items.length}）</h2>
        <button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> 新增外协单位
        </button>
      </div>

      {showForm && (
        <PartnerForm
          initial={editing || undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>联系人</th>
            <th>电话</th>
            <th>地址</th>
            <th>状态</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{it.name}</td>
              <td>{it.contact_name || "—"}</td>
              <td>{it.contact_phone || "—"}</td>
              <td>{it.address || "—"}</td>
              <td>
                <span className={`status-pill status-${it.status === "active" ? "completed" : "cancelled"}`}>
                  {it.status === "active" ? "启用" : "停用"}
                </span>
              </td>
              <td>{it.remark || "—"}</td>
              <td>
                <button className="ghost-icon" onClick={() => { setEditing(it); setShowForm(true); }} title="编辑">
                  <Edit3 size={15} />
                </button>
                <button className="ghost-icon danger" onClick={() => handleDelete(it.id)} title="删除">
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={7} className="muted center">暂无数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PartnerForm({ initial, onClose, onSaved }: {
  initial?: Partner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    contact_name: initial?.contact_name ?? "",
    contact_phone: initial?.contact_phone ?? "",
    address: initial?.address ?? "",
    status: initial?.status ?? "active",
    remark: initial?.remark ?? ""
  });

  const handleSave = async () => {
    if (!form.name) {
      alert("名称必填");
      return;
    }
    if (initial) {
      await api.updatePartner(initial.id, form);
    } else {
      await api.createPartner(form);
    }
    onSaved();
  };

  return (
    <div className="enum-form">
      <h3>{initial ? "编辑外协单位" : "新增外协单位"}</h3>
      <div className="form-grid">
        <label className="full-width">
          <span>名称 *</span>
          <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="中质认证..." />
        </label>
        <label>
          <span>联系人</span>
          <input value={form.contact_name} onChange={(e) => setForm({...form, contact_name: e.target.value})} />
        </label>
        <label>
          <span>电话</span>
          <input value={form.contact_phone} onChange={(e) => setForm({...form, contact_phone: e.target.value})} />
        </label>
        <label className="full-width">
          <span>地址</span>
          <input value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} />
        </label>
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </label>
        <label className="full-width">
          <span>备注</span>
          <textarea value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})} />
        </label>
      </div>
      <div className="form-actions">
        <button className="ghost-button" onClick={onClose}><X size={16} /> 取消</button>
        <button className="primary-button" onClick={handleSave}><Save size={16} /> 保存</button>
      </div>
    </div>
  );
}

/* ============== 风险等级 ============== */

interface RiskLevel {
  id: string;
  code: string;
  label: string;
  description?: string;
  auditor_level: string;
  multiplier: number;
  sort_order: number;
  status: string;
}

function RiskLevelTab() {
  const [items, setItems] = useState<RiskLevel[]>([]);
  const [editing, setEditing] = useState<RiskLevel | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.listRiskLevels()
      .then((data) => setItems(data || []))
      .catch(() => setItems([]));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除此风险等级？已用此等级的项目不受影响。")) return;
    await api.deleteRiskLevel(id);
    load();
  };

  return (
    <div className="enum-panel">
      <div className="panel-header">
        <h2>风险等级列表（{items.length}）</h2>
        <button className="primary-button" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> 新增风险等级
        </button>
      </div>

      {showForm && (
        <RiskLevelForm
          initial={editing || undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>审核员级别</th>
            <th>费率倍率</th>
            <th>排序</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td><code>{it.code}</code></td>
              <td>
                {it.label}
                {it.description && <div className="muted small">{it.description}</div>}
              </td>
              <td>
                <span className={`status-pill ${it.auditor_level === "senior" ? "status-cert_pending" : "status-completed"}`}>
                  {it.auditor_level === "senior" ? "高级审核员" : "中级审核员"}
                </span>
              </td>
              <td><strong>×{Number(it.multiplier).toFixed(2)}</strong></td>
              <td>{it.sort_order}</td>
              <td>
                <span className={`status-pill status-${it.status === "active" ? "completed" : "cancelled"}`}>
                  {it.status === "active" ? "启用" : "停用"}
                </span>
              </td>
              <td>
                <button className="ghost-icon" onClick={() => { setEditing(it); setShowForm(true); }} title="编辑">
                  <Edit3 size={15} />
                </button>
                <button className="ghost-icon danger" onClick={() => handleDelete(it.id)} title="删除">
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={7} className="muted center">暂无数据</td></tr>
          )}
        </tbody>
      </table>

      <div className="enum-tip">
        <AlertTriangle size={16} />
        <p>风险等级会用于认证报价的费率计算（multiplier × 基础价）。修改后只影响新报价，已生成的报价不受影响。</p>
      </div>
    </div>
  );
}

function RiskLevelForm({ initial, onClose, onSaved }: {
  initial?: RiskLevel;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    label: initial?.label ?? "",
    description: initial?.description ?? "",
    auditor_level: initial?.auditor_level ?? "intermediate",
    multiplier: initial?.multiplier ?? 1.0,
    sort_order: initial?.sort_order ?? 0,
    status: initial?.status ?? "active"
  });

  const handleSave = async () => {
    if (!form.code || !form.label) {
      alert("代码和名称必填");
      return;
    }
    if (initial) {
      await api.updateRiskLevel(initial.id, form);
    } else {
      await api.createRiskLevel(form);
    }
    onSaved();
  };

  return (
    <div className="enum-form">
      <h3>{initial ? "编辑风险等级" : "新增风险等级"}</h3>
      <div className="form-grid">
        <label>
          <span>代码 *</span>
          <input value={form.code} onChange={(e) => setForm({...form, code: e.target.value.toLowerCase()})} placeholder="low / medium / high" />
        </label>
        <label>
          <span>名称 *</span>
          <input value={form.label} onChange={(e) => setForm({...form, label: e.target.value})} placeholder="低级风险" />
        </label>
        <label className="full-width">
          <span>描述</span>
          <input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="适用行业..." />
        </label>
        <label>
          <span>审核员级别</span>
          <select value={form.auditor_level} onChange={(e) => setForm({...form, auditor_level: e.target.value})}>
            <option value="intermediate">中级审核员</option>
            <option value="senior">高级审核员</option>
          </select>
        </label>
        <label>
          <span>费率倍率</span>
          <input type="number" step="0.01" value={form.multiplier} onChange={(e) => setForm({...form, multiplier: parseFloat(e.target.value) || 1})} />
        </label>
        <label>
          <span>排序</span>
          <input type="number" value={form.sort_order} onChange={(e) => setForm({...form, sort_order: parseInt(e.target.value) || 0})} />
        </label>
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="ghost-button" onClick={onClose}><X size={16} /> 取消</button>
        <button className="primary-button" onClick={handleSave}><Save size={16} /> 保存</button>
      </div>
    </div>
  );
}


// ============================================================
// V2.1：单位信息 Tab（customer 表的 CSV 导入导出）
// ============================================================
function CustomerUnitTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("");
  const [importResult, setImportResult] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await api.searchCustomers(filter.trim(), 100);
      // searchCustomers 已被 request 解包 data 字段，r 直接是数组
      setItems(Array.isArray(r) ? r : []);
    } catch (e) {
      ToastManager.error(`加载失败：${(e as any)?.message ?? "未知错误"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.exportCustomers({
        q: filter.trim() || undefined
      });
      if (!response.ok) throw new Error(`导出失败: ${response.status}`);

      const disposition = response.headers.get("content-disposition") || "";
      const m = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const filename = m ? decodeURIComponent(m[1]) : `单位信息_${new Date().toISOString().slice(0, 10)}.csv`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      ToastManager.success(`✅ 已导出 ${items.length} 条单位信息`);
    } catch (e) {
      ToastManager.error(`导出失败：${(e as any)?.message ?? "未知错误"}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      ToastManager.error("❌ 请选择 .csv 文件");
      e.target.value = "";
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const r: any = await api.importCustomers(text);
      // importCustomers 已被 request 解包 data 字段，r 直接是结果对象
      const data = r && r.total !== undefined ? r : { total: 0, inserted: 0, updated: 0, failed: 0, errors: [] };
      setImportResult(data);
      ToastManager.success(
        `✅ 导入完成：新建 ${data.inserted}，更新 ${data.updated}，失败 ${data.failed}`
      );
      await load();
    } catch (err: any) {
      ToastManager.error(`导入失败：${err?.message ?? "未知错误"}`);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="enum-panel">
      <div className="panel-header">
        <h2>单位信息列表（{items.length}）</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="ghost-button" onClick={handleExport} disabled={exporting}>
            <Download size={16} /> {exporting ? "导出中..." : "导出 CSV"}
          </button>
          <button className="primary-button" onClick={handleImportClick} disabled={importing}>
            <Upload size={16} /> {importing ? "导入中..." : "导入 CSV"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelected}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* 导入结果展示 */}
      {importResult && (
        <div className="import-result-banner">
          <strong>📥 上次导入结果：</strong>
          <span className="ok">新建 {importResult.inserted}</span> ·{" "}
          <span className="info">更新 {importResult.updated}</span> ·{" "}
          <span className={importResult.failed > 0 ? "err" : "muted"}>失败 {importResult.failed}</span>
          <small> · 共 {importResult.total} 行</small>
          {importResult.errors && importResult.errors.length > 0 && (
            <details>
              <summary>查看错误详情（前 {Math.min(50, importResult.errors.length)} 条）</summary>
              <pre>{importResult.errors.map((e: any) =>
                `第 ${e.row} 行: ${e.reason}`
              ).join("\n")}</pre>
            </details>
          )}
        </div>
      )}

      {/* 搜索 */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="按客户名称搜索..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
        />
        <button className="ghost-button tiny" onClick={load} disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </button>
      </div>

      {/* 列表 */}
      <table className="data-table">
        <thead>
          <tr>
            <th>客户编号</th>
            <th>客户名称</th>
            <th>行业</th>
            <th>地区</th>
            <th>联系人</th>
            <th>电话</th>
            <th>信用代码</th>
            <th>状态</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={9} style={{ textAlign: "center", padding: "20px" }}>加载中...</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: "center", padding: "20px", color: "#94a3b8" }}>暂无单位信息</td></tr>
          ) : (
            items.map((c: any) => (
              <tr key={c.id}>
                <td><code>{c.customer_code || "—"}</code></td>
                <td><strong>{c.name}</strong></td>
                <td>{c.industry || "—"}</td>
                <td>{c.region || "—"}</td>
                <td>{c.contact_person || "—"}</td>
                <td>{c.contact_phone || "—"}</td>
                <td><code className="small">{c.credit_code || "—"}</code></td>
                <td><span className={`status-pill status-${c.status}`}>{c.status}</span></td>
                <td className="muted small">{c.created_at?.slice(0, 10) || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="muted small" style={{ marginTop: "12px" }}>
        💡 提示：导入 CSV 时按"客户名称"匹配：同名则更新，否则新建。必填列：<code>客户名称</code>。
        可选列：<code>客户编号 / 行业 / 地区 / 联系人 / 电话 / 邮箱 / 信用代码 / 地址 / 业务范围 / 标签 / 备注</code>。
      </div>
    </div>
  );
}
