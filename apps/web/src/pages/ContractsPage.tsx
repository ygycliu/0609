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
  const [stats, setStats] = useState<any>(null);

  // PDF 导入
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 批次
  const [batches, setBatches] = useState<any[]>([]);

  const loadContracts = async () => {
    setLoading(true);
    try {
      const r = await api.listContracts({ ...filter, limit: 50 });
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
  }, [filter]);

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
                    <td><code>{c.contractNo}</code></td>
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
    </div>
  );
}