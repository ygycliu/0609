import { useEffect, useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  ArrowUp,
  File,
  Folder,
  FolderPlus,
  Download,
  Trash2,
  Upload,
  ChevronRight,
  Home,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
  FileText,
  Music,
  Video,
  Archive,
  RefreshCw
} from "lucide-react";
import { api, API_BASE_URL } from "../lib/api";

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: string;
}

interface Breadcrumb {
  name: string;
  path: string;
}

function fileIcon(type: string) {
  const t = type.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(t)) return ImageIcon;
  if (["mp4", "mov", "avi", "webm", "mkv", "flv"].includes(t)) return Video;
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(t)) return Music;
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(t)) return Archive;
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"].includes(t)) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

export function FilesPage() {
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 创建子目录对话框
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.filesList(path);
      setItems(r.items);
      setBreadcrumbs(r.breadcrumbs);
      setParent(r.parent);
      setCurrentPath(r.path);
    } catch (e: any) {
      setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir(currentPath);
  }, [currentPath, loadDir]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.filesUpload(currentPath, file);
      await loadDir(currentPath);
    } catch (e: any) {
      setError(`上传失败: ${e?.message ?? "未知错误"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = (item: FileItem) => {
    if (item.isDir) return;
    const url = `${API_BASE_URL}/files/download?path=${encodeURIComponent(item.path)}`;
    window.open(url, "_blank");
  };

  const handleDelete = async (item: FileItem) => {
    const msg = item.isDir
      ? `确认删除目录 "${item.name}" 及其所有内容？\n\n⚠️ 此操作不可恢复！`
      : `确认删除文件 "${item.name}"？`;
    if (!confirm(msg)) return;
    try {
      await api.filesDelete(item.path);
      await loadDir(currentPath);
    } catch (e: any) {
      setError(`删除失败: ${e?.message ?? "未知错误"}`);
    }
  };

  const handleMkdir = async () => {
    if (!newDirName.trim()) {
      setError("目录名不能为空");
      return;
    }
    try {
      await api.filesMkdir(currentPath, newDirName.trim());
      setNewDirName("");
      setShowMkdir(false);
      await loadDir(currentPath);
    } catch (e: any) {
      setError(`创建失败: ${e?.message ?? "未知错误"}`);
    }
  };

  return (
    <div className="page files-page">
      <header className="page-header">
        <div>
          <h2>📁 文件浏览</h2>
          <p className="page-subtitle">
            浏览 <code>/mnt/renz</code> 业务档案 · 支持上传、下载、新建子目录、删除
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => loadDir(currentPath)} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          {error}
          <button onClick={() => setError(null)} className="close-btn">×</button>
        </div>
      )}

      {/* 面包屑 + 操作 */}
      <div className="card">
        <div className="files-toolbar">
          <div className="breadcrumb">
            <button
              className="breadcrumb-item"
              onClick={() => navigateTo("")}
              title="根目录"
            >
              <Home size={14} />
              <span>根目录</span>
            </button>
            {breadcrumbs.map((b, i) => (
              <span key={b.path} style={{ display: "flex", alignItems: "center" }}>
                <ChevronRight size={12} className="breadcrumb-sep" />
                <button
                  className="breadcrumb-item"
                  onClick={() => navigateTo(b.path)}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>

          <div className="toolbar-actions">
            {parent !== null && (
              <button
                className="ghost-button"
                onClick={() => navigateTo(parent)}
                title="返回上级"
              >
                <ArrowUp size={14} /> 上级
              </button>
            )}
            <button
              className="ghost-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              上传文件
            </button>
            <button
              className="ghost-button"
              onClick={() => setShowMkdir(true)}
            >
              <FolderPlus size={14} /> 新建目录
            </button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {showMkdir && (
          <div className="mkdir-form">
            <input
              type="text"
              value={newDirName}
              onChange={(e) => setNewDirName(e.target.value)}
              placeholder="新目录名（如：2025年新客户）"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleMkdir();
                if (e.key === "Escape") { setShowMkdir(false); setNewDirName(""); }
              }}
              autoFocus
            />
            <button className="primary-button" onClick={handleMkdir}>创建</button>
            <button
              className="ghost-button"
              onClick={() => { setShowMkdir(false); setNewDirName(""); }}
            >
              取消
            </button>
          </div>
        )}

        {/* 文件表格 */}
        {loading ? (
          <div className="files-loading">
            <Loader2 className="spin" size={24} />
            <span>加载中…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="files-empty">
            <Folder size={32} />
            <p>空目录</p>
            <p className="hint">点击「上传文件」添加文件，或「新建目录」创建子目录</p>
          </div>
        ) : (
          <table className="files-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}></th>
                <th>名称</th>
                <th style={{ width: 120 }}>大小</th>
                <th style={{ width: 180 }}>修改时间</th>
                <th style={{ width: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const Icon = item.isDir ? Folder : fileIcon(item.name.split(".").pop() || "");
                return (
                  <tr key={item.path} className={item.isDir ? "is-dir" : "is-file"}>
                    <td className="file-icon-cell">
                      <Icon size={20} />
                    </td>
                    <td>
                      {item.isDir ? (
                        <button
                          className="file-link"
                          onClick={() => navigateTo(item.path)}
                        >
                          {item.name}
                        </button>
                      ) : (
                        <span className="file-name">{item.name}</span>
                      )}
                    </td>
                    <td className="file-size">{formatSize(item.size)}</td>
                    <td className="file-time">{formatDate(item.modifiedAt)}</td>
                    <td>
                      <div className="file-actions">
                        {!item.isDir && (
                          <button
                            className="file-action-btn"
                            onClick={() => handleDownload(item)}
                            title="下载"
                          >
                            <Download size={14} /> 下载
                          </button>
                        )}
                        <button
                          className="file-action-btn danger"
                          onClick={() => handleDelete(item)}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="files-footer">
        <span>共 {items.length} 项 · 路径: <code>/mnt/renz/{currentPath}</code></span>
      </div>
    </div>
  );
}