import {
  Download,
  FileChartColumn,
  LoaderCircle,
  Presentation,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ConsultationRecord } from "../types";

interface PptxExportDialogProps {
  consultation: ConsultationRecord;
}

interface ExportForm {
  companyName: string;
  clientName: string;
  projectName: string;
  presentationTitle: string;
  version: string;
  presenter: string;
  confidentiality: string;
  includeReferences: boolean;
}

const organizationStorageKey = "consulting-center-pptx-organization";

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

export function PptxExportDialog({ consultation }: PptxExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ExportForm>(() => {
    const stored = storedOrganization();
    return {
      companyName: stored.companyName ?? "本企业AI数字化中心",
      clientName: stored.clientName ?? "客户单位",
      projectName: `${consultation.industry}数字化建设项目`,
      presentationTitle: consultation.deliverable,
      version: "V1.0",
      presenter: stored.presenter ?? "数字化咨询团队",
      confidentiality: stored.confidentiality ?? "内部资料",
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

  async function exportPptx(event: React.FormEvent) {
    event.preventDefault();
    setExporting(true);
    setError("");
    try {
      const blob = await api.exportConsultationPptx(consultation.id, form);
      localStorage.setItem(
        organizationStorageKey,
        JSON.stringify({
          companyName: form.companyName,
          clientName: form.clientName,
          presenter: form.presenter,
          confidentiality: form.confidentiality
        })
      );
      saveBlob(blob, `${form.presentationTitle}-${form.version}.pptx`);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PPT 演示生成失败");
    } finally {
      setExporting(false);
    }
  }

  async function downloadTemplate() {
    setTemplateLoading(true);
    setError("");
    try {
      saveBlob(
        await api.digitalTransformationPresentationTemplate(),
        "数字化建设方案演示模板.pptx"
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "演示模板下载失败");
    } finally {
      setTemplateLoading(false);
    }
  }

  return (
    <>
      <button
        className="icon-command pptx-command"
        onClick={() => setOpen(true)}
        title="导出可编辑 PowerPoint 演示"
      >
        <Presentation size={17} />
        <span>导出 PPT</span>
      </button>

      {open && (
        <div className="modal-layer" role="presentation">
          <button
            className="modal-backdrop"
            aria-label="关闭 PPT 导出设置"
            onClick={() => setOpen(false)}
          />
          <section
            className="docx-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pptx-dialog-title"
          >
            <header className="dialog-header">
              <div className="dialog-icon pptx-dialog-icon">
                <Presentation size={21} />
              </div>
              <div>
                <span className="eyebrow">原生 PPTX</span>
                <h2 id="pptx-dialog-title">导出数字化建设方案演示</h2>
                <p>咨询内容会重组为 10 页企业汇报结构，所有标题、图形和文本均可编辑。</p>
              </div>
              <button
                className="dialog-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={19} />
              </button>
            </header>

            <form className="docx-form" onSubmit={exportPptx}>
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
                <span>演示标题</span>
                <input
                  value={form.presentationTitle}
                  onChange={(event) => update("presentationTitle", event.target.value)}
                  required
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>演示版本</span>
                  <input
                    value={form.version}
                    onChange={(event) => update("version", event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>汇报人员</span>
                  <input
                    value={form.presenter}
                    onChange={(event) => update("presenter", event.target.value)}
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
                    checked={form.includeReferences}
                    onChange={(event) => update("includeReferences", event.target.checked)}
                  />
                  <span>在结尾页显示知识依据</span>
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
                    <FileChartColumn size={17} />
                  )}
                  下载空白演示模板
                </button>
                <button className="primary-button pptx-primary" disabled={exporting}>
                  {exporting ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Download size={18} />
                  )}
                  {exporting ? "正在生成 PPT" : "生成并下载 PPTX"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
