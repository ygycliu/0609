import { FileSearch, FileUp, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { MarkdownResult } from "../components/MarkdownResult";
import { ToastManager } from "../components/Toast";
import { api } from "../lib/api";
import type { ModelOption, ModelProvider } from "../types";

export function DocumentsPage({ models }: { models: ModelOption[] }) {
  const [file, setFile] = useState<File | null>(null);
  const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
  const [industry, setIndustry] = useState("通用");
  const [model, setModel] = useState<ModelProvider>("demo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    fileName: string;
    characters: number;
    result: string;
  } | null>(null);

  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("industry", industry);
    form.append("model", model);
    try {
      setResult(await api.analyzeDocument(form));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">文档工作流</span>
          <h1>上传资料，快速获得专业分析</h1>
          <p>解析文件内容、匹配知识库，输出摘要、关键结论、风险与行动建议。</p>
        </div>
      </header>

      <section className="document-workspace">
        <form className="document-form" onSubmit={analyze}>
          <label className="document-drop" htmlFor="analysis-file">
            <FileSearch size={34} />
            <strong>{file ? file.name : "选择需要分析的文件"}</strong>
            <p>支持 PDF、Word、PPT 和常用文本格式，最大 200MB</p>
            <span className="secondary-button"><FileUp size={17} /> 浏览文件</span>
            <input
              id="analysis-file"
              type="file"
              accept=".txt,.md,.csv,.json,.pdf,.docx,.pptx"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                if (selected && selected.size > MAX_FILE_SIZE) {
                  ToastManager.error(`❌ 文件 ${selected.name} 超过 200MB 限制（当前 ${(selected.size / 1024 / 1024).toFixed(1)}MB）`);
                  event.target.value = "";
                  setFile(null);
                  return;
                }
                setFile(selected);
              }}
              required
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>行业 / 领域</span>
              <input value={industry} onChange={(event) => setIndustry(event.target.value)} />
            </label>
            <label className="field">
              <span>模型通道</span>
              <select value={model} onChange={(event) => setModel(event.target.value as ModelProvider)}>
                {models.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.available}>
                    {item.name}{item.available ? "" : "（未配置）"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary-button full-button" disabled={!file || loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <FileSearch size={18} />}
            {loading ? "正在解析与分析" : "开始文档分析"}
          </button>
          {error && <div className="error-banner">{error}</div>}
        </form>

        <aside className="analysis-process">
          <span className="eyebrow">处理流程</span>
          <ol>
            {["安全读取文件", "提取正文内容", "匹配知识条目", "生成结构化结论"].map(
              (step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step}</strong>
                    <small>
                      {["验证类型与大小", "保留可分析文本", "寻找方法与案例依据", "输出风险与行动建议"][index]}
                    </small>
                  </div>
                </li>
              )
            )}
          </ol>
        </aside>
      </section>

      {result && (
        <>
          <div className="analysis-summary">
            <span>文件：{result.fileName}</span>
            <span>已解析 {result.characters.toLocaleString("zh-CN")} 字符</span>
          </div>
          <MarkdownResult content={result.result} title={`${result.fileName}-分析报告`} />
        </>
      )}
    </div>
  );
}
