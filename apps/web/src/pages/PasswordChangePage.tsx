import { FormEvent, useState } from "react";
import { api } from "../lib/api";

export function PasswordChangePage({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">AI</div>
        <h1 className="login-title">首次登录安全设置</h1>
        <p className="login-subtitle">请修改临时密码后重新登录</p>
        <form className="login-form" onSubmit={submit}>
          {error && <div className="login-error">{error}</div>}
          <label className="login-label">当前密码
            <input className="login-input" type="password" required value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label className="login-label">新密码
            <input className="login-input" type="password" required minLength={12} value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label className="login-label">确认新密码
            <input className="login-input" type="password" required minLength={12} value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "正在修改..." : "修改密码"}
          </button>
        </form>
      </div>
    </div>
  );
}
