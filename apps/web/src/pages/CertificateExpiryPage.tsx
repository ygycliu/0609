/**
 * V2.0 认证证书预警页面
 *
 * 功能：
 * - 4 级预警卡片统计
 * - 列表展示所有证书（含到期日）
 * - 筛选：状态 / 体系 / 客户
 * - 一键标记已处理
 */

import { useEffect, useState } from "react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock,
  Bell, RefreshCw, Filter, FileCheck, LoaderCircle, X, ChevronDown
} from "lucide-react";
import { api } from "../lib/api";
import { ToastManager } from "../components/Toast";

// 格式化日期：去掉 ISO 时间戳后缀，只保留 YYYY-MM-DD
function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  return s.split("T")[0];
}

interface CertificateItem {
  certificate_id: string;
  customer_id: string;
  customer_name: string;
  project_code: string;
  cert_type: string;
  certificate_no: string;
  issue_date: string;
  valid_until: string;
  current_stage: string | null;
  next_stage: string | null;
  next_stage_date: string | null;
  days_until_next: number;
  days_until_expiry: number;
  urgency_level: string;  // '已过期' | '再认证紧急' | '再认证预警' | '即将到期' | '正常'
  alert_message: string;
  owner_user_id: string | null;
  issuing_body: string | null;
}

// 客户→最新有效主合同（带 fileId）的缓存
interface ContractLink {
  contract_id: string;
  contract_no: string;
  file_id: string;
  signed_at: string | null;
}

interface Stats {
  total: number;
  expired: number;
  recert_critical: number;
  recert_warning: number;
  expiring_soon: number;
  normal: number;
  warning_days: number;
  critical_days: number;
}

export function CertificateExpiryPage() {
  const [items, setItems] = useState<CertificateItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterCertType, setFilterCertType] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  // 客户→最新有效合同（带 PDF 文件）
  const [contractMap, setContractMap] = useState<Map<string, ContractLink>>(new Map());

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getCertExpiring(180, 60);
      const d = (r as any)?.data || r;
      setStats(d.stats);
      setItems(d.certificates || []);
      // 异步加载合同（不阻塞证书渲染）
      loadContractsForCustomers(d.certificates || []);
    } catch (e: any) {
      ToastManager.error(`加载失败：${e?.message ?? "未知错误"}`);
    } finally {
      setLoading(false);
    }
  };

  // 批量拉取证书列表里所有客户的"最新有效合同（带 PDF）"
  // 用 SQL 直接查：SELECT DISTINCT ON (customer_id) ...
  // 这里走现有 listContracts 接口，按 customer_id 一个个查（带并发限制 + 缓存）
  const loadContractsForCustomers = async (certs: CertificateItem[]) => {
    const customerIds = Array.from(new Set(certs.map(c => c.customer_id).filter(Boolean)));
    if (customerIds.length === 0) return;

    // 并发请求，但上限 6 路（避免后端过载）
    const newMap = new Map<string, ContractLink>();
    const chunks: string[][] = [];
    for (let i = 0; i < customerIds.length; i += 6) {
      chunks.push(customerIds.slice(i, i + 6));
    }
    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map(async (cid) => {
          try {
            const r = await api.listContracts({
              customer_id: cid,
              status: "active",
              contract_type: "main",
              limit: 5,
            } as any);
            const items = (r as any)?.data || [];
            // 找带 fileId 且签约日最新的主合同
            const candidates = items
              .filter((c: any) => c.fileId)
              .sort((a: any, b: any) => {
                const ad = a.signedAt ? new Date(a.signedAt).getTime() : 0;
                const bd = b.signedAt ? new Date(b.signedAt).getTime() : 0;
                return bd - ad;
              });
            const picked = candidates[0];
            return picked
              ? { cid, link: { contract_id: picked.id, contract_no: picked.contractNo, file_id: picked.fileId, signed_at: picked.signedAt } as ContractLink }
              : { cid, link: null };
          } catch {
            return { cid, link: null };
          }
        })
      );
      for (const { cid, link } of results) {
        if (link) newMap.set(cid, link);
      }
    }
    if (newMap.size > 0) {
      setContractMap(prev => {
        const next = new Map(prev);
        newMap.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAck = async (cert: CertificateItem) => {
    try {
      const r = await api.acknowledgeCert(cert.certificate_id, "");
      const data = (r as any)?.data || r;
      const modeText = data.mode === 'push_todo'
        ? `📌 已推送待办（${data.urgency_level === 'RENEW' ? '已过期' : '紧急'}）`
        : `✅ 已隐藏（${cert.urgency_level}）`;
      ToastManager.success(`${cert.customer_name} ${modeText}`);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(cert.certificate_id);
        return next;
      });
      await load();  // 刷新（视图过滤已确认）
    } catch (e: any) {
      ToastManager.error(`操作失败：${e?.message ?? "未知错误"}`);
    }
  };

  const handleBatchAck = async () => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const r = await api.acknowledgeBatch(Array.from(selectedIds), "");
      const data = (r as any)?.data || r;
      ToastManager.success(
        `✅ 批量处理 ${data.total} 张证书（推送 ${data.push_count} + 隐藏 ${data.hidden_count}）`
      );
      setSelectedIds(new Set());
      await load();
    } catch (e: any) {
      ToastManager.error(`批量操作失败：${e?.message ?? "未知错误"}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.certificate_id)));
    }
  };

  // 筛选
  const filtered = items.filter((it) => {
    if (filterLevel !== "all" && it.urgency_level !== filterLevel) return false;
    if (filterCertType !== "all" && it.cert_type !== filterCertType) return false;
    return true;
  });

  // 唯一 cert_type
  const certTypes = Array.from(new Set(items.map((it) => it.cert_type))).sort();

  // 紧急程度样式
  const levelStyle = (level: string) => {
    switch (level) {
      case "已过期":
        return { bg: "#1e293b", color: "#ffffff", icon: AlertCircle, label: "已过期" };
      case "再认证紧急":
        return { bg: "#dc2626", color: "#ffffff", icon: AlertTriangle, label: "再认证紧急" };
      case "再认证预警":
        return { bg: "#f97316", color: "#ffffff", icon: Clock, label: "再认证预警" };
      case "即将到期":
        return { bg: "#fbbf24", color: "#1e293b", icon: AlertTriangle, label: "即将到期" };
      default:
        return { bg: "#dcfce7", color: "#166534", icon: CheckCircle2, label: "正常" };
    }
  };

  return (
    <div className="cert-expiry-page">
      {/* 顶部统计卡片 */}
      <header className="page-header">
        <div>
          <h1>🔔 认证证书预警</h1>
          <p>实时监控所有客户认证证书到期状态，提前预警避免过期</p>
        </div>
        <button className="primary-button" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /> 刷新
        </button>
      </header>

      {stats && (
        <section className="stats-cards">
          <div
            className={`stat-card expired ${filterLevel === '已过期' ? 'active' : ''}`}
            onClick={() => setFilterLevel(filterLevel === '已过期' ? 'all' : '已过期')}
            title="点击查看已过期证书"
          >
            <div className="stat-icon"><AlertCircle size={28} /></div>
            <div>
              <strong>{stats.expired}</strong>
              <span>已过期</span>
            </div>
          </div>
          <div
            className={`stat-card recert-critical ${filterLevel === '即将到期' || filterLevel === '再认证紧急' ? 'active' : ''}`}
            onClick={() => setFilterLevel(filterLevel === '即将到期' ? 'all' : '即将到期')}
            title="点击查看紧急证书"
          >
            <div className="stat-icon"><AlertTriangle size={28} /></div>
            <div>
              <strong>{(stats.recert_critical || 0) + (stats.expiring_soon || 0)}</strong>
              <span>紧急（监督/再认证 ≤30天）</span>
            </div>
          </div>
          <div
            className={`stat-card recert-warning ${filterLevel === '再认证预警' ? 'active' : ''}`}
            onClick={() => setFilterLevel(filterLevel === '再认证预警' ? 'all' : '再认证预警')}
            title="点击查看再认证预警证书"
          >
            <div className="stat-icon"><Clock size={28} /></div>
            <div>
              <strong>{stats.recert_warning || 0}</strong>
              <span>再认证预警（91-180天）</span>
            </div>
          </div>
          <div
            className={`stat-card normal ${filterLevel === '正常' ? 'active' : ''}`}
            onClick={() => setFilterLevel(filterLevel === '正常' ? 'all' : '正常')}
            title="点击查看正常证书"
          >
            <div className="stat-icon"><CheckCircle2 size={28} /></div>
            <div>
              <strong>{stats.normal || 0}</strong>
              <span>正常</span>
            </div>
          </div>
        </section>
      )}

      {/* 筛选 */}
      <section className="filter-bar">
        <div className="filter-group">
          <Filter size={14} />
          <label>状态：</label>
          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value="all">全部</option>
            <option value="已过期">已过期</option>
            <option value="再认证紧急">再认证紧急</option>
            <option value="再认证预警">再认证预警</option>
            <option value="即将到期">即将到期</option>
            <option value="正常">正常</option>
          </select>
        </div>
        <div className="filter-group">
          <FileCheck size={14} />
          <label>证书类型：</label>
          <select value={filterCertType} onChange={(e) => setFilterCertType(e.target.value)}>
            <option value="all">全部</option>
            {certTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 批量操作条（选中后显示） */}
      {selectedIds.size > 0 && (
        <section className="batch-toolbar">
          <div className="batch-info">
            <strong>已选 {selectedIds.size} 张证书</strong>
            <button
              className="ghost-button tiny"
              onClick={() => setSelectedIds(new Set())}
              title="清除选择"
            >
              <X size={12} /> 清除
            </button>
          </div>
          <button
            className="primary-button tiny"
            onClick={handleBatchAck}
            disabled={batchLoading}
          >
            {batchLoading ? <><LoaderCircle className="spin" size={12} /> 处理中...</> : <>📌 批量确认 + 推送代办</>}
          </button>
        </section>
      )}

      {/* 表格 */}
      <section className="cert-table-section">
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={32} /> 加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-row">
            <CheckCircle2 size={48} />
            <p>暂无证书预警 {filterLevel !== "all" ? "（已筛选）" : ""}</p>
          </div>
        ) : (
          <table className="cert-expiry-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    title="全选当前筛选结果"
                  />
                </th>
                <th>状态</th>
                <th>客户</th>
                <th>证书类型</th>
                <th>当前阶段</th>
                <th>下一阶段</th>
                <th>证书号</th>
                <th>到期日期</th>
                <th>距下一阶段</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const style = levelStyle(it.urgency_level);
                const Icon = style.icon;
                return (
                  <tr key={it.certificate_id} className={selectedIds.has(it.certificate_id) ? 'selected' : ''}>
                    <td className="checkbox-col">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(it.certificate_id)}
                        onChange={() => toggleSelect(it.certificate_id)}
                      />
                    </td>
                    <td>
                      <span className="urgency-pill" style={{ background: style.bg, color: style.color }}>
                        <Icon size={14} /> {style.label}
                      </span>
                    </td>
                    <td>
                      <div className="customer-cell">
                        <strong title={it.customer_name}>{it.customer_name}</strong>
                        <small>{it.project_code}</small>
                      </div>
                    </td>
                    <td><span className="cert-type-pill">{it.cert_type}</span></td>
                    <td>
                      {it.current_stage ? (
                        <span className="stage-pill">{it.current_stage}</span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td>
                      {it.next_stage ? (
                        <span className="next-stage-pill">{it.next_stage}</span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td><code>{it.certificate_no}</code></td>
                    <td>
                      <strong style={{ color: it.days_until_next <= 60 ? "#dc2626" : "inherit" }}>
                        {fmtDate(it.valid_until)}
                      </strong>
                    </td>
                    <td>
                      <strong style={{
                        color: it.days_until_next <= 0 ? "#dc2626"
                          : it.days_until_next <= 30 ? "#dc2626"
                          : it.days_until_next <= 60 ? "#f97316"
                          : it.days_until_next <= 90 ? "#eab308"
                          : "#10b981"
                      }}>
                        {it.days_until_next > 0
                          ? `${it.days_until_next} 天`
                          : `已过 ${-it.days_until_next} 天`}
                      </strong>
                    </td>
                    <td>
                      {it.urgency_level !== "正常" && (
                        <button
                          className="ghost-button tiny"
                          onClick={() => handleAck(it)}
                          title={
                            it.urgency_level === '已过期' || it.urgency_level === '再认证紧急' || it.urgency_level === '即将到期'
                              ? '点击推送到待办，并从列表移除'
                              : '点击从列表移除'
                          }
                        >
                          {it.urgency_level === '已过期' || it.urgency_level === '再认证紧急' || it.urgency_level === '即将到期'
                            ? '📌 推送'
                            : '✓ 隐藏'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}