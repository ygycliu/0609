/**
 * V2.2 合同管理页面
 * 客户管理菜单下，包含：
 * - 合同列表
 * - PDF 批量导入
 * - 合同详情
 */
import { useEffect, useState } from "react";
import { api, importContractFromPdf } from "../lib/api";
import { ToastManager } from "../components/Toast";

interface Contract {
  id: string;
  contractNo: string;
  contractType: "main" | "supplement" | "change" | "terminate";
  signingEntityName?: string;
  customerName?: string;
  customerId: string;
  title: string | null;
  contractAmount: number;
  certificationTypes: string[];
  signedAt: string | null;
  status: string;
  source: string;
  extractionConfidence: number | null;
  fileId: string | null;
  createdAt: string;
}

// V2.3.2 结构化合同详情
interface ContractStructured {
  customer: { id: string; name: string; code: string | null } | null;
  signingEntity: { id: string; name: string; aiExtractedName: string | null } | null;
  certification: {
    category: string | null;
    systems: string[];
    scope: string | null;
    auditRegion: string | null;
    employeeCount: string | null;
    siteCount: string | null;
    tempSiteCount: string | null;
    accreditationMark: string | null;
    certificateValidity: string | null;
    multiSiteRequired: boolean;
    specialRequirements: string | null;
    originalContractNo: string | null;
  };
  financial: {
    totalAmount: number;
    firstAuditFee: string | null;
    firstYearSupervisionFee: string | null;
    secondYearSupervisionFee: string | null;
    recertFee: string | null;
    paymentTerms: string | null;
    bankName: string | null;
    bankHolder: string | null;
    bankAccount: string | null;
  };
  contact: {
    person: string | null;
    phone: string | null;
    email: string | null;
    position: string | null;
  };
  timeline: {
    signedAt: string | null;
    effectiveAt: string | null;
    expireAt: string | null;
  };
  aiMeta: {
    confidence: number | null;
    source: string;
    extractedAt: string;
    aiModel: string | null;
    serviceType: string | null;
  };
}

interface ImportResult {
  file: { originalName: string; size: number; storagePath: string; sha256: string; usedOcr: boolean };
  text: string;
  extracted: any;
  confidence: number;
  errors: string[];
  matched: {
    customer: { id: string; name: string; matchType: string; confidence: number } | null;
    newCustomerNeeded: boolean;
    signingEntity: { id: string; name: string; entity_code: string } | null;
  };
}

export default function ContractsPage() {
  const [tab, setTab] = useState<"list" | "import" | "batches">("list");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<{ status?: string; q?: string }>({});
  const [showAll, setShowAll] = useState(false);  // V2.3.4：是否显示全部合同（默认 50 条）
  const [stats, setStats] = useState<any>(null);

  // PDF 导入
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 批次
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [contractDetail, setContractDetail] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState<"basic" | "financial" | "files" | "ai" | "ocr" | "related">("basic");
  const [detailLoading, setDetailLoading] = useState(false);

  const openContractDetail = async (c: Contract) => {
    setSelectedContract(c);
    setContractDetail(null);
    setDetailTab("basic");
    setDetailLoading(true);
    try {
      const r: any = await api.getContract(c.id);
      setContractDetail(r.data || r);
    } catch (e: any) {
      ToastManager.error("加载详情失败：" + e.message);
      setSelectedContract(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeContractDetail = () => {
    setSelectedContract(null);
    setContractDetail(null);
  };

  const loadContracts = async () => {
    setLoading(true);
    try {
      // V2.3.4：showAll=true 时拉全量（后端 limit 上限 10000），否则 50 条
      const limit = showAll ? 10000 : 50;
      const r = await api.listContracts({ ...filter, limit });
      setContracts(r.data || []);
      setTotal(r.total);
    } catch (e: any) {
      ToastManager.error("加载失败：" + (e?.message || "未知"));
    } finally { setLoading(false); }
  };

  const loadStats = async () => {
    try {
      const r = await api.getContractStats();
      setStats(r.data);
    } catch (e) { /* ignore */ }
  };

  const loadBatches = async () => {
    try {
      const r = await api.listImportBatches();
      setBatches(r.data || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    loadContracts();
    loadStats();
  }, [filter, showAll]);

  useEffect(() => {
    if (tab === "batches") loadBatches();
  }, [tab]);

  // 上传 PDF 自动触发导入
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportFile(f);
    setImporting(true);
    setImportResult(null);
    try {
      const r = await importContractFromPdf(f);
      setImportResult(r.data);
      ToastManager.success(`✅ PDF 已抽取（置信度 ${Math.round(r.data.confidence * 100)}%）`);
    } catch (e: any) {
      ToastManager.error("导入失败：" + (e?.message || "未知"));
    } finally {
      setImporting(false);
    }
  };

  // 确认入库
  const handleConfirmImport = async () => {
    if (!importResult) return;
    setConfirming(true);
    try {
      const ext = importResult.extracted;
      const body = {
        file: importResult.file,
        text: importResult.text,
        confidence: importResult.confidence,
        extracted: ext,
        customerId: importResult.matched.customer?.id || importResult.matched.newCustomerNeeded ? null : null,
        signingEntityId: importResult.matched.signingEntity?.id,
        contractNo: ext.合同编号 || `IMP-${Date.now()}`,
        contractType: ext.合同类型 || "main",
        title: `${ext.甲方客户名 || '未识别'} - ${ext.合同编号 || '未编号'}`,
        contractAmount: ext.合同金额 || 0,
        certificationTypes: ext.认证体系 || [],
        signedAt: ext.签订日期,
        effectiveAt: ext.生效日期,
        expireAt: ext.到期日期,
        bankName: ext.开户行,
        bankAccount: ext.账号,
        bankHolder: ext.户名,
        contactPerson: ext.联系人,
        contactPhone: ext.联系电话,
        serviceType: ext.服务类型,
        status: "draft",
        notes: "PDF 导入待人工审核"
      };
      // 若需新建客户
      let customerId = importResult.matched.customer?.id;
      if (!customerId) {
        // 暂不允许直接入库没匹配客户的合同
        ToastManager.error("未匹配到客户，请先在客户管理新建后再入库");
        setConfirming(false);
        return;
      }
      const r = await api.confirmImportContract({ ...body, customerId });
      ToastManager.success(`✅ 合同 ${r.data.contractNo} 已入库`);
      setImportResult(null);
      setImportFile(null);
      loadContracts();
      loadStats();
    } catch (e: any) {
      ToastManager.error("入库失败：" + (e?.message || "未知"));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1>📋 合同管理</h1>
        <div className="tab-bar">
          <button className={`tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
            合同列表
          </button>
          <button className={`tab ${tab === "import" ? "active" : ""}`} onClick={() => setTab("import")}>
            PDF 导入
          </button>
          <button className={`tab ${tab === "batches" ? "active" : ""}`} onClick={() => setTab("batches")}>
            导入批次
          </button>
        </div>
      </header>

      {/* 统计 */}
      {stats && (
        <section className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric">
            <span>合同总数</span>
            <strong>{stats.total || 0}</strong>
            <small>份</small>
          </div>
          <div className="metric">
            <span>总金额</span>
            <strong>¥{(stats.totalAmount || 0).toLocaleString()}</strong>
            <small>合同合计</small>
          </div>
          {stats.byEntity?.map((e: any) => (
            <div className="metric" key={e.id}>
              <span>{e.name?.slice(0, 8) || "未知"}</span>
              <strong>{e.count}</strong>
              <small>份 / ¥{(e.amount || 0).toLocaleString()}</small>
            </div>
          ))}
        </section>
      )}

      {/* 列表 */}
      {tab === "list" && (
        <section>
          <div className="finance-toolbar">
            <input
              type="text"
              placeholder="搜索合同号 / 标题..."
              value={filter.q || ""}
              onChange={e => setFilter({ ...filter, q: e.target.value })}
              className="toolbar-input"
            />
            <select
              value={filter.status || ""}
              onChange={e => setFilter({ ...filter, status: e.target.value || undefined })}
              className="toolbar-select"
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="signed">已签</option>
              <option value="effective">生效中</option>
              <option value="completed">已完成</option>
              <option value="terminated">已终止</option>
              <option value="archived">归档</option>
            </select>
            <span className="muted">共 {total} 条</span>
            {/* V2.3.4：显示全部按钮 — 取消 50 条限制，一次性看 962 条 */}
            <button
              className={showAll ? "page-size-btn active" : "page-size-btn"}
              onClick={() => setShowAll(s => !s)}
              title={showAll ? "已显示全部合同，点击切换为前 50 条" : `点击一次性显示全部 ${total} 条合同`}
            >
              {showAll ? "✓ 全部 962 条" : "显示全部"}
            </button>
          </div>

          {loading ? (
            <p className="muted">加载中...</p>
          ) : contracts.length === 0 ? (
            <div className="empty-row">
              📭 暂无合同。点击 <button className="link-button" onClick={() => setTab("import")}>PDF 导入</button> 开始添加。
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>合同编号</th>
                  <th>类型</th>
                  <th>客户</th>
                  <th>主体</th>
                  <th>金额</th>
                  <th>体系</th>
                  <th>签订日</th>
                  <th>状态</th>
                  <th>PDF</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id}>
                    <td>
                      <a
                        onClick={(e) => {
                          e.preventDefault();
                          openContractDetail(c);
                        }}
                        className="contract-no-link"
                        title="点击查看结构化详情"
                        style={{cursor:"pointer"}}
                      >
                        <code>{c.contractNo}</code> 🔍
                      </a>
                    </td>
                    <td>{c.contractType === "main" ? "主合同" : c.contractType === "supplement" ? "补充协议" : c.contractType}</td>
                    <td>{c.customerName || "—"}</td>
                    <td>{c.signingEntityName || "—"}</td>
                    <td>¥{(c.contractAmount || 0).toLocaleString()}</td>
                    <td>
                      {(c.certificationTypes || []).map(t => (
                        <span key={t} className="status-pill">{t}</span>
                      ))}
                    </td>
                    <td>{c.signedAt || "—"}</td>
                    <td>
                      <span className={`status-pill status-${c.status}`}>
                        {c.status === "draft" ? "草稿" :
                         c.status === "signed" ? "已签" :
                         c.status === "effective" ? "生效中" :
                         c.status === "completed" ? "已完成" :
                         c.status === "terminated" ? "已终止" : c.status}
                      </span>
                    </td>
                    <td>{c.fileId ? "📄" : "—"}</td>
                    <td>{c.source === "pdf_import" ? "导入" : c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* PDF 导入 */}
      {tab === "import" && (
        <section>
          <div className="import-wizard">
            <h3>📤 PDF 合同导入向导</h3>
            <p className="muted">
              上传合同 PDF/DOC → 系统自动 OCR + AI 抽取关键字段 → 智能匹配客户 → 人工确认入库
            </p>

            <div className="upload-area">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={handlePdfUpload}
                disabled={importing}
              />
              {importing && <p>⏳ 正在 OCR + AI 抽取（可能需要 10-30 秒）...</p>}
            </div>

            {importResult && (
              <div className="import-result">
                <h4>✅ 抽取完成（置信度 {Math.round(importResult.confidence * 100)}%）</h4>

                {importResult.errors.length > 0 && (
                  <div className="error-list">
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="warning">⚠️ {err}</p>
                    ))}
                  </div>
                )}

                <div className="extracted-fields">
                  <h5>📋 抽取字段（可点击修改）</h5>
                  <table>
                    <tbody>
                      <tr><td><b>客户名</b></td><td>{importResult.extracted.甲方客户名 || "—"}</td></tr>
                      <tr><td><b>乙方主体</b></td><td>{importResult.extracted.乙方主体 || "—"}</td></tr>
                      <tr><td><b>合同编号</b></td><td>{importResult.extracted.合同编号 || "—"}</td></tr>
                      <tr><td><b>合同类型</b></td><td>{importResult.extracted.合同类型 || "—"}</td></tr>
                      <tr><td><b>合同金额</b></td><td>¥{importResult.extracted.合同金额?.toLocaleString() || "—"}</td></tr>
                      <tr><td><b>签订日期</b></td><td>{importResult.extracted.签订日期 || "—"}</td></tr>
                      <tr><td><b>开户行</b></td><td>{importResult.extracted.开户行 || "—"}</td></tr>
                      <tr><td><b>账号</b></td><td>{importResult.extracted.账号 || "—"}</td></tr>
                      <tr><td><b>户名</b></td><td>{importResult.extracted.户名 || "—"}</td></tr>
                      <tr><td><b>联系人</b></td><td>{importResult.extracted.联系人 || "—"}</td></tr>
                      <tr><td><b>联系电话</b></td><td>{importResult.extracted.联系电话 || "—"}</td></tr>
                      <tr><td><b>认证体系</b></td><td>
                        {(importResult.extracted.认证体系 || []).join(" / ") || "—"}
                      </td></tr>
                    </tbody>
                  </table>
                </div>

                <div className="match-info">
                  <h5>🤖 智能匹配</h5>
                  {importResult.matched.customer ? (
                    <p>✅ 客户已匹配：<strong>{importResult.matched.customer.name}</strong>
                      （置信度 {Math.round(importResult.matched.customer.confidence * 100)}%，方式：{importResult.matched.customer.matchType}）</p>
                  ) : importResult.matched.newCustomerNeeded ? (
                    <p>🆕 需要新建客户：<strong>{importResult.extracted.甲方客户名}</strong></p>
                  ) : (
                    <p>⚠️ 未匹配到客户</p>
                  )}
                  {importResult.matched.signingEntity && (
                    <p>✅ 签约主体：{importResult.matched.signingEntity.name}</p>
                  )}
                </div>

                {importResult.matched.customer && importResult.matched.signingEntity && (
                  <div className="confirm-actions">
                    <button
                      className="primary-button"
                      onClick={handleConfirmImport}
                      disabled={confirming}
                    >
                      💾 确认入库
                    </button>
                    <button className="ghost-button" onClick={() => setImportResult(null)}>
                      重新上传
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 导入批次 */}
      {tab === "batches" && (
        <section>
          {batches.length === 0 ? (
            <p className="muted">暂无导入批次</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>批次名</th>
                  <th>源目录</th>
                  <th>总数</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>待审</th>
                  <th>状态</th>
                  <th>开始时间</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id}>
                    <td>{b.batch_name}</td>
                    <td className="muted small">{b.source_path}</td>
                    <td>{b.total_files}</td>
                    <td>{b.success_count}</td>
                    <td>{b.failed_count}</td>
                    <td>{b.pending_count}</td>
                    <td>
                      <span className={`status-pill status-${b.status}`}>{b.status}</span>
                    </td>
                    <td className="muted small">{new Date(b.started_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ============ V2.3.2 结构化合同详情 Modal ============ */}
      {selectedContract && (
        <div className="contract-detail-overlay" onClick={closeContractDetail}>
          <div className="contract-detail-panel" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className="contract-detail-loading">
                <div className="spinner" />
                <p>正在加载合同详情...</p>
              </div>
            ) : contractDetail ? (
              <>
                {/* 顶部 */}
                <header className="contract-detail-header">
                  <div>
                    <h2>📋 {contractDetail.contractNo}</h2>
                    <div className="contract-detail-subtitle">
                      <span className={`status-pill status-${contractDetail.status}`}>
                        {contractDetail.status === "draft" ? "草稿" : contractDetail.status === "signed" ? "已签" : contractDetail.status === "effective" ? "生效中" : contractDetail.status === "completed" ? "已完成" : contractDetail.status === "terminated" ? "已终止" : contractDetail.status}
                      </span>
                      <span className="muted">
                        {contractDetail.contractType === "main" ? "主合同" : contractDetail.contractType === "supplement" ? "补充协议" : contractDetail.contractType}
                      </span>
                      <span className="muted">
                        {contractDetail.source === "bulk_import" ? "📂 批量导入" : contractDetail.source === "pdf_import" ? "📥 PDF 导入" : contractDetail.source}
                      </span>
                      {contractDetail.extractionConfidence != null && (
                        <span className="muted">
                          🎯 AI 置信度: {(contractDetail.extractionConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="ghost-button" onClick={closeContractDetail}>✕ 关闭</button>
                </header>

                {/* 主体信息卡片 */}
                {contractDetail.structured && (
                  <div className="contract-parties">
                    <div className="party-card">
                      <div className="party-label">👤 客户（甲方）</div>
                      <div className="party-name">{contractDetail.customerName || "—"}</div>
                    </div>
                    <div className="party-card">
                      <div className="party-label">🏢 乙方主体</div>
                      <div className="party-name">{contractDetail.signingEntityName || "—"}</div>
                      {contractDetail.structured.signingEntity?.aiExtractedName && contractDetail.structured.signingEntity.aiExtractedName !== contractDetail.signingEntityName && (
                        <div className="party-ai">AI抽取: {contractDetail.structured.signingEntity.aiExtractedName}</div>
                      )}
                    </div>
                    <div className="party-card highlight">
                      <div className="party-label">💰 合同总金额</div>
                      <div className="party-name">¥{(contractDetail.contractAmount || 0).toLocaleString()}</div>
                    </div>
                  </div>
                )}

                {/* Tab 导航 */}
                <nav className="contract-detail-tabs">
                  {[
                    { id: "basic", label: "📄 基本信息" },
                    { id: "financial", label: "💳 财务" },
                    { id: "files", label: `📁 文件 (${(contractDetail.files || []).length})` },
                    { id: "ai", label: "🤖 AI抽取" },
                    { id: "ocr", label: "📝 OCR" },
                    { id: "related", label: `🔗 关联 (${(contractDetail.projects || []).length})` }
                  ].map(t => (
                    <button
                      key={t.id}
                      className={`contract-detail-tab ${detailTab === t.id ? "active" : ""}`}
                      onClick={() => setDetailTab(t.id as any)}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>

                {/* Tab 内容 */}
                <div className="contract-detail-content">
                  {/* 基本信息 */}
                  {detailTab === "basic" && contractDetail.structured && (
                    <div className="info-grid">
                      <InfoRow label="合同编号" value={contractDetail.contractNo} />
                      <InfoRow label="合同类型" value={contractDetail.structured.certification.category || contractDetail.contractType} />
                      <InfoRow label="签订日期" value={formatDate(contractDetail.signedAt || contractDetail.structured.timeline.signedAt)} />
                      <InfoRow label="生效日期" value={formatDate(contractDetail.structured.timeline.effectiveAt)} />
                      <InfoRow label="到期日期" value={formatDate(contractDetail.structured.timeline.expireAt)} />
                      <InfoRow label="服务类型" value={contractDetail.structured.aiMeta.serviceType} />
                      <InfoRow label="认证体系" value={contractDetail.structured.certification.systems.join(", ")} />
                      <InfoRow label="认证范围" value={contractDetail.structured.certification.scope} />
                      <InfoRow label="审核区域" value={contractDetail.structured.certification.auditRegion} />
                      <InfoRow label="员工人数" value={contractDetail.structured.certification.employeeCount} />
                      <InfoRow label="分场所数" value={contractDetail.structured.certification.siteCount} />
                      <InfoRow label="临时现场数" value={contractDetail.structured.certification.tempSiteCount} />
                      <InfoRow label="认可标志" value={contractDetail.structured.certification.accreditationMark} />
                      <InfoRow label="证书有效期" value={contractDetail.structured.certification.certificateValidity} />
                      <InfoRow label="特殊要求" value={contractDetail.structured.certification.specialRequirements} />
                    </div>
                  )}

                  {/* 财务 */}
                  {detailTab === "financial" && contractDetail.structured && (
                    <div>
                      <div className="info-section">
                        <h3>💰 费用明细</h3>
                        <div className="info-grid">
                          <InfoRow label="合同总金额" value={`¥${(contractDetail.structured.financial.totalAmount || 0).toLocaleString()}`} highlight />
                          <InfoRow label="初次认证费" value={formatAmount(contractDetail.structured.financial.firstAuditFee)} />
                          <InfoRow label="第一年监督费" value={formatAmount(contractDetail.structured.financial.firstYearSupervisionFee)} />
                          <InfoRow label="第二年监督费" value={formatAmount(contractDetail.structured.financial.secondYearSupervisionFee)} />
                          <InfoRow label="再认证费" value={formatAmount(contractDetail.structured.financial.recertFee)} />
                          <InfoRow label="付款条款" value={contractDetail.structured.financial.paymentTerms} />
                        </div>
                      </div>
                      <div className="info-section">
                        <h3>🏦 收款银行</h3>
                        <div className="info-grid">
                          <InfoRow label="开户行" value={contractDetail.structured.financial.bankName} />
                          <InfoRow label="户名" value={contractDetail.structured.financial.bankHolder} />
                          <InfoRow label="账号" value={contractDetail.structured.financial.bankAccount} mono />
                        </div>
                      </div>
                      <div className="info-section">
                        <h3>📞 联系人</h3>
                        <div className="info-grid">
                          <InfoRow label="联系人" value={contractDetail.structured.contact.person} />
                          <InfoRow label="电话" value={contractDetail.structured.contact.phone} mono />
                          <InfoRow label="邮箱" value={contractDetail.structured.contact.email} />
                          <InfoRow label="职务" value={contractDetail.structured.contact.position} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 文件 */}
                  {detailTab === "files" && (
                    <div>
                      {(contractDetail.files || []).length === 0 ? (
                        <p className="muted">📭 暂无关联文件</p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr><th>文件名</th><th>类型</th><th>大小</th><th>SHA256</th><th>上传时间</th><th>操作</th></tr>
                          </thead>
                          <tbody>
                            {contractDetail.files.map((f: any) => (
                              <tr key={f.id}>
                                <td><code>{f.fileName}</code></td>
                                <td>{f.fileType}</td>
                                <td>{(f.fileSize / 1024).toFixed(1)} KB</td>
                                <td className="mono small">{f.sha256?.slice(0, 16)}...</td>
                                <td>{formatDate(f.uploadedAt)}</td>
                                <td>
                                  <a
                                    href={`/ai/api/contracts/files/${f.id}/download`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="link-button"
                                  >📥 下载</a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* AI抽取 */}
                  {detailTab === "ai" && (
                    <div>
                      <div className="info-section">
                        <h3>🤖 AI 抽取元数据</h3>
                        <div className="info-grid">
                          <InfoRow label="抽取置信度" value={contractDetail.extractionConfidence != null ? `${(contractDetail.extractionConfidence * 100).toFixed(0)}%` : "—"} />
                          <InfoRow label="AI 模型" value={contractDetail.structured?.aiMeta?.aiModel || "本地 qwen2.5:7b"} />
                          <InfoRow label="抽取时间" value={formatDate(contractDetail.structured?.aiMeta?.extractedAt)} />
                          <InfoRow label="数据来源" value={contractDetail.structured?.aiMeta?.source} />
                        </div>
                      </div>
                      <div className="info-section">
                        <h3>📋 AI 原始返回 JSON</h3>
                        <pre className="ocr-text-viewer">
                          {JSON.stringify(contractDetail.rawExtracted, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* OCR */}
                  {detailTab === "ocr" && (
                    <div>
                      {contractDetail.primaryFile?.ocrText ? (
                        <>
                          <div className="info-section">
                            <h3>📝 OCR 提取文本（前 5000 字符）</h3>
                            <p className="muted small">共 {contractDetail.primaryFile.ocrText.length} 字符</p>
                          </div>
                          <pre className="ocr-text-viewer">{contractDetail.primaryFile.ocrText}</pre>
                        </>
                      ) : (
                        <p className="muted">📭 暂无 OCR 文本</p>
                      )}
                    </div>
                  )}

                  {/* 关联 */}
                  {detailTab === "related" && (
                    <div>
                      <div className="info-section">
                        <h3>🔗 关联项目</h3>
                        {(contractDetail.projects || []).length === 0 ? (
                          <p className="muted">暂无关联项目</p>
                        ) : (
                          <ul>{contractDetail.projects.map((p: any) => <li key={p.id}>{p.name || p.id}</li>)}</ul>
                        )}
                      </div>
                      <div className="info-section">
                        <h3>📜 状态变更历史</h3>
                        {(contractDetail.events || []).length === 0 ? (
                          <p className="muted">暂无变更记录</p>
                        ) : (
                          <ul>{contractDetail.events.map((e: any) => (
                            <li key={e.id}>
                              <code>{e.event_type}</code> - {formatDate(e.created_at)}
                            </li>
                          ))}</ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 底部操作 */}
                <footer className="contract-detail-footer">
                  {contractDetail.fileId && (
                    // V2.3.4：fetch + blob 下载（带 Authorization header）
                    // - 解决 `<a target=_blank>` / `<a download>` 路径下：vite dev SPA fallback 把 /ai/api/* 当 index.html
                    //   返回，导致浏览器下载了 "download.htm" 而不是 PDF
                    // - 走 fetch 走 vite 代理 /api/* → 后端 → 拿到真实 PDF blob → 触发下载
                    <button
                      type="button"
                      className="primary-button"
                      title="点击下载到本地（合同原件可能是 PDF/DOC/DOCX）"
                      onClick={async () => {
                        try {
                          // V2.3.4：fetch + cookie + blob 下载
                          // 解决 `<a target=_blank>` 路径下 vite dev SPA fallback 把 /ai/api/* 当 index.html
                          //   返回，导致浏览器下载了 "download.htm" 而不是 PDF
                          // 后端 auth 支持 cookie 认证（不只是 Bearer），所以 fetch + credentials:"include" 即可
                          const resp = await fetch(`/api/contracts/files/${contractDetail.fileId}/download`, {
                            credentials: "include",
                          });
                          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                          const blob = await resp.blob();
                          // 防御：vite dev SPA fallback 时返回 text/html，那不是合同文件
                          if (blob.type && blob.type.includes("text/html")) {
                            throw new Error("后端返回 HTML（可能 vite dev 把请求当 SPA 路由了），请重试或检查登录状态");
                          }
                          // V2.3.4：取第一个原文件的真名 + 扩展名（合同可能是 PDF/DOC/DOCX，不写死）
                          // - contractDetail.primaryFile 是后端挂在合同详情上的第一个文件对象
                          // - 之前用 contractDetail.fileName 是合同主表字段（合同号），fallback 到 "contract.pdf" 把 doc 文件存成了 .pdf
                          const fileName = contractDetail.primaryFile?.fileName
                            || contractDetail.files?.[0]?.fileName
                            || `contract-${contractDetail.contractNo || contractDetail.id}.bin`;
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = fileName;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                          ToastManager.success("已下载：" + a.download);
                        } catch (e: any) {
                          ToastManager.error("下载失败：" + (e?.message || "未知"));
                        }
                      }}
                    >📄 下载原件</button>
                  )}
                  <button className="ghost-button" onClick={closeContractDetail}>关闭</button>
                </footer>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// V2.3.2 辅助组件：信息行
function InfoRow({ label, value, mono, highlight }: { label: string; value: any; mono?: boolean; highlight?: boolean }) {
  const display = value === null || value === undefined || value === "" ? <span className="muted">—</span> : value;
  return (
    <div className={`info-row ${highlight ? "highlight" : ""}`}>
      <span className="info-label">{label}</span>
      <span className={`info-value ${mono ? "mono" : ""}`}>{display}</span>
    </div>
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("zh-CN") + " " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return d;
  }
}

function formatAmount(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return `¥${n.toLocaleString()}`;
}