#!/usr/bin/env python3
"""
DLE /mnt/renz 部分文件向量化脚本 V4 - 用 BGE 真模型

- 选核心文件（认证相关）
- 跳过压缩包 + DLL 等非文档类型
- 抽内容（docx/pdf/doc/xlsx/xls/md/txt）
- 分块（每 800 字符）
- 通过 embedding_service 调用 BGE-base-zh-v1.5（768 维）
- 写入 PostgreSQL knowledge_chunk
- 自动跳过已入库文档（按 doc_code）
"""
import os
import sys
import hashlib
import subprocess
import json
import urllib.request
import urllib.error
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from datetime import datetime

# ============== 配置 ==============
DLE_ROOT = Path("/mnt/renz")
EMBEDDING_URL = "http://localhost:8765/embed"
DATABASE_URL = os.environ.get("DATABASE_URL", "")
CHUNK_SIZE = 800
COMPANY_ID = "00000000-0000-0000-0000-000000000001"
SOURCE_LABEL = "DLE /mnt/renz"

TYPE_TO_CATEGORY = {
    ".pdf": "19-认证合同-PDF",
    ".docx": "19-认证合同-DOCX",
    ".xlsx": "21-企业资料-XLSX",
    ".xls": "21-企业资料-XLS",
    ".md": "21-企业资料-MD",
    ".txt": "21-企业资料-TXT"
}

SKIP_DIRS = {"13、中认系统软件包", "15、社会审核员卡", "16、机器人", "20、发票", "22、报销单"}
SKIP_NAME_PATTERNS = [".zip", ".rar", ".7z", ".tmp", ".dll", ".db", ".ofd", "._"]


def get_existing_doc_codes() -> set:
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT doc_code FROM knowledge_document WHERE company_id = %s",
                (COMPANY_ID,)
            )
            return {row[0] for row in cur.fetchall()}


def scan_files(limit: int) -> list:
    existing = get_existing_doc_codes()
    print(f"已入库: {len(existing)} 个")

    all_files = []
    for f in DLE_ROOT.rglob("*"):
        if not f.is_file():
            continue
        rel = str(f.relative_to(DLE_ROOT))
        if any(s in rel for s in SKIP_DIRS):
            continue
        if any(p in f.name.lower() for p in SKIP_NAME_PATTERNS):
            continue
        if f.suffix.lower() not in TYPE_TO_CATEGORY:
            continue
        try:
            sz = f.stat().st_size
        except OSError:
            continue
        if sz < 200 or sz > 4_000_000:
            continue
        all_files.append((f, sz))

    # 优先认证相关路径
    def priority(rel: str) -> int:
        if "认证" in rel or "audit" in rel.lower(): return 0
        if "合同" in rel: return 1
        if "客户" in rel: return 2
        if "程序" in rel or "手册" in rel: return 3
        return 4
    all_files.sort(key=lambda x: (priority(str(x[0].relative_to(DLE_ROOT))), x[1]))

    new_files = []
    for f, sz in all_files:
        rel = str(f.relative_to(DLE_ROOT)).replace("/", "_")[:80]
        short_hash = hashlib.sha1(rel.encode("utf-8")).hexdigest()[:12]
        doc_code = f"DLF-{short_hash}"
        if doc_code in existing:
            continue
        new_files.append(f)
        if len(new_files) >= limit:
            break
    return new_files


def extract_text(f: Path) -> str:
    ext = f.suffix.lower()
    try:
        if ext == ".pdf":
            import pdfplumber
            text = []
            with pdfplumber.open(f) as pdf:
                for page in pdf.pages[:30]:
                    t = page.extract_text() or ""
                    text.append(t)
                    if sum(len(x) for x in text) > 16000:
                        break
            return "\n".join(text)
        if ext == ".docx":
            from docx import Document
            doc = Document(f)
            return "\n".join(p.text for p in doc.paragraphs if p.text)
        if ext == ".doc":
            tmp_dir = "/tmp/conv_doc"
            os.makedirs(tmp_dir, exist_ok=True)
            r = subprocess.run([
                "soffice", "--headless", "--convert-to", "docx",
                "--outdir", tmp_dir, str(f)
            ], capture_output=True, text=True, timeout=60)
            if r.returncode == 0:
                converted = Path(tmp_dir) / (f.stem + ".docx")
                if converted.exists():
                    from docx import Document
                    doc = Document(converted)
                    try:
                        converted.unlink()
                    except OSError:
                        pass
                    return "\n".join(p.text for p in doc.paragraphs if p.text)
            return ""
        if ext in (".xlsx",):
            from openpyxl import load_workbook
            wb = load_workbook(f, read_only=True, data_only=True)
            rows = []
            for ws in wb.worksheets:
                for row in ws.iter_rows(min_row=1, max_row=100, max_col=20, values_only=True):
                    rows.append(" | ".join(str(c) if c is not None else "" for c in row))
                if sum(len(r) for r in rows) > 16000:
                    break
            return "\n".join(rows)
        if ext in (".xls",):
            try:
                import xlrd
                book = xlrd.open_workbook(str(f))
                rows = []
                for sheet in book.sheets():
                    for ri in range(min(sheet.nrows, 100)):
                        row = []
                        for ci in range(min(sheet.ncols, 20)):
                            try:
                                row.append(str(sheet.cell_value(ri, ci)))
                            except Exception:
                                row.append("")
                        rows.append(" | ".join(row))
                    if sum(len(r) for r in rows) > 16000:
                        break
                return "\n".join(rows)
            except Exception:
                return ""
        if ext in (".md", ".txt"):
            return f.read_text(encoding="utf-8", errors="ignore")[:16000]
    except Exception as e:
        return ""
    return ""


def chunk_text(text: str, size: int = CHUNK_SIZE) -> list:
    text = text.strip()
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]


def call_embed(texts: list) -> list:
    req = urllib.request.Request(
        EMBEDDING_URL, method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"texts": texts, "dim": 768}).encode()
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            d = json.loads(resp.read())
            return d["embeddings"]
    except Exception:
        return []


def store_document_and_chunks(
    f: Path,
    title: str,
    content: str,
    category: str,
    chunk_embeddings: list
) -> int:
    rel = str(f.relative_to(DLE_ROOT)).replace("/", "_")[:80]
    short_hash = hashlib.sha1(rel.encode("utf-8")).hexdigest()[:12]
    doc_code = f"DLF-{short_hash}"
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO knowledge_document
                  (id, company_id, doc_code, title, content_text, source,
                   file_type, category, tags, effective_from, current_version)
                VALUES
                  (uuid_generate_v4(), %s, %s, %s, %s, %s, %s, %s, %s,
                   CURRENT_DATE, 1)
                ON CONFLICT (company_id, doc_code) DO UPDATE SET
                  title = EXCLUDED.title,
                  content_text = EXCLUDED.content_text,
                  category = EXCLUDED.category,
                  tags = EXCLUDED.tags,
                  updated_at = NOW(),
                  current_version = knowledge_document.current_version + 1
                RETURNING id
                """,
                (
                    COMPANY_ID,
                    doc_code,
                    title[:200],
                    content[:16000],
                    SOURCE_LABEL,
                    f.suffix.lower().lstrip("."),
                    category,
                    [f.stem[:50]]
                )
            )
            doc_id = cur.fetchone()[0]
            cur.execute("DELETE FROM knowledge_chunk WHERE document_id = %s", (doc_id,))
            rows = [
                (
                    str(doc_id),
                    index,
                    chunk[:1500],
                    "[" + ",".join(f"{float(value)}" for value in vector) + "]"
                )
                for index, (chunk, vector) in enumerate(chunk_embeddings)
            ]
            execute_values(
                cur,
                """
                INSERT INTO knowledge_chunk
                  (id, document_id, chunk_index, content, embedding, created_at)
                VALUES %s
                """,
                rows,
                template="(uuid_generate_v4(), %s::uuid, %s, %s, %s::vector, NOW())"
            )
            return len(rows)


def main():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    limit = 2000
    if "--limit" in sys.argv:
        idx = sys.argv.index("--limit")
        limit = int(sys.argv[idx + 1])

    print(f"=== DLE 向量化 V4（增量）===")
    print(f"目标: 新增 {limit} 个文件")
    print(f"开始: {datetime.now().strftime('%H:%M:%S')}\n")

    files = scan_files(limit)
    print(f"待处理文件: {len(files)} 个\n")

    ok = 0
    skipped = 0
    failed = 0
    total_chunks = 0

    for i, f in enumerate(files):
        if i % 25 == 0:
            print(f"[{i}/{len(files)}] 已成功 {ok}, 失败 {failed}, 跳过 {skipped}", flush=True)

        try:
            text = extract_text(f)
        except Exception as e:
            import traceback
            print(f"  [EXC] {f.name}: {e}")
            print(f"    {traceback.format_exc()[:300]}")
            failed += 1
            continue
        if not text.strip():
            skipped += 1
            if i < 10:
                print(f"  [EMPTY] {f.name}", flush=True)
            continue

        chunks = chunk_text(text)
        if not chunks:
            skipped += 1
            continue

        embeddings = call_embed(chunks)
        if len(embeddings) != len(chunks):
            print(f"  [EMBED] {f.name}: got {len(embeddings)}/{len(chunks)}")
            failed += 1
            continue

        category = TYPE_TO_CATEGORY.get(f.suffix.lower(), "21-企业资料")
        try:
            n = store_document_and_chunks(
                f,
                f.stem[:200],
                text[:8000],
                category,
                list(zip(chunks, embeddings))
            )
            if n != len(chunks):
                raise RuntimeError(f"inserted {n}/{len(chunks)} chunks")
            ok += 1
            total_chunks += n
        except Exception as exc:
            print(f"  [DB] {f.name}: {str(exc)[:300]}")
            failed += 1

    print(f"\n=== 完成 ===")
    print(f"成功: {ok} 个")
    print(f"失败: {failed} 个")
    print(f"跳过: {skipped} 个")
    print(f"总分块: {total_chunks}")
    print(f"结束: {datetime.now().strftime('%H:%M:%S')}")


if __name__ == "__main__":
    main()
