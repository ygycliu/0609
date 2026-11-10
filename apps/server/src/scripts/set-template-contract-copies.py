#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把合同份数固化进合同模板（默认「一式贰份，甲方壹份、乙方壹份」）。

华中模板 HZCX-01-3-D2 的第二十二条留了三处带下划线的空白：
    二十二、本合同一式____份，甲方____份、乙方____份，均具有同等法律效力。
            ↑ run4            ↑ run8        ↑ run10
本脚本把三处空白直接写进模板文件本身，使模板默认就带着约定的份数，
之后用 fill-hzcx-contract.py 生成合同时无需再指定。

模板里没有 docxtemplater 的 {placeholder}，因此预填内容不影响模板引擎的渲染。

用法：
    python3 set-template-contract-copies.py <模板.docx> [--total 贰] [--party-a 壹] [--party-b 壹] [--dry-run]

原地修改模板文件；重复执行结果一致（幂等）。
"""
import argparse
import shutil
import zipfile
from pathlib import Path

from lxml import etree as ET

TEMPLATE_DEFAULT = "/opt/ai-consulting-center/data/templates/HZCX-01-3-D2.docx"

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

# 第二十二条的固定文字与三处空白的 run 下标
CLAUSE_PREFIX = "二十二、本合同一式"
RUN_TOTAL = 4      # 一式____份
RUN_PARTY_A = 8    # 甲方____份
RUN_PARTY_B = 10   # 乙方____份


def q(tag):
    p, l = tag.split(":")
    return "{%s}%s" % (NS[p], l)


def para_text(p):
    return "".join(t.text or "" for t in p.iter(q("w:t")))


def set_run_text(r, text):
    ts = list(r.iter(q("w:t")))
    if not ts:
        ts = [ET.SubElement(r, q("w:t"))]
    ts[0].text = text
    ts[0].set(XML_SPACE, "preserve")
    for extra in ts[1:]:
        extra.text = ""


def main():
    parser = argparse.ArgumentParser(description="把合同份数固化进合同模板")
    parser.add_argument("template", nargs="?", default=TEMPLATE_DEFAULT, help="模板 .docx 路径")
    parser.add_argument("--total", default="贰", help="合同总份数，如 贰")
    parser.add_argument("--party-a", default="壹", help="甲方份数，如 壹")
    parser.add_argument("--party-b", default="壹", help="乙方份数，如 壹")
    parser.add_argument("--dry-run", action="store_true", help="只打印将写入的内容，不改动文件")
    args = parser.parse_args()

    template = Path(args.template)
    if not template.exists():
        raise SystemExit("模板不存在: %s" % template)

    with zipfile.ZipFile(template) as z:
        names = z.namelist()
        blobs = {n: z.read(n) for n in names}

    parser_xml = ET.XMLParser(remove_blank_text=False, huge_tree=True)
    root = ET.fromstring(blobs["word/document.xml"], parser_xml)
    body = root.find(q("w:body"))

    target = None
    for p in body.iter(q("w:p")):
        if para_text(p).startswith(CLAUSE_PREFIX):
            target = p
            break
    if target is None:
        raise SystemExit("模板中未找到「%s」条款" % CLAUSE_PREFIX)

    rs = list(target.iter(q("w:r")))
    if len(rs) <= RUN_PARTY_B:
        raise SystemExit("条款 run 结构异常（%d 个 run），未写入" % len(rs))

    before = para_text(target)
    set_run_text(rs[RUN_TOTAL], args.total)
    set_run_text(rs[RUN_PARTY_A], args.party_a)
    set_run_text(rs[RUN_PARTY_B], args.party_b)
    after = para_text(target)

    print("模板: %s" % template)
    print("  改前: %s" % before)
    print("  改后: %s" % after)

    if args.dry_run:
        print("（--dry-run，未改动文件）")
        return

    blobs["word/document.xml"] = ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)

    # 先写临时文件再替换，避免写坏模板
    tmp = template.with_suffix(template.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, blobs[n])
    shutil.move(str(tmp), str(template))
    print("已写入: %s" % template)


if __name__ == "__main__":
    main()
