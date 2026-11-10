#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用华中模板（HZCX-01-3-D2）生成管理体系、服务认证合同书。

做法：直接编辑官方空白模板 word/document.xml 中的文本 run，
保留每个 run / 段落自带的字体、字号、加粗、下划线等格式，只替换或填充文字内容。

用法：
    python3 fill-hzcx-contract.py <输出.docx> [--data 合同数据.json] [--template 模板.docx]

合同数据 JSON 字段见下方 DEFAULTS；未给出的字段沿用默认值。
"""
import argparse
import copy
import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree as ET

TEMPLATE_DEFAULT = "/opt/ai-consulting-center/data/templates/HZCX-01-3-D2.docx"

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def q(tag):
    p, l = tag.split(":")
    return "{%s}%s" % (NS[p], l)


# ---------------------------------------------------------------- 合同数据
# 默认值：宁夏佳士洁水处理有限公司（2026-020）。可用命令行参数或 JSON 覆盖。
DEFAULTS = {
    "customer": "宁夏佳士洁水处理有限公司",
    "standards": ("GB/T 19001-2016 / ISO 9001:2015、GB/T 24001-2016 / ISO 14001:2015、"
                  "GB/T 45001-2020 / ISO 45001:2018"),
    "scope": ("工业水处理药剂、阻垢缓蚀剂（阻垢剂、缓蚀剂）、非氧化杀菌剂、粘泥剥离剂、"
              "聚合氯化铝（絮凝剂）、聚丙烯酰胺（聚凝剂）、锅炉水处理剂的生产，"
              "化工原材料的销售（危化品除外）"),
    "region": "宁夏银川市",
    "headcount": "　",        # 体系内有效人数；无数据时留空待甲方确认
    "systems": ["QMS", "EMS", "OHSMS"],
    "year_initial": "2026",
    "year_sup1": "2027",
    "year_sup2": "2028",
    "fee_initial": 12000,
    "fee_sup1": 9000,
    "fee_sup2": 9000,
    "bank_name": "招商银行南昌分行铁路支行",
    "bank_account": "7919 0492 5410 401",
    "bank_holder": "华中国际认证检验集团有限公司",
    "copies_total": "贰",
    "copies_party_a": "壹",
    "copies_party_b": "壹",
}

CN_NUM = {0: "零", 1: "壹", 2: "贰", 3: "叁", 4: "肆", 5: "伍", 6: "陆", 7: "柒", 8: "捌", 9: "玖"}
CN_UNIT = ["", "拾", "佰", "仟"]
CN_BIG = ["", "万", "亿"]


def rmb_upper(amount: int) -> str:
    """人民币金额大写（不含“元整”，模板 run14 已带“元整)”）：12000 -> 壹万贰仟"""
    if amount == 0:
        return "零"
    digits = []
    n = amount
    while n > 0:
        digits.append(n % 10)
        n //= 10
    digits.reverse()

    groups = []
    g = digits
    while g:
        groups.append(g[-4:])
        g = g[:-4]
    groups.reverse()

    parts = []
    for gi, grp in enumerate(groups):
        grp_text = ""
        zero_flag = False
        for i, d in enumerate(grp):
            unit = CN_UNIT[len(grp) - 1 - i]
            if d == 0:
                zero_flag = True
                continue
            if zero_flag and grp_text:
                grp_text += "零"
            zero_flag = False
            grp_text += CN_NUM[d] + unit
        if grp_text:
            parts.append(grp_text + CN_BIG[len(groups) - 1 - gi])
    return "".join(parts)


# ---------------------------------------------------------------- XML 工具
def para_text(p):
    return "".join(t.text or "" for t in p.iter(q("w:t")))


def runs_of(p):
    return list(p.iter(q("w:r")))


def run_text(r):
    return "".join(t.text or "" for t in r.iter(q("w:t")))


def set_run_text(r, text):
    ts = list(r.iter(q("w:t")))
    if not ts:
        t = ET.SubElement(r, q("w:t"))
        ts = [t]
    ts[0].text = text
    ts[0].set(XML_SPACE, "preserve")
    for extra in ts[1:]:
        extra.text = ""


def make_run_from_para(p, text):
    """按段落 w:pPr/w:rPr 的格式新建一个 run"""
    r = ET.Element(q("w:r"))
    pPr = p.find(q("w:pPr"))
    if pPr is not None:
        rPr = pPr.find(q("w:rPr"))
        if rPr is not None:
            r.append(copy.deepcopy(rPr))
    t = ET.SubElement(r, q("w:t"))
    t.text = text
    t.set(XML_SPACE, "preserve")
    return r


def set_cell_text(tc, text):
    """给表格单元格写文字：复用首个段落已有的 run；没有 run 时按 pPr/rPr 新建"""
    ps = [p for p in tc.iter(q("w:p"))]
    if not ps:
        return
    p = ps[0]
    rs = runs_of(p)
    if rs:
        set_run_text(rs[0], text)
        for r in rs[1:]:
            set_run_text(r, "")
    else:
        p.append(make_run_from_para(p, text))
    # 单元格里的其它段落清空
    for extra in ps[1:]:
        for r in runs_of(extra):
            set_run_text(r, "")


def normalize_fill_run(r, underline=True):
    """把填充内容的 run 统一成合同惯例格式：宋体 / 小四(sz=24) / 不加粗 / 单下划线"""
    rPr = r.find(q("w:rPr"))
    if rPr is None:
        rPr = ET.Element(q("w:rPr"))
        r.insert(0, rPr)
    # 字体统一为宋体
    fonts = rPr.find(q("w:rFonts"))
    if fonts is None:
        fonts = ET.SubElement(rPr, q("w:rFonts"))
    fonts.set(q("w:hint"), "eastAsia")
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        fonts.set(q(attr), "宋体")
    # 去掉加粗、斜体
    for tag in ("w:b", "w:bCs", "w:i", "w:iCs"):
        el = rPr.find(q(tag))
        if el is not None:
            rPr.remove(el)
    # 字号统一 24（小四），与正文一致
    for tag in ("w:sz", "w:szCs"):
        el = rPr.find(q(tag))
        if el is None:
            el = ET.SubElement(rPr, q(tag))
        el.set(q("w:val"), "24")
    # 下划线
    u = rPr.find(q("w:u"))
    if underline:
        if u is None:
            u = ET.SubElement(rPr, q("w:u"))
        u.set(q("w:val"), "single")
    elif u is not None:
        rPr.remove(u)


def replace_paragraph(p, text, keep_prefix_runs=0, fill_format=True):
    """把段落从第 keep_prefix_runs 个 run 起整体替换为 text（保留首个 run 的格式）"""
    rs = runs_of(p)
    if not rs:
        return
    if len(rs) <= keep_prefix_runs:
        set_run_text(rs[0], text)
        if fill_format:
            normalize_fill_run(rs[0])
        return
    fmt = rs[keep_prefix_runs]
    # 先把文字写进要保留格式的 run，再删除其余 run
    set_run_text(fmt, text)
    for r in rs[keep_prefix_runs + 1:]:
        r.getparent().remove(r)
    if fill_format:
        normalize_fill_run(fmt)


def insert_paragraph_after(p, text):
    """在段落 p 之后插入一个新段落，格式沿用 p"""
    new_p = copy.deepcopy(p)
    for r in runs_of(new_p):
        r.getparent().remove(r)
    r = make_run_from_para(new_p, text)
    new_p.append(r)
    p.addnext(new_p)
    return new_p


def check_box(runs, labels):
    """把 '（）QMS' 这类复选框改成 '（√）QMS'；复选框括号是独立 run，需按顺序匹配"""
    hit = []
    for i, r in enumerate(runs):
        t = run_text(r).strip()
        if t in ("（）", "( )", "()"):
            nxt = run_text(runs[i + 1]).strip() if i + 1 < len(runs) else ""
            for lab in labels:
                if nxt.startswith(lab):
                    set_run_text(r, "（√）")
                    hit.append(lab)
                    break
    return hit


# ---------------------------------------------------------------- 主流程
def main():
    parser = argparse.ArgumentParser(description="用华中模板 HZCX-01-3-D2 生成认证合同书")
    parser.add_argument("out", help="输出 .docx 路径")
    parser.add_argument("--data", help="合同数据 JSON 路径")
    parser.add_argument("--template", default=TEMPLATE_DEFAULT, help="模板 .docx 路径")
    args = parser.parse_args()

    cfg = dict(DEFAULTS)
    if args.data:
        with open(args.data, encoding="utf-8") as f:
            cfg.update(json.load(f))

    template = Path(args.template)
    out_docx = Path(args.out)
    if not template.exists():
        raise SystemExit("模板不存在: %s" % template)

    customer = cfg["customer"]
    standards = cfg["standards"]
    scope = cfg["scope"]
    region = cfg["region"]
    headcount = cfg["headcount"]
    systems = cfg["systems"]
    year_initial, year_sup1, year_sup2 = cfg["year_initial"], cfg["year_sup1"], cfg["year_sup2"]
    fee_initial, fee_sup1, fee_sup2 = cfg["fee_initial"], cfg["fee_sup1"], cfg["fee_sup2"]

    with zipfile.ZipFile(template) as z:
        names = z.namelist()
        blobs = {n: z.read(n) for n in names}

    parser = ET.XMLParser(remove_blank_text=False, huge_tree=True)
    root = ET.fromstring(blobs["word/document.xml"], parser)
    body = root.find(q("w:body"))
    paras = list(body.iter(q("w:p")))
    tables = [t for t in body.iter(q("w:tbl"))]

    log = []

    # ---- 1. 申请认证组织名称
    for p in paras:
        if para_text(p).startswith("申请认证组织名称"):
            rs = runs_of(p)
            set_run_text(rs[0], "申请认证组织名称：" + customer)
            for r in rs[1:]:
                set_run_text(r, "")
            log.append("组织名称 -> %s" % customer)
            break

    # ---- 2. 认证类型表：勾选初次认证 + QMS/EMS/OHSMS
    cert_rows = list(tables[0].iter(q("w:tr")))
    cells = list(cert_rows[1].iter(q("w:tc")))
    set_cell_text(cells[0], "（√）初次认证")
    domain_p = list(cells[1].iter(q("w:p")))[0]
    check_box(runs_of(domain_p), systems)
    log.append("认证类型 -> 初次认证 / " + "+".join(systems))

    # ---- 3. 认证依据（单独成段）
    for p in paras:
        if para_text(p).startswith("1.认证依据"):
            new_p = insert_paragraph_after(p, standards)
            normalize_fill_run(runs_of(new_p)[0])
            log.append("认证依据 -> %s" % standards)
            break

    # ---- 4. 覆盖的产品/服务范围（保留 run0..3 的标签，只替换后面的空白）
    for p in paras:
        if para_text(p).startswith("2.甲方管理体系覆盖的产品/服务范围"):
            replace_paragraph(p, scope, keep_prefix_runs=4)
            log.append("产品/服务范围 -> 已填")
            break

    # ---- 5. 区域场所范围
    for p in paras:
        if para_text(p).startswith("甲方管理体系覆盖的区域场所范围"):
            replace_paragraph(p, region, keep_prefix_runs=2)
            log.append("区域场所范围 -> %s" % region)
            break

    # ---- 6. 有效人数 + 多场所
    for p in paras:
        if para_text(p).startswith("甲方体系内有效人数"):
            rs = runs_of(p)
            set_run_text(rs[1], headcount)
            set_run_text(rs[2], "")
            set_run_text(rs[3], "")
            set_run_text(rs[7], "（√）无（）有")
            normalize_fill_run(rs[1])
            log.append("有效人数 -> %s；多场所 -> 无" % (headcount.strip() or "留空待确认"))
            break

    # ---- 7. 费用明细表
    fee_rows = list(tables[1].iter(q("w:tr")))
    row2 = list(fee_rows[2].iter(q("w:tc")))
    row3 = list(fee_rows[3].iter(q("w:tc")))
    set_cell_text(row2[0], "、".join(systems))
    set_cell_text(row2[1], year_initial)
    set_cell_text(row2[2], str(fee_initial))
    set_cell_text(row2[3], year_sup1)
    set_cell_text(row2[4], str(fee_sup1))
    set_cell_text(row2[5], "/")
    set_cell_text(row2[6], "/")
    set_cell_text(row3[3], year_sup2)
    set_cell_text(row3[4], str(fee_sup2))
    log.append("费用表 -> %s 初次 %s=%s，监督 %s=%s，%s=%s" % (
        "、".join(systems), year_initial, fee_initial, year_sup1, fee_sup1, year_sup2, fee_sup2))

    # ---- 8. 交费说明 4 行
    fee_paras = [p for p in paras if "年应交认证费用" in para_text(p)]
    if len(fee_paras) != 4:
        raise SystemExit("交费说明段落数异常: %d" % len(fee_paras))
    for p, (year, amount) in zip(fee_paras, [(year_initial, fee_initial),
                                             (year_sup1, fee_sup1),
                                             (year_sup2, fee_sup2),
                                             ("/", 0)]):
        rs = runs_of(p)
        set_run_text(rs[0], year)
        normalize_fill_run(rs[0])
        if amount:
            set_run_text(rs[6], str(amount))
            set_run_text(rs[11], rmb_upper(amount))
            set_run_text(rs[13], "")
            normalize_fill_run(rs[6])
            normalize_fill_run(rs[11])
        else:
            set_run_text(rs[6], "/")
            set_run_text(rs[11], "/")
            set_run_text(rs[13], "")
            normalize_fill_run(rs[6])
            normalize_fill_run(rs[11])
    log.append("交费说明 -> %s / %s / %s / %s" % (year_initial, year_sup1, year_sup2, "/"))

    # ---- 9. 争议解决方式
    for p in paras:
        if "可通过以下第" in para_text(p) and "种途径解决" in para_text(p):
            replace_paragraph(p, "十九、在本合同实施中发生的争议，应本着友好协商的原则加以解决，"
                                "若协商不成，可通过以下第 1 种途径解决：")
            break

    # ---- 10. 乙方收款账户（模板内置旧账户，按实际收款账户替换）
    bank_lines = {
        "开户银行：交通银行股份有限公司南昌小蓝开发区支行":
            "开户银行：" + cfg["bank_name"],
        "银行账号：361899991011001319952":
            "银行账号：" + cfg["bank_account"],
        "收款单位：华中国际认证检验集团有限公司":
            "收款单位：" + cfg["bank_holder"],
    }
    for p in paras:
        t = para_text(p).strip()
        if t in bank_lines:
            replace_paragraph(p, bank_lines[t])
            log.append("乙方账户 -> %s" % bank_lines[t])

    # ---- 11. 一式份数（模板留了三处空白：总份数、甲方份数、乙方份数）
    for p in paras:
        if para_text(p).startswith("二十二、本合同一式"):
            rs = runs_of(p)
            # 模板结构：run4=总份数空白, run8=甲方份数空白, run10=乙方份数空白
            set_run_text(rs[4], cfg["copies_total"])
            set_run_text(rs[8], cfg["copies_party_a"])
            set_run_text(rs[10], cfg["copies_party_b"])
            log.append("合同份数 -> 一式%s份，甲方%s份、乙方%s份" % (
                cfg["copies_total"], cfg["copies_party_a"], cfg["copies_party_b"]))
            break

    blobs["word/document.xml"] = ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)

    out_docx.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_docx, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, blobs[n])

    print("已生成:", out_docx)
    for line in log:
        print("  -", line)


if __name__ == "__main__":
    main()
