import {
  Building2,
  Download,
  FileDown,
  FileText,
  LoaderCircle,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ConsultationRecord } from "../types";

interface DocxExportDialogProps {
  consultation: ConsultationRecord;
}

interface ExportForm {
  companyName: string;
  clientName: string;
  projectName: string;
  documentTitle: string;
  version: string;
  preparedBy: string;
  confidentiality: string;
  includeToc: boolean;
  includeReferences: boolean;
}

const organizationStorageKey = "consulting-center-docx-organization";

function storedOrganization() {
  try {
    return JSON.parse(localStorage.getItem(organizationStorageKey) ?? "{}") as Partial<ExportForm>;
  } catch {
    return {};
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  URL.revokeObjectURL(link.href);
}

export function DocxExportDialog({ consultation }: DocxExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ExportForm>(() => {
    const stored = storedOrganization();
    return {
      companyName: stored.companyName ?? "本企业数字化咨询中心",
      clientName: stored.clientName ?? "客户单位",
      projectName: `${consultation.industry}数字化建设项目`,
      documentTitle: consultation.deliverable,
      version: "V1.0",
      preparedBy: stored.preparedBy ?? "数字化咨询团队",
      confidentiality: stored.confidentiality ?? "内部资料",
      includeToc: true,
      includeReferences: true
    };
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function update<K extends keyof ExportForm>(key: K, value: ExportForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function exportDocx(event: React.FormEvent) {
    event.preventDefault();
    setExporting(true);
    setError("");
    try {
      const blob = await api.exportConsultationDocx(consultation.id, form);
      localStorage.setItem(
        organizationStorageKey,
        JSON.stringify({
          companyName: form.companyName,
          clientName: form.clientName,
          preparedBy: form.preparedBy,
          confidentiality: form.confidentiality
        })
      );
      saveBlob(blob, `${form.documentTitle}-${form.version}.docx`);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Word 报告生成失败");
    } finally {
      setExporting(false);
    }
  }

  async function downloadTemplate() {
    setTemplateLoading(true);
    setError("");
    try {
      saveBlob(
        await api.enterpriseSolutionTemplate(),
        "企业数字化建设方案模板.docx"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模板下载失败");
    } finally {
      setTemplateLoading(false);
    }
  }

  return (
    <>
      <button
        className="icon-command docx-command"
        onClick={() => setOpen(true)}
        title="导出可编辑 Word 报告"
      >
        <FileDown size={17} />
        <span>导出 Word</span>
      </button>

      {open && (
        <div className="modal-layer" role="presentation">
          <button
            className="modal-backdrop"
            aria-label="关闭 Word 导出设置"
            onClick={() => setOpen(false)}
          />
          <section
            className="docx-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="docx-dialog-title"
          >
            <header className="dialog-header">
              <div className="dialog-icon"><FileText size={21} /></div>
              <div>
                <span className="eyebrow">原生 DOCX</span>
                <h2 id="docx-dialog-title">导出企业咨询报告</h2>
                <p>以下内容将写入封面、页眉和文档控制表，导出后可在 Word/WPS 中编辑。</p>
              </div>
              <button
                className="dialog-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={19} />
              </button>
            </header>

            <form className="docx-form" onSubmit={exportDocx}>
              <div className="form-grid">
                <label className="field">
                  <span>编制单位</span>
                  <input
                    value={form.companyName}
                    onChange={(event) => update("companyName", event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>客户单位</span>
                  <input
                    value={form.clientName}
                    onChange={(event) => update("clientName", event.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="field">
                <span>项目名称</span>
                <input
                  value={form.projectName}
                  onChange={(event) => update("projectName", event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>文档标题</span>
                <input
                  value={form.documentTitle}
                  onChange={(event) => update("documentTitle", event.target.value)}
                  required
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>文档版本</span>
                  <input
                    value={form.version}
                    onChange={(event) => update("version", event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>编制人员</span>
                  <input
                    value={form.preparedBy}
                    onChange={(event) => update("preparedBy", event.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="field">
                <span>密级 / 使用范围</span>
                <select
                  value={form.confidentiality}
                  onChange={(event) => update("confidentiality", event.target.value)}
                >
                  <option>内部资料</option>
                  <option>客户资料</option>
                  <option>商业秘密</option>
                  <option>公开资料</option>
                </select>
              </label>

              <div className="export-options">
                <label>
                  <input
                    type="checkbox"
                    checked={form.includeToc}
                    onChange={(event) => update("includeToc", event.target.checked)}
                  />
                  <span>包含自动目录</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.includeReferences}
                    onChange={(event) => update("includeReferences", event.target.checked)}
                  />
                  <span>包含知识依据</span>
                </label>
              </div>

              {error && <div className="error-banner">{error}</div>}

              <footer className="dialog-footer">
                <button
                  type="button"
                  className="template-button"
                  onClick={downloadTemplate}
                  disabled={templateLoading}
                >
                  {templateLoading ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Building2 size={17} />
                  )}
                  下载空白企业方案模板
                </button>
                <button className="primary-button" disabled={exporting}>
                  {exporting ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Download size={18} />
                  )}
                  {exporting ? "正在生成 Word" : "生成并下载 DOCX"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
