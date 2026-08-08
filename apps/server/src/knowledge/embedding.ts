/**
 * 真向量服务调用（BGE-base-zh-v1.5）
 * - 通过 HTTP 调用 Python microservice
 * - 失败 fallback 到 fake embedding（避免完全宕机）
 */

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || "http://localhost:8765";
const TIMEOUT_MS = 30000;

export async function fakeEmbeddingText(text: string, dim: number = 768): Promise<number[]> {
  // 优先调真服务
  try {
    const resp = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text.slice(0, 500)] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (resp.ok) {
      const data: { embeddings: number[][]; dim: number } = await resp.json();
      const v = data.embeddings[0];
      if (v && v.length === dim) return v;
      if (v && v.length !== dim) {
        // 维度不匹配，截断或补 0
        if (v.length > dim) return v.slice(0, dim);
        return [...v, ...Array(dim - v.length).fill(0)];
      }
    }
    console.warn("[embedding] service returned non-OK, fallback to fake:", resp.status);
  } catch (err) {
    console.warn("[embedding] service call failed, fallback to fake:", (err as Error).message);
  }
  // Fallback: SHA-256 派生
  return fakeEmbeddingTextLocal(text, dim);
}

function fakeEmbeddingTextLocal(text: string, dim: number): number[] {
  const crypto = require("crypto") as typeof import("crypto");
  let raw = Buffer.alloc(0);
  let s = text;
  while (raw.length < dim) {
    raw = Buffer.concat([raw, crypto.createHash("sha256").update(s).digest()]);
    s = raw.toString("latin1");
  }
  const full: number[] = [];
  for (let i = 0; i < dim; i++) {
    full.push((raw[i] - 128) / 128.0);
  }
  let norm = 0;
  for (const x of full) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < full.length; i++) full[i] = full[i] / norm;
  return full;
}

export async function fakeEmbeddingBatch(texts: string[], dim: number = 768): Promise<number[][]> {
  try {
    const resp = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: texts.map(t => t.slice(0, 500)) }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (resp.ok) {
      const data: { embeddings: number[][]; dim: number } = await resp.json();
      return data.embeddings.map((v: number[]) => {
        if (v.length === dim) return v;
        if (v.length > dim) return v.slice(0, dim);
        return [...v, ...Array(dim - v.length).fill(0)];
      });
    }
  } catch (err) {
    console.warn("[embedding] batch service call failed:", (err as Error).message);
  }
  return texts.map(t => fakeEmbeddingTextLocal(t, dim));
}