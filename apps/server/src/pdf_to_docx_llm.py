"""
LLM 重新排版 PDF 内容 → docx
流程：
1. pdftotext 提取 PDF 文本（保留 layout）
2. LLM 解析为结构化 JSON（识别标题/段落/表格/列表）
3. python-docx 根据 JSON 生成带样式的 docx

调用：
  python pdf_to_docx_llm.py <pdf> <docx> <model>
  model = demo|openai|ollama
"""
import subprocess
import sys
import os
import re
import json

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _sanitize(text: str) -> str:
    return _CONTROL_CHARS.sub("", text)


def extract_text(pdf_path: str) -> str:
    """提取 PDF 文本"""
    r = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", pdf_path, "-"],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"pdftotext failed: {r.stderr}")
    return _sanitize(r.stdout)


def call_llm(text: str, model: str) -> list:
    """调用 LLM 解析 PDF 文本为结构化 blocks

    返回格式：[{type, level?, content}]
    """
    # 系统提示（简洁版）
    system_prompt = """你是文档结构化工具。输入是 PDF 提取的文本（中文）。

任务：把文本切分为 JSON 数组。每个元素结构：

{"type": "<类型>", "content": "<内容>"} 或 {"type": "table", "rows": [["a","b"],["c","d"]]}

type 必须是以下之一：
- heading1（一级标题）
- heading2（二级标题）
- paragraph（普通段落）
- table（表格，rows 是二维数组）
- list_item（列表项）

重要：只输出 JSON 数组，用 markdown ```json 包裹。"""

    # 用户提示（含 PDF 文本）
    # 截断避免超长
    max_chars = 4000
    truncated = text[:max_chars]
    if len(text) > max_chars:
        truncated += "\n\n[内容过长，已截断...]"

    user_prompt = f"请把以下 PDF 内容解析为 JSON：\n\n{truncated}"

    # 调用 LLM
    sys.path.insert(0, "/home/ygycliu/ComfyUI/.venv/lib/python3.11/site-packages")
    import httpx

    # 配置
    model_config = {
        "demo": {
            "url": "http://127.0.0.1:3001/api/consultations",
            "type": "internal"
        },
        "openai": {
            "url": os.environ.get("OPENAI_BASE_URL", "http://localhost:1234/v1/chat/completions"),
            "api_key": os.environ.get("OPENAI_API_KEY", ""),
            "model": os.environ.get("OPENAI_MODEL", "MiniMax-M3")
        },
        "ollama": {
            "url": os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat"),
            "model": os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
        }
    }

    cfg = model_config.get(model, model_config["demo"])

    return _call_llm_with_fallback(cfg, system_prompt, user_prompt, text)


def _call_openai_compat(cfg: dict, system: str, user: str) -> list:
    """OpenAI 兼容 API"""
    import httpx
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    try:
        r = httpx.post(
            cfg["url"],
            headers=headers,
            json={
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ],
                "temperature": 0.1,
                "max_tokens": 12000
            },
            timeout=60
        )
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        return _parse_llm_json(content)
    except Exception as e:
        print(f"LLM call failed: {e}")
        return _heuristic_parse(user)


def _call_ollama(cfg: dict, system: str, user: str) -> list:
    """Ollama API"""
    import httpx
    try:
        r = httpx.post(
            cfg["url"],
            json={
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user}
                ],
                "stream": False
            },
            timeout=120
        )
        r.raise_for_status()
        data = r.json()
        content = data["message"]["content"]
        return _parse_llm_json(content)
    except Exception as e:
        print(f"Ollama call failed: {e}")
        return _heuristic_parse(user)
    """调用 LLM + 失败 fallback 到启发式（用原始 PDF 文本）"""
    try:
        import httpx
        if model_cfg.get("type") == "internal":
            return _call_internal_demo(system, user)

        if model_cfg["url"].endswith("/chat/completions"):
            r = httpx.post(
                model_cfg["url"],
                json={
                    "model": model_cfg["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4000
                },
                headers={
                    "Authorization": f"Bearer {model_cfg.get('api_key', '')}",
                    "Content-Type": "application/json"
                } if model_cfg.get("api_key") else {"Content-Type": "application/json"},
                timeout=60
            )
        else:
            r = httpx.post(
                model_cfg["url"],
                json={
                    "model": model_cfg["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                    "stream": False
                },
                timeout=120
            )
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"] if "choices" in data else data["message"]["content"]
        result = _parse_llm_json(content)
        if result:
            return result
        print(f"LLM parse returned empty, falling back to heuristic")
        return _heuristic_parse(raw_text)
    except Exception as e:
        print(f"LLM call failed: {e}")
        return _heuristic_parse(raw_text)


def _call_internal_demo(system: str, user: str) -> list:
    """内部 demo 模型（暂用启发式）"""
    # 从 user 中提取 PDF 文本
    import re
    m = re.search(r"请把以下 PDF 内容解析为 JSON：\n\n(.+)", user, re.DOTALL)
    text = m.group(1) if m else user
    return _heuristic_parse(text)


def _call_llm_with_fallback(model_cfg: dict, system: str, user: str, raw_text: str) -> list:
    """调用 LLM + 失败 fallback 到启发式"""
    try:
        import httpx
        if model_cfg.get("type") == "internal":
            import re
            m = re.search(r"请把以下 PDF 内容解析为 JSON：\n\n(.+)", user, re.DOTALL)
            text = m.group(1) if m else user
            return _heuristic_parse(text)

        if model_cfg["url"].endswith("/chat/completions"):
            headers = {"Content-Type": "application/json"}
            if model_cfg.get("api_key"):
                headers["Authorization"] = f"Bearer {model_cfg['api_key']}"
            r = httpx.post(
                model_cfg["url"],
                headers=headers,
                json={
                    "model": model_cfg["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4000
                },
                timeout=60
            )
        else:
            r = httpx.post(
                model_cfg["url"],
                json={
                    "model": model_cfg["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                    "stream": False
                },
                timeout=120
            )
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"] if "choices" in data else data["message"]["content"]
        result = _parse_llm_json(content)
        if result:
            return result
        print(f"LLM parse returned empty, falling back to heuristic")
        return _heuristic_parse(raw_text)
    except Exception as e:
        print(f"LLM call failed: {e}")
        return _heuristic_parse(raw_text)


def _parse_llm_json(content: str) -> list:
    """从 LLM 输出解析 JSON（可能包在 markdown 中、可能不是 array）"""
    text = content.strip()

    # 1. 直接解析
    try:
        parsed = json.loads(text)
        return _coerce_to_blocks(parsed)
    except Exception:
        pass

    # 2. ```json ... ``` 块（可能多个，取最后一个含数组/对象的）
    matches = list(re.finditer(r'```(?:json)?\s*\n?(.+?)\n?\s*```', text, re.DOTALL))
    if matches:
        # 优先取包含数组的
        for m in matches:
            inner = m.group(1).strip()
            try:
                parsed = json.loads(inner)
                result = _coerce_to_blocks(parsed)
                if result:
                    return result
            except Exception:
                continue
        # 退化：取第一个
        try:
            parsed = json.loads(matches[0].group(1).strip())
            return _coerce_to_blocks(parsed)
        except Exception:
            pass

    # 3. 任意 [...] 块（找最外层）
    bracket_matches = list(re.finditer(r'^\s*(\[)', text, re.MULTILINE))
    if bracket_matches:
        start = bracket_matches[0].start()
        # 找匹配的 ]
        depth = 0
        end_idx = None
        for i in range(start, len(text)):
            if text[i] == '[':
                depth += 1
            elif text[i] == ']':
                depth -= 1
                if depth == 0:
                    end_idx = i + 1
                    break
        if end_idx:
            try:
                return json.loads(text[start:end_idx])
            except Exception:
                pass

    # 4. 任意 {...} 块
    m = re.search(r'(\{[\s\S]*\})', text)
    if m:
        try:
            parsed = json.loads(m.group(1))
            return _coerce_to_blocks(parsed)
        except Exception:
            pass

    return _heuristic_parse(content)


def _coerce_to_blocks(obj) -> list:
    """把 LLM 输出（可能是 dict / list / mixed）转为 block list"""
    if isinstance(obj, list):
        return [b for b in obj if isinstance(b, dict)]

    if isinstance(obj, dict):
        # 如果 dict value 都是 dict → 转为多个 block
        # 例如：{"heading1": "标题", "paragraph": "..."}
        # 或：{"销售政策": {"key": "value"}}
        blocks = []
        for key, value in obj.items():
            normalized_type = _normalize_type(str(key))
            if isinstance(value, str):
                blocks.append({"type": normalized_type, "content": value})
            elif isinstance(value, list):
                if normalized_type == "table" and value and isinstance(value[0], list):
                    blocks.append({"type": "table", "rows": value})
                else:
                    for item in value:
                        if isinstance(item, dict):
                            blocks.append({"type": normalized_type, "content": json.dumps(item, ensure_ascii=False)})
                        else:
                            blocks.append({"type": "paragraph", "content": str(item)})
            elif isinstance(value, dict):
                # 嵌套 dict 当作 paragraph（含 JSON 表示）
                blocks.append({"type": "paragraph", "content": json.dumps(value, ensure_ascii=False)})
            else:
                blocks.append({"type": normalized_type, "content": str(value)})
        return blocks

    return []


def _normalize_type(btype: str) -> str:
    """规范化 type（支持中英文别名）"""
    btype = (btype or "paragraph").lower().strip()
    aliases = {
        "标题": "heading", "一级标题": "heading1", "二级标题": "heading2",
        "三级标题": "heading3", "子标题": "heading", "h1": "heading1",
        "h2": "heading2", "h3": "heading3",
        "文本": "paragraph", "段落": "paragraph", "正文": "paragraph",
        "p": "paragraph", "para": "paragraph",
        "列表项": "list_item", "列表": "list_item", "list": "list_item",
        "li": "list_item", "bullet": "list_item",
        "表格": "table", "tbl": "table",
        "引用": "quote", "quote": "quote",
    }
    return aliases.get(btype, btype)


def _normalize_blocks(blocks):
    """规范化 blocks：统一 type 名 + 提取表格 rows"""
    out = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        new = dict(b)
        btype = _normalize_type(b.get("type", "paragraph"))
        new["type"] = btype

        # table: rows 可能在 content 字段（LLM 错误输出）
        if btype == "table":
            rows = b.get("rows")
            if not rows and isinstance(b.get("content"), list):
                rows = b["content"]
            new["rows"] = rows or []

        # heading: 处理 level
        if btype.startswith("heading") and btype[7:].isdigit():
            level = int(btype[7:])
            if "level" in b:
                # 如果 LLM 给 0-indexed level
                ll = b["level"]
                if isinstance(ll, int) and ll < level:
                    level = ll + 1
            new["type"] = f"heading{min(level, 3)}"

        out.append(new)
    return out


def _heuristic_parse(text: str) -> list:
    """启发式解析（无 LLM 时使用）"""
    blocks = []
    lines = text.split("\n")

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue

        # 标题识别
        # 第X章 / 第X节
        if re.match(r'^\s*第[一二三四五六七八九十百零0-9]+[章部分]', line):
            blocks.append({"type": "heading1", "content": line.strip()})
            i += 1
            continue
        # X. / X.Y / X.Y.Z
        m = re.match(r'^\s*(\d+(?:\.\d+){0,2})\s+(.+)$', line)
        if m and len(m.group(2)) < 80:
            depth = m.group(1).count(".") + 1
            blocks.append({"type": f"heading{min(depth, 3)}", "content": m.group(2).strip()})
            i += 1
            continue
        # 附录
        if re.match(r'^\s*附录\s*[A-Z]', line):
            blocks.append({"type": "heading1", "content": line.strip()})
            i += 1
            continue

        # 列表项
        if re.match(r'^\s*[•·\-\*]\s+', line):
            blocks.append({"type": "list_item", "level": 0, "content": re.sub(r'^\s*[•·\-\*]\s+', '', line).strip()})
            i += 1
            continue
        if re.match(r'^\s*\d+\.\s+', line):
            blocks.append({"type": "list_item", "level": 0, "content": re.sub(r'^\s*\d+\.\s+', '', line).strip()})
            i += 1
            continue

        # 表格识别：连续多行有多个空格分隔（≥ 3 列）
        if i + 2 < len(lines):
            test_lines = [lines[i], lines[i+1], lines[i+2]]
            col_counts = [len(re.findall(r'\s{2,}', l)) + 1 for l in test_lines if l.strip()]
            if all(c >= 3 for c in col_counts):
                # 表格
                table_rows = []
                while i < len(lines) and lines[i].strip():
                    cells = re.split(r'\s{2,}', lines[i].strip())
                    if len(cells) >= 2:
                        table_rows.append(cells)
                    else:
                        break
                    i += 1
                if table_rows:
                    blocks.append({"type": "table", "rows": table_rows})
                continue

        # 默认段落
        blocks.append({"type": "paragraph", "content": line.strip()})
        i += 1

    return blocks
    """启发式解析（无 LLM 时使用）"""
    blocks = []
    lines = text.split("\n")

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue

        # 标题识别
        # 第X章 / 第X节
        if re.match(r'^\s*第[一二三四五六七八九十百零0-9]+[章部分]', line):
            blocks.append({"type": "heading1", "content": line.strip()})
            i += 1
            continue
        # X. / X.Y / X.Y.Z
        m = re.match(r'^\s*(\d+(?:\.\d+){0,2})\s+(.+)$', line)
        if m and len(m.group(2)) < 80:
            depth = m.group(1).count(".") + 1
            blocks.append({"type": f"heading{min(depth, 3)}", "content": m.group(2).strip()})
            i += 1
            continue
        # 附录
        if re.match(r'^\s*附录\s*[A-Z]', line):
            blocks.append({"type": "heading1", "content": line.strip()})
            i += 1
            continue

        # 列表项
        if re.match(r'^\s*[•·\-\*]\s+', line):
            blocks.append({"type": "list_item", "level": 0, "content": re.sub(r'^\s*[•·\-\*]\s+', '', line).strip()})
            i += 1
            continue
        if re.match(r'^\s*\d+\.\s+', line):
            blocks.append({"type": "list_item", "level": 0, "content": re.sub(r'^\s*\d+\.\s+', '', line).strip()})
            i += 1
            continue

        # 表格识别：连续多行有多个空格分隔（≥ 3 列）
        if i + 2 < len(lines):
            test_lines = [lines[i], lines[i+1], lines[i+2]]
            col_counts = [len(re.findall(r'\s{2,}', l)) + 1 for l in test_lines if l.strip()]
            if all(c >= 3 for c in col_counts):
                    # 表格
                    table_rows = []
                    while i < len(lines) and lines[i].strip():
                        cells = re.split(r'\s{2,}', lines[i].strip())
                        if len(cells) >= 2:
                            table_rows.append(cells)
                        else:
                            break
                        i += 1
                    if table_rows:
                        blocks.append({"type": "table", "rows": table_rows})
                    continue

        # 默认段落
        blocks.append({"type": "paragraph", "content": line.strip()})
        i += 1

    return blocks


def render_docx(blocks: list, docx_path: str) -> None:
    """根据 blocks 生成 docx"""
    sys.path.insert(0, "/home/ygycliu/ComfyUI/.venv/lib/python3.11/site-packages")
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document()

    # 标题样式
    styles = doc.styles
    styles["Normal"].font.name = "Microsoft YaHei"
    styles["Normal"].font.size = Pt(11)

    for h_level in [1, 2, 3]:
        if f"Heading {h_level}" in styles:
            h_style = styles[f"Heading {h_level}"]
            h_style.font.name = "Microsoft YaHei"
            h_style.font.bold = True
            if h_level == 1:
                h_style.font.size = Pt(20)
                h_style.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)
            elif h_level == 2:
                h_style.font.size = Pt(15)
                h_style.font.color.rgb = RGBColor(0x4A, 0x55, 0x68)
            else:
                h_style.font.size = Pt(13)

    for block in blocks:
        btype = block.get("type", "paragraph")
        content = block.get("content", "")

        if btype in ("heading1", "heading2", "heading3"):
            level = int(btype[-1])
            p = doc.add_heading(content, level=min(level, 3))
        elif btype == "list_item":
            level = block.get("level", 0)
            if level == 0:
                doc.add_paragraph(content, style="List Bullet")
            else:
                # 子列表用缩进
                p = doc.add_paragraph("  " * level + "• " + content)
        elif btype == "table":
            rows = block.get("rows", [])
            if rows:
                max_cols = max(len(r) for r in rows)
                # 补齐列数
                rows = [r + [""] * (max_cols - len(r)) for r in rows]
                table = doc.add_table(rows=len(rows), cols=max_cols)
                table.style = "Light Grid Accent 1"
                for ri, row in enumerate(rows):
                    for ci, cell in enumerate(row):
                        cell_obj = table.cell(ri, ci)
                        cell_obj.text = cell
                        if ri == 0:
                            # 表头加粗
                            for p in cell_obj.paragraphs:
                                for run in p.runs:
                                    run.font.bold = True
                                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        elif btype == "quote":
            p = doc.add_paragraph(content, style="Intense Quote")
        else:  # paragraph
            doc.add_paragraph(content)

    doc.save(docx_path)


def pdf_to_docx(pdf_path: str, docx_path: str, model: str = "demo") -> None:
    text = extract_text(pdf_path)
    print(f"[1/3] 提取 PDF 文本: {len(text)} 字符")

    if model == "demo":
        print(f"[2/3] 用 demo（启发式解析）")
    else:
        print(f"[2/3] 用 {model} LLM 解析结构")

    blocks = call_llm(text, model)
    blocks = _normalize_blocks(blocks)
    print(f"      解析得到 {len(blocks)} 个块")

    render_docx(blocks, docx_path)
    print(f"[3/3] 生成 docx: {os.path.getsize(docx_path):,} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: pdf_to_docx_llm.py <pdf> <docx> [model]")
        print("  model: demo (启发式) | openai | ollama")
        sys.exit(1)
    pdf = sys.argv[1]
    out = sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "demo"
    pdf_to_docx(pdf, out, model)