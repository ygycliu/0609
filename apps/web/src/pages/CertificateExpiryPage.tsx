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

interface CertificateItem {
  certificate_id: string;
  customer_id: string;
  customer_name: string;
  project_code: string;
  cert_type: string;
  certificate_no: string;
  issue_date: string;
  valid_until: string;
  days_until_expiry: number;
  urgency_level: "EXPIRED" | "CRITICAL" | "WARNING" | "NORMAL";
  alert_message: string;
  owner_user_id: string | null;
  issuing_body: string | null;
}

interface Stats {
  total: number;
  expired: number;
  critical: number;
  warning: number;
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

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getCertExpiring(180, 60);
      const d = (r as any)?.data || r;
      setStats(d.stats);
      setItems(d.certificates || []);
    } catch (e: any) {
      ToastManager.error(`加载失败：${e?.message ?? "未知错误"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAck = async (certId: string, customer: string) => {
    if (!window.confirm(`确认已处理 ${customer} 的证书预警？`)) return;
    try {
      await api.acknowledgeCert(certId);
      ToastManager.success(`✅ ${customer} 已标记为已处理`);
      await load();
    } catch (e: any) {
      ToastManager.error(`标记失败：${e?.message ?? "未知错误"}`);
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
      case "EXPIRED":
        return { bg: "#fee2e2", color: "#991b1b", icon: AlertCircle, label: "已过期" };
      case "CRITICAL":
        return { bg: "#ffedd5", color: "#9a3412", icon: AlertTriangle, label: "紧急" };
      case "WARNING":
        return { bg: "#fef3c7", color: "#92400e", icon: Clock, label: "警告" };
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
          <div className="stat-card expired">
            <div className="stat-icon"><AlertCircle size={28} /></div>
            <div>
              <strong>{stats.expired}</strong>
              <span>已过期</span>
            </div>
          </div>
          <div className="stat-card critical">
            <div className="stat-icon"><AlertTriangle size={28} /></div>
            <div>
              <strong>{stats.critical}</strong>
              <span>紧急（≤{stats.critical_days}天）</span>
            </div>
          </div>
          <div className="stat-card warning">
            <div className="stat-icon"><Clock size={28} /></div>
            <div>
              <strong>{stats.warning}</strong>
              <span>警告（≤{stats.warning_days}天）</span>
            </div>
          </div>
          <div className="stat-card normal">
            <div className="stat-icon"><CheckCircle2 size={28} /></div>
            <div>
              <strong>{stats.normal}</strong>
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
            <option value="EXPIRED">已过期</option>
            <option value="CRITICAL">紧急</option>
            <option value="WARNING">警告</option>
            <option value="NORMAL">正常</option>
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
                <th>状态</th>
                <th>客户</th>
                <th>证书类型</th>
                <th>证书号</th>
                <th>签发日期</th>
                <th>到期日期</th>
                <th>剩余天数</th>
                <th>颁发机构</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => {
                const style = levelStyle(it.urgency_level);
                const Icon = style.icon;
                return (
                  <tr key={it.certificate_id}>
                    <td>
                      <span className="urgency-pill" style={{ background: style.bg, color: style.color }}>
                        <Icon size={14} /> {style.label}
                      </span>
                    </td>
                    <td>
                      <div className="customer-cell">
                        <strong>{it.customer_name}</strong>
                        <small>{it.project_code}</small>
                      </div>
                    </td>
                    <td><span className="cert-type-pill">{it.cert_type}</span></td>
                    <td><code>{it.certificate_no}</code></td>
                    <td>{it.issue_date}</td>
                    <td>
                      <strong style={{ color: it.days_until_expiry <= 60 ? "#dc2626" : "inherit" }}>
                        {it.valid_until}
                      </strong>
                    </td>
                    <td>
                      <strong style={{
                        color: it.days_until_expiry <= 0 ? "#dc2626"
                          : it.days_until_expiry <= 60 ? "#f97316"
                          : it.days_until_expiry <= 180 ? "#eab308"
                          : "#10b981"
                      }}>
                        {it.days_until_expiry > 0 ? `${it.days_until_expiry} 天` : `已过 ${-it.days_until_expiry} 天`}
                      </strong>
                    </td>
                    <td className="muted small">{it.issuing_body || "—"}</td>
                    <td>
                      {it.urgency_level !== "NORMAL" && (
                        <button
                          className="ghost-button tiny"
                          onClick={() => handleAck(it.certificate_id, it.customer_name)}
                          title="标记为已处理（仅备注）"
                        >
                          ✓ 已处理
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