/**
 * V2.0 证书图片预览 Modal
 *
 * 功能：
 * - 大图预览
 * - 左右切换
 * - 下载原图
 * - OCR 识别（如果还没做）
 * - 错误处理
 */

import { useEffect, useState } from "react";
import {
  X, ChevronLeft, ChevronRight, Download, ScanLine,
  LoaderCircle, AlertCircle, ZoomIn, ZoomOut
} from "lucide-react";
import { api } from "../lib/api";
import { ToastManager } from "./Toast";

interface CertItem {
  code?: string;
  name?: string;
  type?: string;
  file?: string;
  source_name?: string;
  status?: string;
  note?: string;
  importedAt?: string;
  /** V2.0：OCR 识别的详细字段 */
  fields?: {
    name?: string;
    idNumber?: string;
    certNo?: string;
    qualification?: string;
    organization?: string;
    validFrom?: string;
    validTo?: string;
    issuer?: string;
  };
}

export function CertPreviewModal({
  certificates,
  initialIndex = 0,
  onClose,
  onOcrAll
}: {
  certificates: CertItem[];
  initialIndex?: number;
  onClose: () => void;
  onOcrAll?: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [currentMeta, setCurrentMeta] = useState<{ size?: number; mime?: string } | null>(null);
  const [zoom, setZoom] = useState(1);

  const cert = certificates[index];

  // 加载图片
  useEffect(() => {
    if (!cert?.file) {
      setImageSrc(null);
      return;
    }
    setLoading(true);
    setError(null);
    setImageSrc(null);
    setCurrentMeta(null);
    api.getCertImage(cert.file)
      .then((r) => {
        const d = (r as any)?.data || r;
        setImageSrc(d?.base64 || null);
        setCurrentMeta({ size: d?.size, mime: d?.mime });
      })
      .catch((e) => {
        setError(e?.message || "加载图片失败");
        setImageSrc(null);
      })
      .finally(() => setLoading(false));
  }, [cert?.file]);

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
      else if (e.key === "ArrowRight" && index < certificates.length - 1) setIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, certificates.length, onClose]);

  // 触发 OCR（单张）
  const handleOcr = async () => {
    if (!cert?.file) return;
    setOcrLoading(true);
    try {
      // 临时下载文件上传
      const r = await api.getCertImage(cert.file);
      const d = (r as any)?.data || r;
      const base64 = d?.base64 || "";
      const blob = await (await fetch(base64)).blob();
      const fd = new FormData();
      fd.append("file", new File([blob], cert.source_name || "cert.png", { type: d?.mime || "image/png" }));
      const res = await api.ocrCertificate(fd as any);
      const data = (res as any)?.data || res;
      // 更新当前 cert 的 fields
      if (data?.fields) {
        const updated = [...certificates];
        updated[index] = { ...updated[index], fields: data.fields };
        // 用 OCR 推断的 system 更新 code
        if (data.systems && data.systems.length > 0) {
          updated[index].code = data.systems[0];
          updated[index].name = data.certName || updated[index].name;
        }
        ToastManager.success(`✅ OCR 识别完成：${data.certName || data.systems?.join(", ")}`);
        // 通知父组件更新
        if (onOcrAll) onOcrAll();
      }
    } catch (e: any) {
      ToastManager.error(`❌ OCR 失败：${e?.message ?? "未知错误"}`);
    } finally {
      setOcrLoading(false);
    }
  };

  // 下载原图
  const handleDownload = async () => {
    if (!cert?.file || !imageSrc) return;
    try {
      const link = document.createElement("a");
      link.href = imageSrc;
      link.download = cert.source_name || "certificate";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      ToastManager.error(`下载失败：${e?.message ?? "未知错误"}`);
    }
  };

  if (!cert) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="cert-preview-modal" onClick={(e) => e.stopPropagation()}>
          <div className="empty-row">无证书可预览</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="cert-preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* 顶部工具栏 */}
        <header className="cert-preview-header">
          <div>
            <span className="eyebrow">
              证书预览 · {index + 1} / {certificates.length}
            </span>
            <h3>
              {cert.source_name || "证书"}
              {cert.code && cert.code !== "CUSTOM" && (
                <span className="cert-code-pill" style={{ marginLeft: 8 }}>{cert.code}</span>
              )}
            </h3>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ghost-button" onClick={() => setZoom(Math.max(0.5, zoom - 0.2))} title="缩小">
              <ZoomOut size={16} />
            </button>
            <button className="ghost-button" onClick={() => setZoom(1)} title="100%">
              {Math.round(zoom * 100)}%
            </button>
            <button className="ghost-button" onClick={() => setZoom(Math.min(3, zoom + 0.2))} title="放大">
              <ZoomIn size={16} />
            </button>
            <button className="ghost-button" onClick={handleDownload} title="下载原图">
              <Download size={16} />
            </button>
            {onOcrAll && (
              <button className="ghost-button" onClick={handleOcr} disabled={ocrLoading} title="OCR 识别此证书">
                {ocrLoading ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />}
                {ocrLoading ? "识别中" : "OCR"}
              </button>
            )}
            <button className="ghost-button" onClick={onClose} title="关闭 (ESC)">
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 图片区 */}
        <div className="cert-preview-body">
          {loading ? (
            <div className="loading-row">
              <LoaderCircle className="spin" size={32} /> 加载图片中...
            </div>
          ) : error ? (
            <div className="cert-error">
              <AlertCircle size={48} />
              <p>无法加载图片</p>
              <small>{error}</small>
              <small>文件路径：{cert.file}</small>
            </div>
          ) : imageSrc ? (
            <div className="cert-image-container">
              <img
                src={imageSrc}
                alt={cert.source_name}
                style={{ transform: `scale(${zoom})`, maxWidth: "100%", maxHeight: "70vh" }}
              />
            </div>
          ) : null}
        </div>

        {/* 底部信息区 */}
        <div className="cert-preview-info">
          {/* 左右切换 */}
          {certificates.length > 1 && (
            <div className="cert-nav">
              <button
                className="ghost-button"
                onClick={() => setIndex(Math.max(0, index - 1))}
                disabled={index === 0}
                title="上一张 (←)"
              >
                <ChevronLeft size={16} /> 上一张
              </button>
              <span className="cert-counter">
                {index + 1} / {certificates.length}
              </span>
              <button
                className="ghost-button"
                onClick={() => setIndex(Math.min(certificates.length - 1, index + 1))}
                disabled={index === certificates.length - 1}
                title="下一张 (→)"
              >
                下一张 <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* 证书信息表 */}
          <table className="cert-info-table">
            <tbody>
              <tr>
                <th>文件</th>
                <td>
                  <code>{cert.source_name || "—"}</code>
                  {currentMeta?.size && <small style={{ marginLeft: 8, color: "#94a3b8" }}>{(currentMeta.size / 1024).toFixed(1)} KB</small>}
                </td>
              </tr>
              {cert.code && (
                <tr>
                  <th>体系代码</th>
                  <td><span className="cert-code-pill">{cert.code}</span></td>
                </tr>
              )}
              {cert.name && (
                <tr>
                  <th>证书名称</th>
                  <td>{cert.name}</td>
                </tr>
              )}
              {cert.note && (
                <tr>
                  <th>备注</th>
                  <td className="muted small">{cert.note}</td>
                </tr>
              )}
              {cert.fields && Object.keys(cert.fields).length > 0 && (
                <>
                  {cert.fields.certNo && (
                    <tr>
                      <th>注册证号</th>
                      <td><code>{cert.fields.certNo}</code></td>
                    </tr>
                  )}
                  {cert.fields.qualification && (
                    <tr>
                      <th>注册资格</th>
                      <td>{cert.fields.qualification}</td>
                    </tr>
                  )}
                  {cert.fields.organization && (
                    <tr>
                      <th>执业机构</th>
                      <td>{cert.fields.organization}</td>
                    </tr>
                  )}
                  {cert.fields.issuer && (
                    <tr>
                      <th>颁发机构</th>
                      <td>{cert.fields.issuer}</td>
                    </tr>
                  )}
                  {cert.fields.validFrom && cert.fields.validTo && (
                    <tr>
                      <th>有效日期</th>
                      <td>
                        <span style={{ color: "#10b981" }}>{cert.fields.validFrom}</span> 至{" "}
                        <span style={{ color: "#dc2626" }}>{cert.fields.validTo}</span>
                      </td>
                    </tr>
                  )}
                </>
              )}
              {cert.file && (
                <tr>
                  <th>路径</th>
                  <td><code style={{ fontSize: 11, color: "#94a3b8" }}>{cert.file}</code></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
