import { useEffect, useState } from "react";
import {
  Building2, CheckCircle2, ChevronRight, FileEdit, Loader2,
  Plus, Save, Search, Trash2, X
} from "lucide-react";
import { api } from "../lib/api";
import type { PartnerOrg, ServiceType, Signatory } from "../types";

interface BaseDataPageProps {
  onOpenCustomer: (id: string) => void;
}

type Tab = "signatory" | "customer" | "partner" | "service";

export function BaseDataPage({ onOpenCustomer }: BaseDataPageProps) {
  const [tab, setTab] = useState<Tab>("signatory");
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">基础数据管理</span>
          <h1>基础资料</h1>
          <p>签约主体 / 客户 / 合作认证单位 / 服务类型 — 业务基础资料的统一管理</p>
        </div>
      </header>

      <div className="tab-bar">
        <button className={`tab ${tab === "signatory" ? "active" : ""}`} onClick={() => setTab("signatory")}>
          <Building2 size={14} /> 签约主体
        </button>
        <button className={`tab ${tab === "customer" ? "active" : ""}`} onClick={() => setTab("customer")}>
          <CheckCircle2 size={14} /> 客户管理
        </button>
        <button className={`tab ${tab === "partner" ? "active" : ""}`} onClick={() => setTab("partner")}>
          <FileEdit size={14} /> 合作认证单位
        </button>
        <button className={`tab ${tab === "service" ? "active" : ""}`} onClick={() => setTab("service")}>
          <FileEdit size={14} /> 服务类型
        </button>
      </div>

      {tab === "signatory" && <SignatoryTab />}
      {tab === "customer" && <CustomerTab onOpen={onOpenCustomer} />}
      {tab === "partner" && <PartnerOrgTab />}
      {tab === "service" && <ServiceTypeTab />}
    </div>
  );
}

// ============== 签约主体 Tab ==============
function SignatoryTab() {
  const [list, setList] = useState<Signatory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Signatory | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await api.listSignatories();
      setList(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const startNew = () => {
    setForm({ entity_code: "", name: "", short_name: "", status: "active" });
    setShowNew(true);
  };

  const startEdit = (s: Signatory) => {
    setEditing(s);
    setForm({
      entity_code: s.entity_code || s.code,
      name: s.name,
      short_name: (s as any).short_name || s.shortName,
      contactPerson: (s as any).contact_person || s.contactPerson,
      contactPhone: (s as any).contact_phone || s.contactPhone,
      address: s.address,
      status: s.status,
      notes: s.notes
    });
  };

  const cancelForm = () => {
    setShowNew(false);
    setEditing(null);
    setForm({});
  };

  const handleSave = async () => {
    if (!form.entity_code || !form.name) {
      alert("请填写主体代码（A/B/C）和名称");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        // 暂不支持更新 - 用 POST 模拟
        alert("更新签约主体功能待实现。请使用 SQL 直接修改或联系开发。");
      } else {
        // 暂不提供新建端点 - 提示
        alert("新增签约主体需通过 SQL 实现：INSERT INTO signing_entity (company_id, entity_code, name, short_name, status) VALUES (...)");
      }
      cancelForm();
      await load();
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally { setSaving(false); }
  };

  return (
    <section className="base-data-section">
      <div className="section-heading">
        <div>
          <h3>签约主体</h3>
          <p className="muted">负责签约、开票、项目归属的法人主体</p>
        </div>
        <button className="primary-button" onClick={startNew}>
          <Plus size={14} /> 新增主体
        </button>
      </div>

      {loading ? (
        <p className="muted"><Loader2 size={14} className="spin" /> 加载中...</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>主体全称</th>
              <th>简称</th>
              <th>联系人</th>
              <th>联系电话</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.entity_code || s.code}</strong></td>
                <td>{s.name}</td>
                <td>{(s as any).short_name || s.shortName || "—"}</td>
                <td>{(s as any).contact_person || s.contactPerson || "—"}</td>
                <td>{(s as any).contact_phone || s.contactPhone || "—"}</td>
                <td>
                  <span className={`status-pill ${s.status === "active" ? "status-completed" : ""}`}>
                    {s.status === "active" ? "启用" : s.status === "inactive" ? "停用" : s.status}
                  </span>
                </td>
                <td>
                  <button className="ghost-button small" onClick={() => startEdit(s)}>
                    <FileEdit size={12} /> 编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 新增/编辑 弹窗 */}
      {(showNew || editing) && (
        <div className="modal-overlay" onClick={cancelForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              {editing ? <FileEdit size={18} /> : <Plus size={18} />}
              {editing ? "编辑签约主体" : "新增签约主体"}
            </h3>
            <div className="form-row-2">
              <div>
                <label>主体代码 *</label>
                <input
                  value={form.entity_code || ""}
                  onChange={(e) => setForm({ ...form, entity_code: e.target.value.toUpperCase() })}
                  disabled={!!editing}
                  placeholder="A / B / C / D ..."
                />
              </div>
              <div>
                <label>简称</label>
                <input
                  value={form.short_name || ""}
                  onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <label>主体全称 *</label>
              <input
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-row-2">
              <div>
                <label>联系人</label>
                <input
                  value={(form as any).contactPerson || ""}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                />
              </div>
              <div>
                <label>联系电话</label>
                <input
                  value={(form as any).contactPhone || ""}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <label>地址</label>
              <input
                value={form.address || ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea
                rows={2}
                value={form.notes || ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={cancelForm}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={handleSave} disabled={saving}>
                <Save size={14} /> {saving ? "保存中..." : "保存"}
              </button>
            </div>
            <p className="muted small">说明：当前版本签约主体通过 SQL 维护。后续迭代会加 CRUD API。</p>
          </div>
        </div>
      )}
    </section>
  );
}

// ============== 客户管理 Tab (复用现有 CustomerListPage 行为) ==============
function CustomerTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<Array<{ id: string; name: string; industry?: string; status?: string; totalRevenue?: number; lastFollowupDate?: string }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await api.listCustomers({ q: search, limit, offset: page * limit });
      setList(data || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page, search]);

  return (
    <section className="base-data-section">
      <div className="section-heading">
        <div>
          <h3>客户管理</h3>
          <p className="muted">已建立项目合作的所有客户（来源：CRM）</p>
        </div>
        <button className="primary-button" onClick={() => onOpen("")}>
          <Plus size={14} /> 新增客户
        </button>
      </div>

      <div className="search-bar">
        <Search size={14} />
        <input
          type="text"
          placeholder="搜索客户名称..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
      </div>

      {loading ? (
        <p className="muted"><Loader2 size={14} className="spin" /> 加载中...</p>
      ) : (
        <>
          <p className="muted">共 {total} 个客户</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>客户名称</th>
                <th>行业</th>
                <th>营收（元）</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button className="link-button" onClick={() => onOpen(c.id)}>
                      <strong>{c.name}</strong>
                      <ChevronRight size={12} />
                    </button>
                  </td>
                  <td>{c.industry || "—"}</td>
                  <td>{c.totalRevenue ? `¥${c.totalRevenue.toLocaleString()}` : "—"}</td>
                  <td>
                    <span className={`status-pill status-${c.status === "active" ? "completed" : c.status === "archived" ? "cancelled" : "lead"}`}>
                      {c.status === "active" ? "活跃" : c.status === "inactive" ? "停用" : c.status === "archived" ? "已归档" : c.status || "—"}
                    </span>
                  </td>
                  <td>
                    <button className="ghost-button small" onClick={() => onOpen(c.id)}>
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button className="ghost-button small" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button>
            <span>第 {page + 1} 页 / 共 {Math.ceil(total / limit)} 页</span>
            <button className="ghost-button small" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
        </>
      )}
    </section>
  );
}

// ============== 合作认证单位 Tab ==============
function PartnerOrgTab() {
  const [list, setList] = useState<PartnerOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", contactName: "", contactPhone: "", address: "", remark: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await api.listPartnerOrgs();
      setList(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      alert("请填写外协单位名称");
      return;
    }
    setSaving(true);
    try {
      await api.createPartnerOrg({
        name: form.name.trim(),
        contactPerson: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        address: form.address.trim(),
        notes: form.remark.trim()
      });
      setShowNew(false);
      setForm({ name: "", contactName: "", contactPhone: "", address: "", remark: "" });
      await load();
    } catch (e: any) {
      alert(e?.message || "创建失败");
    } finally { setSaving(false); }
  };

  return (
    <section className="base-data-section">
      <div className="section-heading">
        <div>
          <h3>合作认证单位</h3>
          <p className="muted">外协认证单位（每次项目合作可选，名称永久保留）</p>
        </div>
        <button className="primary-button" onClick={() => setShowNew(true)}>
          <Plus size={14} /> 新增外协
        </button>
      </div>

      {loading ? (
        <p className="muted"><Loader2 size={14} className="spin" /> 加载中...</p>
      ) : list.length === 0 ? (
        <p className="muted">暂无外协单位。点击"新增外协"开始添加。</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>单位名称</th>
              <th>联系人</th>
              <th>联系电话</th>
              <th>地址</th>
              <th>合作状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td>{p.contactName || (p as any).contact_name || p.contactPerson || "—"}</td>
                <td>{p.contactPhone || (p as any).contact_phone || "—"}</td>
                <td>{p.address || "—"}</td>
                <td>
                  <span className={`status-pill ${p.cooperationStatus === "active" || (p as any).status === "active" ? "status-completed" : ""}`}>
                    {p.cooperationStatus === "active" || (p as any).status === "active" ? "合作中" :
                     p.cooperationStatus === "paused" || (p as any).status === "paused" ? "暂停" :
                     p.cooperationStatus || (p as any).status}
                  </span>
                </td>
                <td>{p.notes || p.remark || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Plus size={18} /> 新增合作认证单位</h3>
            <div className="form-row">
              <label>单位名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：xx 认证有限公司"
              />
            </div>
            <div className="form-row-2">
              <div>
                <label>联系人</label>
                <input
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                />
              </div>
              <div>
                <label>联系电话</label>
                <input
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <label>地址</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>备注</label>
              <textarea
                rows={2}
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowNew(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={handleCreate} disabled={saving}>
                <Save size={14} /> {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============== 服务类型 Tab ==============
function ServiceTypeTab() {
  const [list, setList] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await api.listServiceTypes();
      setList(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <section className="base-data-section">
      <div className="section-heading">
        <div>
          <h3>服务类型</h3>
          <p className="muted">3 类固定服务类型：咨询 / 认证 / 咨询+认证一体化</p>
        </div>
      </div>

      {loading ? (
        <p className="muted"><Loader2 size={14} className="spin" /> 加载中...</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>类型名称</th>
              <th>描述</th>
              <th>需要外协</th>
              <th>需要出证</th>
            </tr>
          </thead>
          <tbody>
            {list.map((st) => (
              <tr key={st.id}>
                <td><strong>{st.code}</strong></td>
                <td>{st.name}</td>
                <td>{(st as any).description || "—"}</td>
                <td>{st.config?.need_partner ? "是" : "否"}</td>
                <td>{st.config?.need_certificate ? "是" : "否"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}