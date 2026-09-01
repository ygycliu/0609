/**
 * V2.0 审核员档案管理页面
 *
 * 功能：
 * - 列表 + 搜索 + 筛选（状态/级别/机构/专业）
 * - 新增 / 编辑 / 停用 / 启用 / 删除（admin only）
 * - 详情侧拉（drawer）
 * - 统计卡片（总数/启用/级别分布）
 */

import { useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Edit3, Power, PowerOff, Trash2, X, User, Award,
  Briefcase, Phone, Mail, MapPin, Tag, Save, LoaderCircle, AlertCircle
} from "lucide-react";
import { api } from "../lib/api";
import { ToastManager } from "../components/Toast";

interface Auditor {
  id: string;
  name: string;
  code: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  organization: string | null;
  department: string | null;
  position: string | null;
  level: string;
  specialties: string[];
  certNo: string | null;
  certIssueDate: string | null;
  certExpiry: string | null;
  certStatus: string;
  dailyRate: number;
  expertType: string | null;
  region: string | null;
  languages: string[];
  bio: string | null;
  notes: string | null;
  status: string;
  tags: string[];
  source: string;
  createdAt: string;
}

interface Stats {
  total: number;
  active: number;
  inactive: number;
  byLevel: Record<string, number>;
  byOrg: Record<string, number>;
}

const LEVEL_OPTIONS = [
  { value: "junior", label: "初级" },
  { value: "intermediate", label: "中级" },
  { value: "senior", label: "高级" },
  { value: "expert", label: "专家" }
];

const SPECIALTY_OPTIONS = ["Q", "ES", "QES", "SC", "FSHA", "QJES", "有机", "绿色", "碳足迹"];

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  active: { text: "启用", color: "status-completed" },
  inactive: { text: "停用", color: "status-overdue" },
  retired: { text: "退休", color: "status-pending" }
};

export function AuditorProfilePage({ currentUser }: { currentUser?: any }) {
  const isAdmin = currentUser?.isAdmin ?? currentUser?.role === "admin";
  
  const [auditors, setAuditors] = useState<Auditor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // 筛选
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  
  // 编辑
  const [editing, setEditing] = useState<Auditor | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // 加载数据
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params: any = { limit: 500 };
      if (q) params.q = q;
      if (statusFilter) params.status = statusFilter;
      if (levelFilter) params.level = levelFilter;
      if (orgFilter) params.organization = orgFilter;
      const r = await api.listAuditors(params);
      // request 解包后：r 可能是数组（直接返回）或 {data: [...], total}
      const items = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []);
      setAuditors(items);
    } catch (e: any) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };
  
  const loadStats = async () => {
    try {
      const r = await api.auditorStats();
      setStats(r || null);
    } catch {}
  };
  
  useEffect(() => {
    load();
    loadStats();
  }, [statusFilter, levelFilter, orgFilter]);
  
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  
  // 新增
  const openCreate = () => {
    setEditing({
      id: "",
      name: "",
      code: null,
      gender: null,
      phone: null,
      email: null,
      organization: null,
      department: null,
      position: null,
      level: "intermediate",
      specialties: [],
      certNo: null,
      certIssueDate: null,
      certExpiry: null,
      certStatus: "active",
      dailyRate: 0,
      expertType: "auditor",
      region: null,
      languages: [],
      bio: null,
      notes: null,
      status: "active",
      tags: [],
      source: "manual",
      createdAt: ""
    });
    setCreating(true);
  };
  
  const openEdit = (a: Auditor) => {
    setEditing(a);
    setCreating(false);
  };
  
  const closeEdit = () => {
    setEditing(null);
    setCreating(false);
  };
  
  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) {
      ToastManager.warning("请填写姓名");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing };
      delete (payload as any).id;
      delete (payload as any).createdAt;
      delete (payload as any).updatedAt;
      delete (payload as any).companyId;
      
      if (creating) {
        await api.createAuditor(payload);
        ToastManager.success("✅ 审核员已创建");
      } else {
        await api.updateAuditor(editing.id, payload);
        ToastManager.success("✅ 审核员已更新");
      }
      closeEdit();
      load();
      loadStats();
    } catch (e: any) {
      ToastManager.error(`❌ 保存失败：${e?.message ?? "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };
  
  const toggleStatus = async (a: Auditor) => {
    const newStatus = a.status === "active" ? "inactive" : "active";
    if (!window.confirm(`确认${newStatus === "active" ? "启用" : "停用"}「${a.name}」？`)) return;
    try {
      await api.updateAuditorStatus(a.id, newStatus);
      ToastManager.success(`✅ ${a.name} 已${newStatus === "active" ? "启用" : "停用"}`);
      load();
      loadStats();
    } catch (e: any) {
      ToastManager.error(`❌ 操作失败：${e?.message ?? "未知错误"}`);
    }
  };
  
  const remove = async (a: Auditor) => {
    if (!window.confirm(`确认删除「${a.name}」？此操作可在数据库恢复（软删除）。`)) return;
    try {
      await api.deleteAuditor(a.id);
      ToastManager.success(`✅ ${a.name} 已删除`);
      load();
      loadStats();
    } catch (e: any) {
      ToastManager.error(`❌ 删除失败：${e?.message ?? "未知错误"}`);
    }
  };

  return (
    <div className="auditor-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">系统基础数据 · 审核员档案</span>
          <h1>审核员档案管理</h1>
          <p>审核老师档案的新增、修改、停用。可被数字审核、审计员分配等模块调用。</p>
        </div>
        {isAdmin && (
          <button className="primary-button" onClick={openCreate}>
            <Plus size={16} /> 新增审核员
          </button>
        )}
      </header>

      {/* 统计卡片 */}
      {stats && (
        <section className="auditor-stats">
          <div className="auditor-stat">
            <span>审核员总数</span>
            <strong>{stats.total}</strong>
            <small>已导入 + 手动新增</small>
          </div>
          <div className="auditor-stat active-stat">
            <span>启用中</span>
            <strong>{stats.active}</strong>
            <small>在职可分配</small>
          </div>
          <div className="auditor-stat inactive-stat">
            <span>已停用</span>
            <strong>{stats.inactive}</strong>
            <small>暂停 / 退休</small>
          </div>
          <div className="auditor-stat level-stat">
            <span>级别分布</span>
            <div className="level-tags">
              {Object.entries(stats.byLevel).map(([k, v]) => (
                <span key={k} className="level-tag">{LEVEL_OPTIONS.find(o => o.value === k)?.label || k}: {v}</span>
              ))}
              {Object.keys(stats.byLevel).length === 0 && <small>暂无数据</small>}
            </div>
          </div>
        </section>
      )}

      {/* 筛选 */}
      <section className="auditor-toolbar">
        <div className="search-row">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索姓名 / 编号 / 电话 / 邮箱"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
          <option value="retired">退休</option>
        </select>
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="">全部级别</option>
          {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="text"
          placeholder="所属机构"
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
        />
      </section>

      {error && <div className="error-banner">{error}</div>}

      {/* 列表 */}
      <section className="auditor-list">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={20} /> 加载中...
          </div>
        ) : auditors.length === 0 ? (
          <div className="empty-row">
            <AlertCircle size={20} /> 暂无审核员档案
            {isAdmin && (
              <button className="primary-button small" onClick={openCreate} style={{marginLeft: 12}}>
                <Plus size={14} /> 新增审核员
              </button>
            )}
          </div>
        ) : (
          <table className="auditor-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>所属机构</th>
                <th>级别</th>
                <th>类型</th>
                <th>专业</th>
                <th>电话</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {auditors.map((a) => {
                const st = STATUS_LABEL[a.status] || STATUS_LABEL.active;
                return (
                  <tr key={a.id}>
                    <td className="strong">
                      <User size={14} style={{verticalAlign: "middle"}} /> {a.name}
                    </td>
                    <td>{a.organization || "—"}</td>
                    <td>
                      <span className="level-pill">{LEVEL_OPTIONS.find(o => o.value === a.level)?.label || a.level}</span>
                    </td>
                    <td>
                      <span className={`type-pill ${a.expertType === "technical_expert" ? "type-expert" : ""}`}>
                        {a.expertType === "technical_expert" ? "技术专家" : "审核员"}
                      </span>
                    </td>
                    <td>
                      {a.specialties.slice(0, 3).map((s, i) => (
                        <span key={i} className="spec-pill">{s}</span>
                      ))}
                      {a.specialties.length > 3 && <span className="spec-more">+{a.specialties.length - 3}</span>}
                    </td>
                    <td>{a.phone || "—"}</td>
                    <td>
                      <span className={`status-pill ${st.color}`}>{st.text}</span>
                    </td>
                    <td className="action-cell">
                      {isAdmin && (
                        <>
                          <button className="ghost-button tiny" onClick={() => openEdit(a)} title="编辑">
                            <Edit3 size={12} />
                          </button>
                          <button
                            className={`ghost-button tiny ${a.status === "active" ? "danger" : "success"}`}
                            onClick={() => toggleStatus(a)}
                            title={a.status === "active" ? "停用" : "启用"}
                          >
                            {a.status === "active" ? <PowerOff size={12} /> : <Power size={12} />}
                          </button>
                          <button className="ghost-button tiny danger" onClick={() => remove(a)} title="删除">
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 编辑抽屉 */}
      {editing && (
        <AuditorEditDrawer
          auditor={editing}
          isCreating={creating}
          isAdmin={isAdmin}
          saving={saving}
          onChange={setEditing}
          onSave={save}
          onClose={closeEdit}
        />
      )}
    </div>
  );
}

function AuditorEditDrawer({
  auditor,
  isCreating,
  isAdmin,
  saving,
  onChange,
  onSave,
  onClose
}: {
  auditor: Auditor;
  isCreating: boolean;
  isAdmin: boolean;
  saving: boolean;
  onChange: (a: Auditor) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const update = (k: keyof Auditor, v: any) => {
    onChange({ ...auditor, [k]: v });
  };
  
  const toggleSpecialty = (s: string) => {
    const arr = auditor.specialties || [];
    if (arr.includes(s)) {
      update("specialties", arr.filter(x => x !== s));
    } else {
      update("specialties", [...arr, s]);
    }
  };
  
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">{isCreating ? "新增审核员" : "编辑审核员"}</span>
            <h2>{auditor.name || "未命名"}</h2>
            <p>审核员档案 · {auditor.organization || "未分类"}</p>
          </div>
          <button className="ghost-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="form-grid">
            <label className="field required">
              <span>姓名 *</span>
              <input value={auditor.name} onChange={(e) => update("name", e.target.value)} required />
            </label>
            <label className="field">
              <span>编号</span>
              <input value={auditor.code || ""} onChange={(e) => update("code", e.target.value)} placeholder="系统自动 / 人工分配" />
            </label>
            <label className="field">
              <span>性别</span>
              <select value={auditor.gender || ""} onChange={(e) => update("gender", e.target.value)}>
                <option value="">未填</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </label>
            <label className="field">
              <span>类型</span>
              <select value={auditor.expertType || "auditor"} onChange={(e) => update("expertType", e.target.value)}>
                <option value="auditor">审核员</option>
                <option value="technical_expert">技术专家</option>
              </select>
            </label>
            <label className="field">
              <span>所属机构</span>
              <input value={auditor.organization || ""} onChange={(e) => update("organization", e.target.value)} placeholder="中认/华中/博创众诚" />
            </label>
            <label className="field">
              <span>部门</span>
              <input value={auditor.department || ""} onChange={(e) => update("department", e.target.value)} />
            </label>
            <label className="field">
              <span>职位</span>
              <input value={auditor.position || ""} onChange={(e) => update("position", e.target.value)} placeholder="如：高级审核员" />
            </label>
            <label className="field">
              <span>级别</span>
              <select value={auditor.level} onChange={(e) => update("level", e.target.value)}>
                {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span><Phone size={12} /> 电话</span>
              <input value={auditor.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            </label>
            <label className="field">
              <span><Mail size={12} /> 邮箱</span>
              <input value={auditor.email || ""} onChange={(e) => update("email", e.target.value)} />
            </label>
            <label className="field">
              <span><MapPin size={12} /> 地区</span>
              <input value={auditor.region || ""} onChange={(e) => update("region", e.target.value)} placeholder="如：宁夏" />
            </label>
            <label className="field">
              <span>日费率 (¥)</span>
              <input type="number" value={auditor.dailyRate || 0} onChange={(e) => update("dailyRate", Number(e.target.value))} />
            </label>
          </div>

          <div className="field">
            <span><Award size={12} /> 专业领域（可多选）</span>
            <div className="spec-chips">
              {SPECIALTY_OPTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`spec-chip ${(auditor.specialties || []).includes(s) ? "active" : ""}`}
                  onClick={() => toggleSpecialty(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>证书编号</span>
              <input value={auditor.certNo || ""} onChange={(e) => update("certNo", e.target.value)} />
            </label>
            <label className="field">
              <span>证书签发日期</span>
              <input type="date" value={auditor.certIssueDate?.slice(0, 10) || ""} onChange={(e) => update("certIssueDate", e.target.value)} />
            </label>
            <label className="field">
              <span>证书有效期</span>
              <input type="date" value={auditor.certExpiry?.slice(0, 10) || ""} onChange={(e) => update("certExpiry", e.target.value)} />
            </label>
            <label className="field">
              <span>证书状态</span>
              <select value={auditor.certStatus} onChange={(e) => update("certStatus", e.target.value)}>
                <option value="active">有效</option>
                <option value="expired">过期</option>
                <option value="suspended">暂停</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>简介</span>
            <textarea value={auditor.bio || ""} onChange={(e) => update("bio", e.target.value)} rows={3} placeholder="专业背景、擅长行业等" />
          </label>

          <label className="field">
            <span><Tag size={12} /> 标签（逗号分隔）</span>
            <input
              value={(auditor.tags || []).join(", ")}
              onChange={(e) => update("tags", e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean))}
              placeholder="CCAA 注册, ISO9001, 食品行业"
            />
          </label>

          <label className="field">
            <span>备注</span>
            <textarea value={auditor.notes || ""} onChange={(e) => update("notes", e.target.value)} rows={2} />
          </label>

          <label className="field">
            <span>档案状态</span>
            <select value={auditor.status} onChange={(e) => update("status", e.target.value)}>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
              <option value="retired">退休</option>
            </select>
          </label>
        </div>
        <footer className="drawer-footer">
          <button className="ghost-button" onClick={onClose}>取消</button>
          {isAdmin && (
            <button className="primary-button" onClick={onSave} disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {saving ? "保存中..." : (isCreating ? "创建" : "保存")}
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
