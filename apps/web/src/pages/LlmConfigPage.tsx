/**
 * V2.3.3 大模型配置页面（AI 中心全局默认）
 *
 * 功能：
 *  1. 显示当前生效的配置（来源：DB 优先 / .env 回退）
 *  2. 编辑后保存 → 后端 AES-256-GCM 加密 API key → DB
 *  3. 一键连通性测试（调 model.gateway 的实际请求）
 *  4. 查看变更审计日志
 *  5. 重置为 .env 默认值
 *
 * 安全：
 *  - API key 仅首次保存/更新时由用户输入；列表展示时只显示掩码
 *  - 后端永不返回明文 key
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Eye,
  EyeOff,
  History,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Zap
} from "lucide-react";
import { ToastManager } from "../components/Toast";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await resp.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!resp.ok) {
    const msg = (body && (body.message || body.error)) || `Request failed (${resp.status})`;
    throw new Error(msg);
  }
  return body as T;
}


type Provider = "openai" | "ollama";

interface LlmConfig {
  source: "db" | "env";
  provider: Provider;
  model_name: string;
  base_url: string;
  api_key_set: boolean;
  api_key_masked: string | null;
  num_ctx: number;
  temperature: number;
  timeout_ms: number;
  updated_at: string | null;
  updated_by: string | null;
}

interface LlmConfigLogEntry {
  id: number;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  operator: string | null;
  reason: string | null;
  created_at: string;
}

interface LlmConfigPageProps {
  currentUser?: { displayName?: string; username?: string; role?: string } | null;
  onLogout?: () => void | Promise<void>;
}

export function LlmConfigPage({ currentUser, onLogout }: LlmConfigPageProps = {}) {
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [logs, setLogs] = useState<LlmConfigLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // 表单
  const [provider, setProvider] = useState<Provider>("openai");
  const [modelName, setModelName] = useState("MiniMax-M3");
  const [baseUrl, setBaseUrl] = useState("https://api.MiniMax.chat/v1");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [numCtx, setNumCtx] = useState(4096);
  const [temperature, setTemperature] = useState(0.3);
  const [timeoutSec, setTimeoutSec] = useState(60);
  const [changeReason, setChangeReason] = useState("");

  // Ollama 本地模型列表
  const [ollamaModels, setOllamaModels] = useState<Array<{ id: string; name: string; model: string; description: string }>>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latency_ms?: number;
    preview?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  // Provider 切到 ollama 时拉本地模型列表
  useEffect(() => {
    if (provider !== "ollama" || ollamaModels.length > 0) return;
    setOllamaLoading(true);
    apiFetch<{ data: Array<{ id: string; name: string; model?: string; description?: string; category: string }> }>("/models")
      .then((resp) => {
        const items = (resp.data || [])
          .filter((m) => m.category === "ollama")
          .map((m) => ({
            id: m.id,
            name: m.name,
            model: m.model ?? m.id.replace(/^ollama:/, ""),
            description: m.description ?? ""
          }));
        setOllamaModels(items);
      })
      .catch((e) => {
        ToastManager.warning("拉取 Ollama 本地模型失败：" + (e instanceof Error ? e.message : String(e)));
      })
      .finally(() => setOllamaLoading(false));
  }, [provider, ollamaModels.length]);

  async function load() {
    setLoading(true);
    try {
      const resp = await apiFetch<{ data: LlmConfig | null; has_config?: boolean }>("/admin/llm-config");
      const cfg = resp.data;
      // 极端情况下 cfg 可能为 null（API 返回结构异常），用 .env 默认兜底
      if (cfg) {
        setConfig(cfg);
        setProvider(cfg.provider);
        setModelName(cfg.model_name);
        setBaseUrl(cfg.base_url);
        setNumCtx(cfg.num_ctx);
        setTemperature(cfg.temperature);
        setTimeoutSec(Math.round(cfg.timeout_ms / 1000));
      }
      // 已设置 key 时清空输入框（不会显示原值）
      setApiKey("");
    } catch (e: unknown) {
      ToastManager.error("加载配置失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    try {
      const resp = await apiFetch<{ data: LlmConfigLogEntry[] }>("/admin/llm-config/log");
      setLogs(resp.data);
    } catch (e: unknown) {
      ToastManager.error("加载日志失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function save() {
    if (!confirm("保存后将立即生效，所有 AI 调用点（合同抽取/模板引擎/知识问答等）将切换到新配置。继续？")) {
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/admin/llm-config", {
        method: "PUT",
        body: JSON.stringify({
          provider,
          model_name: modelName.trim(),
          base_url: baseUrl.trim().replace(/\/$/, ""),
          // 只有用户实际输入 key 时才提交（避免覆盖为 null）
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          num_ctx: Number(numCtx),
          temperature: Number(temperature),
          timeout_ms: Number(timeoutSec) * 1000,
          reason: changeReason.trim() || undefined
        })
      });
      ToastManager.success("配置已保存并热生效");
      setApiKey("");
      setChangeReason("");
      await load();
    } catch (e: unknown) {
      ToastManager.error("保存失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await apiFetch<{
        data: { ok: boolean; latency_ms: number; preview: string; length: number; error?: string };
      }>("/admin/llm-config/test");
      setTestResult({
        ok: resp.data.ok,
        latency_ms: resp.data.latency_ms,
        preview: resp.data.preview,
        error: resp.data.error
      });
      if (resp.data.ok) {
        ToastManager.success(`连通性 OK（${resp.data.latency_ms}ms）`);
      } else {
        ToastManager.error("连通性测试失败");
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
      ToastManager.error("连通性测试失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  }

  async function reset() {
    const reason = prompt("确认删除数据库配置并回退到 .env 默认？\n（请填写删除原因）");
    if (!reason) return;
    try {
      await apiFetch(`/admin/llm-config?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      ToastManager.success("已删除 DB 配置，业务将回退到 .env 默认");
      await load();
    } catch (e: unknown) {
      ToastManager.error("删除失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function toggleLogs() {
    const next = !showLogs;
    setShowLogs(next);
    if (next) await loadLogs();
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div className="loading-state">
          <Loader2 className="spin" /> 正在加载大模型配置…
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">工具 · 大模型配置</span>
          <h1>🧠 大模型配置</h1>
          <p>
            管理 AI 数字化认证中心的全局大模型配置。<strong>单条全局默认</strong>，
            所有 AI 调用点（合同字段抽取、模板引擎、知识问答等）统一从这里读取。
          </p>
        </div>
        <div className="header-status">
          {config?.source === "db" ? (
            <span className="badge badge-success">
              <CheckCircle2 size={14} /> 数据库配置生效中
            </span>
          ) : (
            <span className="badge badge-warning">
              <AlertTriangle size={14} /> 回退到 .env 默认（未配置 DB）
            </span>
          )}
        </div>
      </header>

      {/* 当前配置摘要 */}
      {config && (
        <div className="info-panel">
          <div className="info-row">
            <span className="info-label">Provider</span>
            <span className="info-value">{config.provider}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Model</span>
            <span className="info-value">{config.model_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Base URL</span>
            <span className="info-value">{config.base_url}</span>
          </div>
          <div className="info-row">
            <span className="info-label">API Key</span>
            <span className="info-value">
              {config.api_key_set ? (
                <code>{config.api_key_masked}</code>
              ) : (
                <span className="text-muted">未设置（Ollama 可空）</span>
              )}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Num Ctx</span>
            <span className="info-value">{config.num_ctx}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Temperature</span>
            <span className="info-value">{config.temperature}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Timeout</span>
            <span className="info-value">{Math.round(config.timeout_ms / 1000)}s</span>
          </div>
          {config.updated_at && (
            <div className="info-row">
              <span className="info-label">最后更新</span>
              <span className="info-value">
                {new Date(config.updated_at).toLocaleString("zh-CN")}（{config.updated_by}）
              </span>
            </div>
          )}
        </div>
      )}

      {/* 编辑表单 */}
      <section className="form-panel">
        <h2>
          <Brain size={18} /> 编辑配置
        </h2>

        <div className="form-grid">
          <div className="form-field">
            <label>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              <option value="openai">OpenAI 兼容接口（云端）</option>
              <option value="ollama">Ollama（本地）</option>
            </select>
            <small className="field-hint">
              {provider === "openai"
                ? "支持所有 OpenAI Chat Completions 协议（MiniMax/OpenAI/Azure/DeepSeek 等）"
                : "本地 Ollama 服务，需配置 base_url"}
            </small>
          </div>

          <div className="form-field">
            <label>
              Model Name
              {provider === "ollama" && (
                <span className="field-hint-inline" style={{ marginLeft: "8px", color: "#666" }}>
                  {ollamaLoading
                    ? "（正在加载本地模型…）"
                    : `（${ollamaModels.length} 个本地模型）`}
                </span>
              )}
            </label>
            {provider === "ollama" && ollamaModels.length > 0 ? (
              <>
                  <select
                    value={ollamaModels.some((m) => m.model === modelName) ? modelName : "__custom__"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") {
                        // 切到自定义：清空让用户输入
                        setModelName("");
                      } else {
                        setModelName(v);
                      }
                    }}
                    style={{ width: "100%" }}
              >
                {[...ollamaModels.map((m) => (
                  <option key={m.id} value={m.model}>
                    {m.name} — {m.description}
                  </option>
                )), <option key="__custom__" value="__custom__">自定义（手动输入）</option>]}
              </select>
              {/* 自定义输入框：仅在当前 modelName 不在列表里时显示 */}
              {!ollamaModels.some((m) => m.model === modelName) && (
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="输入自定义 Ollama 模型名，如：qwen3:7b"
                  style={{ marginTop: 6 }}
                />
              )}
              </>
            ) : (
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={provider === "ollama" ? "等待 Ollama 模型列表…" : "如：MiniMax-M3 / qwen3.6:35b-iq2 / gpt-4o"}
              />
            )}
          </div>

          <div className="form-field form-field-wide">
            <label>Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="如：https://api.MiniMax.chat/v1 或 http://localhost:11434"
            />
          </div>

          <div className="form-field form-field-wide">
            <label>
              API Key{" "}
              {config?.api_key_set && (
                <span className="field-hint-inline">
                  （当前已设置：{config.api_key_masked}，留空表示不修改）
                </span>
              )}
            </label>
            <div className="input-with-action">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.api_key_set ? "••• 留空保持不变 •••" : "sk-..."}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? "隐藏" : "显示"}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <small className="field-hint">
              🔒 后端用 AES-256-GCM 加密存储，永不返回明文
            </small>
          </div>

          <div className="form-field">
            <label>Num Ctx（上下文 token）</label>
            <input
              type="number"
              value={numCtx}
              onChange={(e) => setNumCtx(Number(e.target.value))}
              min={512}
              max={200000}
            />
            <small className="field-hint">长合同建议 16384+</small>
          </div>

          <div className="form-field">
            <label>Temperature（采样温度）</label>
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              min={0}
              max={2}
              step={0.1}
            />
            <small className="field-hint">认证抽取建议 0.1-0.3</small>
          </div>

          <div className="form-field">
            <label>Timeout（秒）</label>
            <input
              type="number"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              min={5}
              max={600}
            />
          </div>

          <div className="form-field form-field-wide">
            <label>变更原因（写入审计）</label>
            <input
              type="text"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="如：切到云端 MiniMax-M3 试用 / 调高 ctx 适配长合同"
            />
          </div>
        </div>

        <div className="form-actions">
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !modelName.trim() || !baseUrl.trim()}
          >
            {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            保存并热生效
          </button>
          <button
            className="btn-secondary"
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
            连通性测试
          </button>
          {config?.source === "db" && (
            <button className="btn-danger-ghost" onClick={reset}>
              <Trash2 size={16} /> 重置为 .env
            </button>
          )}
          <button className="btn-ghost" onClick={load}>
            <RotateCcw size={16} /> 重新加载
          </button>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? (
              <>
                <CheckCircle2 size={16} /> 连通成功 · {testResult.latency_ms}ms · {testResult.preview}
              </>
            ) : (
              <>
                <AlertTriangle size={16} /> 连通失败：{testResult.error}
              </>
            )}
          </div>
        )}
      </section>

      {/* 审计日志 */}
      <section className="audit-panel">
        <button className="audit-toggle" onClick={toggleLogs}>
          <History size={16} />
          {showLogs ? "收起" : "查看"}变更审计日志（{logs.length}）
        </button>
        {showLogs && (
          <div className="audit-list">
            {logs.length === 0 ? (
              <p className="empty">暂无变更记录</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作</th>
                    <th>字段</th>
                    <th>原值</th>
                    <th>新值</th>
                    <th>操作人</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td>{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                      <td><code>{l.action}</code></td>
                      <td>{l.field_changed || "-"}</td>
                      <td>{l.old_value || "-"}</td>
                      <td>{l.new_value || "-"}</td>
                      <td>{l.operator || "-"}</td>
                      <td>{l.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
