import { Calendar, FileText, History } from "lucide-react";
import { useState } from "react";
import { MarkdownResult } from "../components/MarkdownResult";
import type { ConsultationRecord, Employee } from "../types";

interface ResultsPageProps {
  consultations: ConsultationRecord[];
  employees: Employee[];
}

export function ResultsPage({ consultations, employees }: ResultsPageProps) {
  const [selected, setSelected] = useState<ConsultationRecord | null>(null);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">成果中心</span>
          <h1>咨询记录与方案资产</h1>
          <p>保留每次咨询的需求、模型、知识引用和生成成果，便于复用与迭代。</p>
        </div>
      </header>

      {consultations.length ? (
        <section className="results-list">
          {consultations.map((item) => (
            <button className="result-row" key={item.id} onClick={() => setSelected(item)}>
              <div className="result-file-icon"><FileText size={20} /></div>
              <div className="result-main">
                <h2>{item.deliverable}</h2>
                <p>{item.request}</p>
                <div>
                  <span>{employees.find((employee) => employee.id === item.role)?.name}</span>
                  <span>{item.industry}</span>
                  <span>{item.references.length} 条知识引用</span>
                </div>
              </div>
              <time>
                <Calendar size={15} />
                {new Date(item.createdAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </time>
            </button>
          ))}
        </section>
      ) : (
        <div className="empty-state standalone">
          <History size={30} />
          <h2>还没有咨询成果</h2>
          <p>完成第一次咨询后，结果会自动保存在这里。</p>
        </div>
      )}

      {selected && (
        <MarkdownResult
          content={selected.result}
          title={selected.deliverable}
          consultation={selected}
        />
      )}
    </div>
  );
}
