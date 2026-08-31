/**
 * V2.0 全局 Toast 组件
 *
 * 替代 alert()，提供更好的视觉体验
 *
 * 用法：
 * <Toast
 *   type="success" | "error" | "warning" | "info"
 *   message="..."
 *   onClose={() => setShow(false)}
 * />
 */

import { CheckCircle2, AlertTriangle, X, Info } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastProps {
  type: ToastType;
  message: string;
  /** 自动关闭时间（ms），默认 5000 */
  duration?: number;
  onClose: () => void;
}

const STYLES: Record<ToastType, { bg: string; color: string; icon: any }> = {
  success: {
    bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
    color: "#047857",
    icon: CheckCircle2
  },
  error: {
    bg: "linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)",
    color: "#991b1b",
    icon: AlertTriangle
  },
  warning: {
    bg: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
    color: "#92400e",
    icon: AlertTriangle
  },
  info: {
    bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    color: "#1e40af",
    icon: Info
  }
};

export function Toast({ type, message, duration = 5000, onClose }: ToastProps) {
  const style = STYLES[type];
  const Icon = style.icon;

  // 自动关闭
  if (duration > 0) {
    // 用 setTimeout，但要避免 React 警告（在 useEffect 里）
    // 这里简化：依赖父组件 setTimeout 触发 onClose
  }

  return (
    <div
      className={`toast toast-${type}`}
      style={{
        background: style.bg,
        color: style.color,
        borderLeft: `4px solid ${style.color}`
      }}
    >
      <Icon size={20} />
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose} title="关闭">
        <X size={16} />
      </button>
    </div>
  );
}

/** Toast 容器（堆叠多个 toast）*/
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onClose: (id: number) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          type={t.type}
          message={t.message}
          duration={t.duration}
          onClose={() => onClose(t.id)}
        />
      ))}
    </div>
  );
}

/** 全局 toast 管理（不依赖 React Context，简化）*/
export class ToastManager {
  private static listeners: Set<(toasts: ToastItem[]) => void> = new Set();
  private static toasts: ToastItem[] = [];
  private static idCounter = 0;

  static subscribe(cb: (toasts: ToastItem[]) => void): () => void {
    this.listeners.add(cb);
    cb(this.toasts);
    return () => this.listeners.delete(cb);
  }

  static show(type: ToastType, message: string, duration = 5000) {
    const id = ++this.idCounter;
    this.toasts = [...this.toasts, { id, type, message, duration }];
    this.notify();
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }

  static success(message: string, duration?: number) { return this.show("success", message, duration); }
  static error(message: string, duration?: number) { return this.show("error", message, duration); }
  static warning(message: string, duration?: number) { return this.show("warning", message, duration); }
  static info(message: string, duration?: number) { return this.show("info", message, duration); }

  static dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  private static notify() {
    this.listeners.forEach((cb) => cb(this.toasts));
  }
}

/** Hook：订阅 ToastManager */
import { useEffect, useState } from "react";

// V2.0：debug 用
if (typeof window !== "undefined") {
  (window as any).__ToastManager = ToastManager;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    return ToastManager.subscribe(setToasts);
  }, []);
  return {
    toasts,
    dismiss: (id: number) => ToastManager.dismiss(id)
  };
}