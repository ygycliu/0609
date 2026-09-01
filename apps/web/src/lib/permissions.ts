/**
 * V2.0 权限系统
 *
 * 角色定义：
 * - admin: 完整访问权限
 * - regular: 只读 + 部分编辑权限
 *
 * 权限粒度：
 * - 模块级（menu）：决定菜单项/页面是否可见
 * - 操作级（action）：决定页面内的按钮是否可见/可用
 *
 * 设计原则：
 * - 后端强制权限（403 拒绝非法请求）
 * - 前端隐藏 UI（不显示无权限的入口）
 * - 双重保护（前端隐藏 + 后端拦截）
 */

/** 角色类型 */
export type UserRole = "admin" | "regular";

/** 模块级权限（决定菜单/页面可见性）*/
export const MODULE_PERMISSIONS = {
  /** 系统基础数据（签约主体/外协/风险等级）*/
  SYSTEM_BASIC_DATA: ["admin"],
  /** 知识库管理（上传/删除）*/
  KNOWLEDGE_MANAGE: ["admin"],
  /** 知识审核 */
  KNOWLEDGE_REVIEW: ["admin"],
  /** 基础数据管理 */
  BASE_DATA_MANAGE: ["admin"],
  /** 项目状态变更 */
  PROJECT_STATUS_CHANGE: ["admin"],
  /** 项目删除 */
  PROJECT_DELETE: ["admin"],
  /** 跟进删除 */
  FOLLOWUP_DELETE: ["admin"],
  /** 报价删除 */
  QUOTE_DELETE: ["admin"],
  /** 财务报表 */
  FINANCE_DASHBOARD: ["admin"],
  /** 审核员档案（基础数据 - 管理员可读写，普通用户只读）*/
  AUDITOR_PROFILE: ["admin", "regular"],
  /** 审核员档案编辑 */
  AUDITOR_PROFILE_EDIT: ["admin"],
} as const;

/** 操作级权限（决定页面内按钮）*/
export const ACTION_PERMISSIONS = {
  /** 知识库：上传文档 */
  KNOWLEDGE_UPLOAD: ["admin"],
  /** 知识库：删除文档 */
  KNOWLEDGE_DELETE: ["admin"],
  /** 知识：审核 */
  KNOWLEDGE_APPROVE: ["admin"],
  /** 项目：新建 */
  PROJECT_CREATE: ["admin", "regular"],
  /** 项目：状态变更 */
  PROJECT_CHANGE_STATUS: ["admin", "regular"],
  /** 项目：删除 */
  PROJECT_DELETE_BTN: ["admin"],
  /** 跟进：新建 */
  FOLLOWUP_CREATE: ["admin", "regular"],
  /** 跟进：删除 */
  FOLLOWUP_DELETE_BTN: ["admin"],
  /** 认证报价：生成 */
  QUOTE_GENERATE: ["admin", "regular"],
  /** 认证报价：删除 */
  QUOTE_DELETE_BTN: ["admin"],
  /** 系统基础数据：签约主体 CRUD */
  SIGNING_ENTITY_WRITE: ["admin"],
  /** 系统基础数据：外协单位 CRUD */
  PARTNER_WRITE: ["admin"],
  /** 系统基础数据：风险等级 CRUD */
  RISK_LEVEL_WRITE: ["admin"],
} as const;

export type ModulePermission = keyof typeof MODULE_PERMISSIONS;
export type ActionPermission = keyof typeof ACTION_PERMISSIONS;

/** 权限映射（从 API 返回的 role 转换为前端可用的权限对象）*/
export interface UserPermissions {
  role: UserRole;
  modules: Record<ModulePermission, boolean>;
  actions: Record<ActionPermission, boolean>;
  /** 角色描述（用于 UI 显示）*/
  roleLabel: string;
  /** 是否是管理员 */
  isAdmin: boolean;
}

/** 根据 role 计算完整权限对象 */
export function computePermissions(role: UserRole): UserPermissions {
  const isAdmin = role === "admin";
  const modules = {} as Record<ModulePermission, boolean>;
  const actions = {} as Record<ActionPermission, boolean>;

  for (const key of Object.keys(MODULE_PERMISSIONS) as ModulePermission[]) {
    const allowed = (MODULE_PERMISSIONS[key] as readonly UserRole[]).includes(role);
    modules[key] = allowed;
  }
  for (const key of Object.keys(ACTION_PERMISSIONS) as ActionPermission[]) {
    const allowed = (ACTION_PERMISSIONS[key] as readonly UserRole[]).includes(role);
    actions[key] = allowed;
  }

  return {
    role,
    modules,
    actions,
    roleLabel: isAdmin ? "系统管理员" : "普通用户",
    isAdmin,
  };
}

/** 友好的权限拒绝消息（用于前端兜底显示） */
export function getPermissionDeniedMessage(action: string): string {
  const messages: Record<string, string> = {
    KNOWLEDGE_UPLOAD: "❌ 您没有权限上传知识文档。需要管理员授权。",
    KNOWLEDGE_DELETE: "❌ 您没有权限删除知识文档。需要管理员授权。",
    KNOWLEDGE_APPROVE: "❌ 您没有权限审核知识。需要管理员授权。",
    PROJECT_CREATE: "❌ 您没有权限创建项目。需要管理员授权。",
    PROJECT_CHANGE_STATUS: "❌ 您没有权限修改项目状态。",
    PROJECT_DELETE_BTN: "❌ 您没有权限删除项目。需要管理员授权。",
    FOLLOWUP_CREATE: "❌ 您没有权限创建跟进。",
    FOLLOWUP_DELETE_BTN: "❌ 您没有权限删除跟进。需要管理员授权。",
    QUOTE_GENERATE: "❌ 您没有权限生成报价。",
    QUOTE_DELETE_BTN: "❌ 您没有权限删除报价。需要管理员授权。",
    SIGNING_ENTITY_WRITE: "❌ 您没有权限修改签约主体。需要管理员授权。",
    PARTNER_WRITE: "❌ 您没有权限修改外协单位。需要管理员授权。",
    RISK_LEVEL_WRITE: "❌ 您没有权限修改风险等级。需要管理员授权。",
    SYSTEM_BASIC_DATA: "❌ 您没有权限访问系统基础数据。需要管理员授权。",
    KNOWLEDGE_REVIEW: "❌ 您没有权限审核知识。需要管理员授权。",
    BASE_DATA_MANAGE: "❌ 您没有权限管理基础数据。需要管理员授权。",
    FINANCE_DASHBOARD: "❌ 您没有权限访问财务报表。需要管理员授权。",
  };
  return messages[action] || `❌ 您没有权限执行此操作（${action}）。需要管理员授权。`;
}
