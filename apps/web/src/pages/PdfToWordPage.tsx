import { useState } from "react";
import { Download, FileText, LoaderCircle, Upload } from "lucide-react";
import { api } from "../lib/api";

export function PdfToWordPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<{ filename: string; size: number } | null>(null);

  async function handleConvert(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setLastResult(null);
    try {
      const { blob, filename } = await api.pdfToDocx(file);
      // 触发浏览器下载
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastResult({ filename, size: blob.size });
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
          <p>把 PDF 文档转成可编辑的 Word（.docx）文件，保留原始排版与字体。</p>
        </div>
      </header>

      <section className="document-workspace">
        <form className="document-form" onSubmit={handleConvert}>
          <label className="document-drop" htmlFor="pdf-file">
            <FileText size={34} />
            <strong>{file ? file.name : "选择需要转换的 PDF"}</strong>
            <p>支持 .pdf 文件，最大 15 MB，转换后可下载 .docx</p>
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
                <Download size={18} /> 开始转换
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
                （{(lastResult.size / 1024).toFixed(1)} KB）
              </p>
            </div>
          </div>
        )}

        <div className="tool-tips">
          <h3>使用说明</h3>
          <ul>
            <li>转换由 LibreOffice 后端处理，文件不会保存到服务器。</li>
            <li>加密 PDF 或纯扫描件可能无法准确还原文本。</li>
            <li>大文件（接近 15 MB）转换需要 10-30 秒。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}