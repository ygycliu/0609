/**
 * V2.3 合同模板引擎页面
 */
import { useEffect, useState } from "react";
import { api, importContractFromPdf } from "../lib/api";
import { ToastManager } from "../components/Toast";

interface Template {
  id: string;
  code: string;
  name: string;
  description: string | null;
  signingEntityId: string;
  templateCategory: "main" | "supplement" | "supervision" | "recertification";
  contractType: "HZCX" | "ZRC" | "EXTERNAL" | null;
  chapterCount: number;
  fieldSchema: any;
  chapterSchema: any;
  status: string;
  version: number;
  createdAt: string;
}

interface Field {
  id: string;
  field_code: string;
  field_label: string;
  field_category: string;
  data_type: string;
  enum_options: any;
  required: boolean;
  applies_to: string[];
  description: string;
  example_value: string;
}

interface Generation {
  id: string;
  templateId: string;
  templateVersion: number;
  customerId: string;
  customerName: string;
  templateName: string;
  fileSize: number;
  generationTimeMs: number;
  status: string;
  createdAt: string;
  outputFormat: string;
}

export default function TemplateEnginePage() {
  const [tab, setTab] = useState<"templates" | "generate" | "history" | "fields">("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [history, setHistory] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(false);

  // 生成表单
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [generating, setGenerating] = useState(false);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const r = await api.listContractTemplates({});
      setTemplates(r.data || []);
    } catch (e: any) {
      ToastManager.error("加载模板失败：" + e.message);
    } finally { setLoading(false); }
  };

  const loadFields = async () => {
    try {
      const r = await api.listContractFields();
      setFields(r.data || []);
    } catch (e) { /* */ }
  };

  const loadHistory = async () => {
    try {
      const r = await api.listTemplateGenerations();
      setHistory(r.data || []);
    } catch (e) { /* */ }
  };

  useEffect(() => {
    loadTemplates();
    loadFields();
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  const handleGenerate = async () => {
    if (!selectedTemplate || !customerId) {
      ToastManager.error("请选模板 + 客户");
      return;
    }
    setGenerating(true);
    try {
      const r = await api.generateContract({
        templateId: selectedTemplate.id,
        customerId,
        fieldValues,
        outputFormat: "pdf"
      });
      ToastManager.success(`✅ 合同生成成功！${r.data.fileSize} 字节（${r.data.generationTimeMs} ms）`);
      // 触发下载
      window.open(`/ai${r.data.downloadUrl}`, "_blank");
      setFieldValues({});
      loadHistory();
    } catch (e: any) {
      ToastManager.error("生成失败：" + e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1>📄 合同模板引擎</h1>
        <div className="tab-bar">
          <button className={`tab ${tab === "templates" ? "active" : ""}`} onClick={() => setTab("templates")}>
            模板库
          </button>
          <button className={`tab ${tab === "generate" ? "active" : ""}`} onClick={() => setTab("generate")}>
            生成合同
          </button>
          <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            生成历史
          </button>
          <button className={`tab ${tab === "fields" ? "active" : ""}`} onClick={() => setTab("fields")}>
            字段字典
          </button>
        </div>
      </header>

      {/* 模板库 */}
      {tab === "templates" && (
        <section>
          {loading ? (
            <p className="muted">加载中...</p>
          ) : templates.length === 0 ? (
            <p className="muted">暂无模板</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>模板编号</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>分类</th>
                  <th>章节</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id}>
                    <td><code>{t.code}</code></td>
                    <td>{t.name}</td>
                    <td><span className={`type-pill type-${t.contractType || 'OTHER'}`}>{t.contractType || '其他'}</span></td>
                    <td>{t.templateCategory}</td>
                    <td>{t.chapterCount} 章</td>
                    <td><span className={`status-pill status-${t.status}`}>{t.status}</span></td>
                    <td>
                      <button className="link-button" onClick={() => {
                        setSelectedTemplate(t);
                        setTab("generate");
                      }}>📝 生成</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 生成合同 */}
      {tab === "generate" && (
        <section>
          <div className="generate-form">
            <h3>📝 生成合同</h3>

            {!selectedTemplate ? (
              <p className="muted">先在"模板库"选择一个模板</p>
            ) : (
              <>
                <div className="form-row">
                  <label>已选模板</label>
                  <strong>{selectedTemplate.code} - {selectedTemplate.name}</strong>
                </div>
                <div className="form-row">
                  <label>客户 ID</label>
                  <input
                    type="text"
                    value={customerId}
                    onChange={e => setCustomerId(e.target.value)}
                    placeholder="UUID"
                  />
                  <small>从客户管理复制</small>
                </div>

                <div className="form-row">
                  <label>字段值</label>
                  <textarea
                    placeholder='{"customer_name":"...", "first_audit_fee":8000, ...}'
                    value={JSON.stringify(fieldValues, null, 2)}
                    onChange={e => {
                      try {
                        setFieldValues(JSON.parse(e.target.value || "{}"));
                      } catch { /* invalid JSON, ignore */ }
                    }}
                    rows={10}
                    style={{ width: "100%", fontFamily: "monospace" }}
                  />
                </div>

                <button
                  className="primary-button"
                  onClick={handleGenerate}
                  disabled={generating || !customerId}
                >
                  {generating ? "⏳ 生成中..." : "💾 生成 PDF"}
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* 生成历史 */}
      {tab === "history" && (
        <section>
          {history.length === 0 ? (
            <p className="muted">暂无生成历史</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模板</th>
                  <th>客户</th>
                  <th>格式</th>
                  <th>大小</th>
                  <th>耗时</th>
                  <th>状态</th>
                  <th>下载</th>
                </tr>
              </thead>
              <tbody>
                {history.map(g => (
                  <tr key={g.id}>
                    <td className="muted small">{new Date(g.createdAt).toLocaleString()}</td>
                    <td>{g.templateName || g.templateId}</td>
                    <td>{g.customerName || g.customerId}</td>
                    <td>{g.outputFormat}</td>
                    <td>{(g.fileSize / 1024).toFixed(1)} KB</td>
                    <td>{g.generationTimeMs} ms</td>
                    <td><span className={`status-pill status-${g.status}`}>{g.status}</span></td>
                    <td>
                      <a
                        href={`/ai/api/template-engine/generations/${g.id}/download`}
                        className="link-button"
                      >📥 下载</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 字段字典 */}
      {tab === "fields" && (
        <section>
          {fields.length === 0 ? (
            <p className="muted">暂无字段</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>字段名</th>
                  <th>标签</th>
                  <th>分类</th>
                  <th>类型</th>
                  <th>必填</th>
                  <th>适用</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(f => (
                  <tr key={f.id}>
                    <td><code>{f.field_code}</code></td>
                    <td>{f.field_label}</td>
                    <td>{f.field_category}</td>
                    <td>{f.data_type}</td>
                    <td>{f.required ? "✅" : ""}</td>
                    <td>{(f.applies_to || []).join(", ")}</td>
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