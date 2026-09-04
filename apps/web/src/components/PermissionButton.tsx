/**
 * V2.0 权限按钮组件
 *
 * 包装任何按钮/操作元素，根据权限显示/隐藏/禁用
 * 比直接用 `usePermissions().hasAction()` 更优雅
 *
 * 两种用法：
 * 1. 隐藏整个元素（推荐 UI 友好的方式）
 *    <PermissionButton permission="KNOWLEDGE_UPLOAD" ...>
 *      <button>上传</button>
 *    </PermissionButton>
 *
 * 2. 禁用但显示（提示用户为何无法操作）
 *    <PermissionButton permission="PROJECT_CREATE" mode="disable" ...>
 *      <button>新建</button>
 *    </PermissionButton>
 */

import { ReactNode, useMemo } from "react";
import { computePermissions, type UserRole, type ActionPermission, getPermissionDeniedMessage } from "../lib/permissions";

interface PermissionButtonProps {
  /** 需要的操作权限 */
  permission: ActionPermission;
  /** 用户角色 */
  userRole: UserRole | undefined | null;
  /** 模式：hide（隐藏）或 disable（禁用） */
  mode?: "hide" | "disable";
  /** 子元素 */
  children: ReactNode;
  /** 自定义提示消息（覆盖默认） */
  deniedMessage?: string;
}

export function PermissionButton({
  permission,
  userRole,
  mode = "hide",
  children,
  deniedMessage,
}: PermissionButtonProps) {
  const permissions = useMemo(() => computePermissions((userRole || "regular") as UserRole), [userRole]);
  const allowed = !!permissions.actions[permission];

  if (allowed) {
    return <>{children}</>;
  }

  if (mode === "hide") {
    return null;
  }

  // disable 模式：包装一层 disabled 元素
  const finalMessage = deniedMessage || getPermissionDeniedMessage(permission);
  return (
    <span
      title={finalMessage}
      style={{ opacity: 0.5, cursor: "not-allowed", display: "inline-block" }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // V2.0：点击时显示友好提示
        if (typeof window !== "undefined") {
          window.alert(finalMessage);
        }
      }}
    >
      {children}
    </span>
  );
}