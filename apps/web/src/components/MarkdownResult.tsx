import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ConsultationRecord } from "../types";
import { DocxExportDialog } from "./DocxExportDialog";
import { PptxExportDialog } from "./PptxExportDialog";

interface MarkdownResultProps {
  content: string;
  title: string;
  consultation?: ConsultationRecord;
}

export function MarkdownResult({ content, title, consultation }: MarkdownResultProps) {
  const [copied, setCopied] = useState(false);

  async function copyContent() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function downloadContent() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="result-panel" aria-live="polite">
      <div className="result-toolbar">
        <div>
          <span className="eyebrow">AI 生成成果</span>
          <h2>{title}</h2>
        </div>
        <div className="toolbar-actions">
          {consultation && <DocxExportDialog consultation={consultation} />}
          {consultation && <PptxExportDialog consultation={consultation} />}
          <button className="icon-command" onClick={copyContent} title="复制内容">
            {copied ? <Check size={17} /> : <Copy size={17} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
          <button className="icon-command" onClick={downloadContent} title="下载 Markdown">
            <Download size={17} />
            <span>下载</span>
          </button>
        </div>
      </div>
      <article className="markdown-body">
        <ReactMarkdown>{content}</ReactMarkdown>
      </article>
    </section>
  );
}
