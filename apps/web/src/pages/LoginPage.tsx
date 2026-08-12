import { useState, FormEvent } from "react";
import { api } from "../lib/api";

interface LoginPageProps {
  onLogin: (user: any) => void;
}

type Step = "credentials" | "mfa";

interface PendingMfa {
  user: any;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = await api.login(username, password);
      if (payload.mfaRequired) {
        setPendingMfa({ user: payload.user });
        setStep("mfa");
        return;
      }
      onLogin(payload.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingMfa) return;
    setError(null);
    setLoading(true);
    try {
      const payload = await api.verifyMfa(mfaCode.trim());
      onLogin(payload.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep("credentials");
    setPendingMfa(null);
    setMfaCode("");
    setError(null);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">AI</div>
        <h1 className="login-title">AI 数字化咨询中心</h1>
        <p className="login-subtitle">中认认证宁夏分公司 · 数字员工系统</p>

        {step === "credentials" && (
          <form onSubmit={handleLogin} className="login-form">
            {error && <div className="login-error">{error}</div>}
            <label className="login-label">
              用户名
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                placeholder="admin"
                className="login-input"
                disabled={loading}
              />
            </label>
            <label className="login-label">
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••"
                className="login-input"
                disabled={loading}
              />
            </label>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "验证中..." : "下一步"}
            </button>
          </form>
        )}

        {step === "mfa" && pendingMfa && (
          <form onSubmit={handleMfaVerify} className="login-form">
            {error && <div className="login-error">{error}</div>}
            <div className="mfa-banner">
              <span className="mfa-icon">🔐</span>
              <div>
                <strong>两步验证</strong>
                <p className="mfa-subtitle">
                  欢迎 <code>{pendingMfa.user.username}</code>！请输入 Google Authenticator / Authy 中的 6 位动态码，或使用一次性备份码。
                </p>
              </div>
            </div>
            <label className="login-label">
              验证码
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ""))}
                required
                autoFocus
                placeholder="6位动态码或备份码"
                className="login-input mfa-code-input"
                disabled={loading}
                inputMode="numeric"
                maxLength={10}
              />
            </label>
            <button type="submit" className="login-submit" disabled={loading || !mfaCode}>
              {loading ? "验证中..." : "登 录"}
            </button>
            <button type="button" className="login-back" onClick={handleBack} disabled={loading}>
              ← 返回
            </button>
          </form>
        )}
      </div>
      <p className="login-copyright">版权所有上海缘起卢卡智能科技有限公司</p>
    </div>
  );
}
