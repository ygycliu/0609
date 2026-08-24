"""
用 pdftotext + python-docx 实现 PDF 转 docx
调用：python pdf_to_docx.py <pdf> <out.docx>
"""
import subprocess
import sys
import os
import re

# 过滤掉 XML 不允许的控制字符（保留 \n \r \t）
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _sanitize(text: str) -> str:
    return _CONTROL_CHARS.sub("", text)


def pdf_to_docx(pdf_path: str, docx_path: str) -> None:
    """提取 PDF 文本 + 用 python-docx 写 docx（保留段落）"""
    # 1. 提取（保留 layout）
    result = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", pdf_path, "-"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed: {result.stderr}")

    text = _sanitize(result.stdout)

    # 2. 用 python-docx 写
    sys.path.insert(0, "/home/ygycliu/ComfyUI/.venv/lib/python3.11/site-packages")
    from docx import Document
    from docx.shared import Pt as DocxPt

    doc = Document()
    # 设置默认字体（中文友好）
    style = doc.styles["Normal"]
    style.font.name = "Microsoft YaHei"
    style.font.size = DocxPt(11)

    for line in text.split("\n"):
        # 跳过空行（避免无限空段）
        if line.strip() == "":
            continue
        doc.add_paragraph(line)

    doc.save(docx_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: pdf_to_docx.py <pdf> <docx>")
        sys.exit(1)
    pdf_to_docx(sys.argv[1], sys.argv[2])
    print(f"OK: {os.path.getsize(sys.argv[2])} bytes")