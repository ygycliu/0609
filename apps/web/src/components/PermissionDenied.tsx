/**
 * V2.0 权限不足提示组件
 *
 * 当用户尝试访问无权限的页面或操作时显示
 */

import { ShieldAlert } from "lucide-react";
import { getPermissionDeniedMessage, type ModulePermission, type ActionPermission } from "../lib/permissions";

interface PermissionDeniedProps {
  /** 失败的模块或操作 */
  permission?: ModulePermission | ActionPermission;
  /** 自定义消息（覆盖默认） */
  message?: string;
  /** 副标题 */
  hint?: string;
}

export function PermissionDenied({ permission, message, hint }: PermissionDeniedProps) {
  const finalMessage = message || (permission ? getPermissionDeniedMessage(permission) : "您没有权限访问此页面");

  return (
    <div className="permission-denied-page">
      <div className="permission-denied-card">
        <div className="permission-denied-icon">
          <ShieldAlert size={48} />
        </div>
        <h2>权限不足</h2>
        <p className="permission-denied-message">{finalMessage}</p>
        {hint && <p className="permission-denied-hint">{hint}</p>}
        <div className="permission-denied-actions">
          <button
            className="primary-button"
            onClick={() => window.history.back()}
          >
            返回上一页
          </button>
          <button
            className="ghost-button"
            onClick={() => { window.location.href = "/ai/?page=overview"; }}
          >
            返回工作台
          </button>
        </div>
      </div>
    </div>
  );
}
