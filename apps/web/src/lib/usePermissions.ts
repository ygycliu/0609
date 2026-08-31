/**
 * V2.0 权限 Hook
 *
 * 提供：
 * - permissions: 当前用户的权限对象
 * - hasModule(perm): 检查模块权限
 * - hasAction(perm): 检查操作权限
 * - denyReason(perm): 获取权限拒绝的友好消息
 */

import { useMemo } from "react";
import { computePermissions, type UserRole, type UserPermissions, type ModulePermission, type ActionPermission, getPermissionDeniedMessage } from "./permissions";

export interface UsePermissionsApi {
  /** 完整权限对象 */
  permissions: UserPermissions;
  /** 是否是管理员 */
  isAdmin: boolean;
  /** 检查模块权限 */
  hasModule: (perm: ModulePermission) => boolean;
  /** 检查操作权限 */
  hasAction: (perm: ActionPermission) => boolean;
  /** 检查模块权限并返回拒绝消息 */
  guardModule: (perm: ModulePermission) => null | string;
  /** 检查操作权限并返回拒绝消息 */
  guardAction: (perm: ActionPermission) => null | string;
}

export function usePermissions(role: UserRole | undefined | null): UsePermissionsApi {
  const permissions = useMemo<UserPermissions>(
    () => computePermissions((role || "regular") as UserRole),
    [role]
  );

  return useMemo(
    () => ({
      permissions,
      isAdmin: permissions.isAdmin,
      hasModule: (perm: ModulePermission) => !!permissions.modules[perm],
      hasAction: (perm: ActionPermission) => !!permissions.actions[perm],
      guardModule: (perm: ModulePermission) => {
        if (permissions.modules[perm]) return null;
        return getPermissionDeniedMessage(perm);
      },
      guardAction: (perm: ActionPermission) => {
        if (permissions.actions[perm]) return null;
        return getPermissionDeniedMessage(perm);
      },
    }),
    [permissions]
  );
}
