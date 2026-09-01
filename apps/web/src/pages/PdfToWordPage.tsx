import { useState } from "react";
import { Bot, Download, FileText, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { api } from "../lib/api";

type ConversionMode = "ollama" | "demo";

const MODES: Array<{ value: ConversionMode; label: string; description: string }> = [
  {
    value: "ollama",
    label: "LLM 重排版（推荐）",
    description: "本地 Ollama 模型解析结构 + 真实表格 + 标题分级"
  },
  {
    value: "demo",
    label: "快速文本提取",
    description: "纯 pdftotext，速度快但版式简单"
  }
];

export function PdfToWordPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ConversionMode>("ollama");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<{ filename: string; size: number; mode: string } | null>(null);

  async function handleConvert(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setLastResult(null);
    try {
      const { blob, filename } = await api.pdfToDocx(file, mode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastResult({ filename, size: blob.size, mode });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "转换失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">文档工作流</span>
          <h1>PDF 转 Word</h1>
          <p>
            把 PDF 文档转成可编辑的 Word（.docx）文件。
            <strong> LLM 模式</strong>会重新识别标题 / 表格 / 列表结构，效果更好。
          </p>
        </div>
      </header>

      <section className="document-workspace">
        <form className="document-form" onSubmit={handleConvert}>
          <label className="document-drop" htmlFor="pdf-file">
            <FileText size={34} />
            <strong>{file ? file.name : "选择需要转换的 PDF"}</strong>
            <p>支持 .pdf 文件，最大 200 MB</p>
            <span className="secondary-button">
              <Upload size={17} /> 选择文件
            </span>
            <input
              id="pdf-file"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>

          <fieldset className="form-grid">
            <legend className="form-legend">转换模式</legend>
            {MODES.map((m) => (
              <label key={m.value} className="field">
                <span className="radio-row">
                  <input
                    type="radio"
                    name="mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                  />
                  <strong>{m.label}</strong>
                </span>
                <small>{m.description}</small>
              </label>
            ))}
          </fieldset>

          <button
            className="primary-button full-button"
            disabled={!file || loading}
            type="submit"
          >
            {loading ? (
              <>
                <LoaderCircle className="spin" size={18} /> 转换中…
              </>
            ) : (
              <>
                {mode === "ollama" ? <Sparkles size={18} /> : <Bot size={18} />}
                开始转换
              </>
            )}
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}

        {lastResult && (
          <div className="success-card">
            <Download size={18} />
            <div>
              <strong>转换完成</strong>
              <p>
                已下载 <code>{lastResult.filename}</code>
                （{(lastResult.size / 1024).toFixed(1)} KB，模式：{lastResult.mode}）
              </p>
            </div>
          </div>
        )}

        <div className="tool-tips">
          <h3>模式说明</h3>
          <ul>
            <li>
              <strong>LLM 重排版</strong>：pdftotext 提取文本后，由 Ollama qwen2.5
              模型识别标题层级、合并表格行、抽取列表项，输出更接近原始版式。
            </li>
            <li>
              <strong>快速文本提取</strong>：直接 pdftotext 写 docx，速度快但版式简单。
            </li>
            <li>PDF 加密或扫描件可能识别不准确，建议提供清晰文本型 PDF。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}