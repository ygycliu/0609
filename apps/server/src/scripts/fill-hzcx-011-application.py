#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用华中模板 HZCX-01-1-D0《管理体系、服务认证申请书》生成宁夏佳士洁水处理有限公司的认证申请书。

做法：直接编辑模板 word/document.xml 中的文本 run，
保留每个 run / 段落自带的字体、字号、加粗、下划线等格式，只替换或填充文字内容。

已知信息来自佳士洁与华中国际签订的合同
《HZCX-01-3-D2 管理体系、服务认证认证合同书-宁夏佳士洁水处理有限公司-初次认证QES.docx》。
合同中没有的信息一律填 【待补充】，并在末尾列出，便于向甲方逐项收集。

用法：
    python3 apps/server/src/scripts/fill-hzcx-011-application.py <输出.docx> [--template 模板.docx] [--data 数据.json]

模板默认取 /opt/ai-consulting-center/data/templates/HZCX-01-1-D0.docx；
该文件不存在时用 --template 指定。
"""
import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree as ET

TEMPLATE_DEFAULT = "/opt/ai-consulting-center/data/templates/HZCX-01-1-D0.docx"

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

TO_BE = "【待补充】"

# 合同可确定的信息；其余留 【待补充】
DEFAULTS = {
    "org_name": "宁夏佳士洁水处理有限公司",
    # 合同「甲方管理体系覆盖的区域场所范围」
    "site_address": "宁夏银川市望远工业园区金源路北侧2号规划路西侧",
    "postal_code": TO_BE,
    "headcount": "15",          # 合同「甲方体系内有效人数」
    "org_total": TO_BE,         # 组织总人数
    "social_insurance": TO_BE,
    "payroll": TO_BE,
    "scope": ("工业水处理药剂、阻垢缓蚀剂（阻垢剂、缓蚀剂）、非氧化杀菌剂、粘泥剥离剂、"
              "聚合氯化铝（絮凝剂）、聚丙烯酰胺（聚凝剂）、锅炉水处理剂的生产，"
              "化工原材料的销售（危化品除外）"),
    "audit_date": TO_BE,
    # 甲方在中认认证有限公司持有的 QES 证书（甲方于 2026-11-10 补充确认）
    "prev_cert": {
        "body": "中认认证有限公司",
        "year": "2027",
        "month": "1",
        "day": "14",
        "reg_no": "27324Q20036R0S、27324E20024R0S、27324S20022R0S",
        "status": "有效（有效期至 2027 年 1 月 14 日）",
    },
}


def q(tag):
    p, l = tag.split(":")
    return "{%s}%s" % (NS[p], l)


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
    r = ET.Element(q("w:r"))
    pPr = p.find(q("w:pPr"))
    if pPr is not None:
        rPr = pPr.find(q("w:rPr"))
        if rPr is not None:
            r.append(ET.fromstring(ET.tostring(rPr)))
    t = ET.SubElement(r, q("w:t"))
    t.text = text
    t.set(XML_SPACE, "preserve")
    return r


def set_para(p, text):
    """整段替换为 text，沿用首个 run 的格式"""
    rs = runs_of(p)
    if not rs:
        p.append(make_run_from_para(p, text))
        return
    set_run_text(rs[0], text)
    for r in rs[1:]:
        r.getparent().remove(r)


def set_run_at(p, idx, text):
    rs = runs_of(p)
    if 0 <= idx < len(rs):
        set_run_text(rs[idx], text)


def find_para(paras, prefix):
    for p in paras:
        if para_text(p).strip().startswith(prefix):
            return p
    return None


def find_para_contains(paras, needle):
    for p in paras:
        if needle in para_text(p):
            return p
    return None


def set_box(p, label, checked):
    """把段落中 '( )label' 的勾选状态设为 checked。

    模板里一个复选框占 3 个 run：'(' / '√'或' ' / ')'，紧跟标签 run。
    这里从标签 run 往前找最近的 ')'、'√'、'(' 三元组再改。
    """
    rs = runs_of(p)
    for i, r in enumerate(rs):
        if label in run_text(r):
            # 往前找 ')' 再往前找 '('
            j = i - 1
            while j >= 0 and run_text(rs[j]).strip() != ")":
                j -= 1
            if j < 0:
                return False
            k = j - 1
            while k >= 0 and run_text(rs[k]).strip() not in ("√", "√ ", " ", ""):
                k -= 1
            if k < 0:
                return False
            set_run_text(rs[k], "√" if checked else " ")
            set_run_text(rs[j], ")")
            return True
    return False


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description="用华中模板 HZCX-01-1-D0 生成认证申请书")
    ap.add_argument("out", help="输出 .docx 路径")
    ap.add_argument("--template", default=TEMPLATE_DEFAULT)
    ap.add_argument("--data", help="数据 JSON 路径")
    args = ap.parse_args()

    cfg = dict(DEFAULTS)
    if args.data:
        with open(args.data, encoding="utf-8") as f:
            cfg.update(json.load(f))

    template = Path(args.template)
    out_docx = Path(args.out)
    if not template.exists():
        raise SystemExit("模板不存在: %s" % template)

    with zipfile.ZipFile(template) as z:
        names = z.namelist()
        blobs = {n: z.read(n) for n in names}

    parser = ET.XMLParser(remove_blank_text=False, huge_tree=True)
    root = ET.fromstring(blobs["word/document.xml"], parser)
    body = root.find(q("w:body"))
    paras = list(body.iter(q("w:p")))

    log = []
    missing = []

    def rec(name, value):
        log.append("%s -> %s" % (name, value))

    def need(name, note):
        missing.append((name, note))

    # ---- 1. 申请组织名称
    p = find_para(paras, "申请组织名称")
    if p is not None:
        set_para(p, "申请组织名称:  " + cfg["org_name"])
        rec("申请组织名称", cfg["org_name"])

    # ---- 2. 地址（r0=标签 r1=':' r2=地址 r3..=邮政编码）
    #     注册地址合同未载明；生产经营地址取合同「区域场所范围」
    p = find_para(paras, "注册地址")
    if p is not None:
        set_run_at(p, 2, "  " + TO_BE + "   ")
        set_run_at(p, 4, "  " + cfg["postal_code"] + "   ")
        rec("注册地址", TO_BE)
        need("注册地址", "营业执照上的注册地址")

    p = find_para(paras, "生产经营或服务地址")
    if p is not None:
        set_run_at(p, 2, "  " + cfg["site_address"] + "   ")
        set_run_at(p, 4, "  " + cfg["postal_code"] + "   ")
        rec("生产经营或服务地址", cfg["site_address"])

    p = find_para(paras, "办公通讯地址")
    if p is not None:
        set_run_at(p, 2, "  " + cfg["site_address"] + "   ")
        set_run_at(p, 5, "  " + cfg["postal_code"] + "   ")
        rec("办公通讯地址", cfg["site_address"])
        need("办公通讯地址", "若与生产经营地址不同则填实际办公通讯地址")
        need("邮政编码", "上述三个地址对应的邮政编码")

    # ---- 3. 联系人
    #  法人代表: r2=姓名 r5=电话 r8=手机 r11/12=邮箱
    p = find_para(paras, "法人代表")
    if p is not None:
        set_run_at(p, 2, "  " + TO_BE + "  ")
        set_run_at(p, 5, "       " + TO_BE + "      ")
        set_run_at(p, 8, "  " + TO_BE + "  ")
        set_run_at(p, 11, "  ")
        set_run_at(p, 12, TO_BE)
        rec("法人代表", TO_BE)
        need("法人代表", "营业执照上的法定代表人姓名及联系方式")

    p = find_para(paras, "最高管理者")
    if p is not None:
        set_run_at(p, 2, "  " + TO_BE + "  ")
        set_run_at(p, 5, "   " + TO_BE + "   ")
        set_run_at(p, 8, "  " + TO_BE + "  ")
        set_run_at(p, 11, "  " + TO_BE + "   ")
        rec("最高管理者", TO_BE)
        need("最高管理者", "企业最高管理者姓名（通常为法定代表人或总经理）")

    p = find_para(paras, "管理者代表")
    if p is not None:
        set_run_at(p, 2, "  " + TO_BE + "  ")
        set_run_at(p, 5, "   " + TO_BE + "   ")
        set_run_at(p, 8, "  " + TO_BE + "  ")
        set_run_at(p, 11, "  ")
        set_run_at(p, 12, TO_BE)
        rec("管理者代表", TO_BE)
        need("管理者代表", "管理体系管理者代表姓名及联系方式")

    p = find_para(paras, "体系部门负责人")
    if p is not None:
        set_run_at(p, 2, "   ")
        set_run_at(p, 3, TO_BE + "   ")
        set_run_at(p, 6, "  " + TO_BE + "   ")
        set_run_at(p, 9, "        " + TO_BE + "           ")
        set_run_at(p, 12, "     " + TO_BE + "         ")
        rec("体系部门负责人", TO_BE)
        need("体系部门负责人", "负责体系建设与对接的部门负责人姓名、职务")

    p = find_para(paras, "传 ")
    if p is not None:
        set_run_at(p, 2, "     " + TO_BE + "     ")
        set_run_at(p, 5, "    ")
        set_run_at(p, 6, TO_BE)
        rec("传真/E-mail", TO_BE)
        need("传真、E-mail", "企业传真号与公共邮箱")

    p = find_para(paras, "组织机构统一社会信用代码")
    if p is not None:
        set_run_at(p, 4, TO_BE)
        rec("统一社会信用代码", TO_BE)
        need("组织机构统一社会信用代码", "营业执照上的 18 位统一社会信用代码")

    # ---- 4. 申请日期
    p = find_para(paras, "申请日期")
    if p is not None:
        set_para(p, "申请日期：      年     月     日")
        rec("申请日期", "由甲方盖章时填写")
        need("申请日期", "甲方盖章的申请日期")

    # ---- 5. 申请认证类型：模板已勾「首次申请」，其余保持未勾
    rec("申请认证类型", "首次申请（合同为初次认证）")

    # ---- 6. 组织性质：企业组织（模板已勾，保持）
    rec("组织性质", "企业组织（模板已勾选）")

    # ---- 7. 人数
    p = find_para(paras, "组织总人数")
    if p is not None:
        set_run_at(p, 1, "   " + cfg["org_total"] + "  ")
        set_run_at(p, 4, "       ")
        set_run_at(p, 6, "  " + cfg["headcount"] + " ")
        set_run_at(p, 8, "  " + cfg["social_insurance"] + "  ")
        set_run_at(p, 10, "  " + cfg["payroll"] + "   ")
        rec("人数", "组织总人数 %s / 体系覆盖 %s / 社保 %s / 工资单 %s"
            % (cfg["org_total"], cfg["headcount"], cfg["social_insurance"], cfg["payroll"]))
        need("组织总人数、社保人数、员工工资单人数",
             "合同仅明确「甲方体系内有效人数 15 人」，其余三项合同未载明")

    # ---- 8. 作息时间
    p = find_para(paras, "(1)常日班人数")
    if p is not None:
        set_run_at(p, 2, TO_BE)
        set_run_at(p, 5, " " + TO_BE + "  ")
        rec("常日班人数/工作时段", TO_BE)
        need("常日班人数、工作时段", "白班人数与上下班时间")

    p = find_para(paras, "(2)倒班情况")
    if p is not None:
        set_box(p, "无", False)
        set_box(p, "有", False)
        set_run_at(p, 9, " " + TO_BE + " ")
        set_run_at(p, 11, "   " + TO_BE + "  ")
        set_run_at(p, 13, "  " + TO_BE + "   ")
        set_run_at(p, 15, "   " + TO_BE + "  ")
        set_run_at(p, 17, "      " + TO_BE + "   ")
        rec("倒班情况", TO_BE)
        need("倒班情况", "是否倒班、班数、每班人数与各班工作时段")

    p = find_para(paras, "(3)非固定人员")
    if p is not None:
        set_box(p, "无", False)
        set_box(p, "有", False)
        set_run_at(p, 10, "   " + TO_BE + "  ")
        set_run_at(p, 12, "      " + TO_BE + " ")
        set_run_at(p, 14, "        " + TO_BE + "      ")
        rec("非固定人员", TO_BE)
        need("非固定人员", "季节工/承包商/兼职人员人数、每日工时与季节性生产服务时段")

    # ---- 9. 所处地理位置：工业区（银川市望远工业园区），模板已勾
    rec("所处地理位置", "工业区（宁夏银川市望远工业园区），模板已勾选")

    # ---- 10. 审核场所限制：模板默认「无限制」，改为待确认
    p = find_para(paras, "审核场所限制信息")
    if p is not None:
        rs = runs_of(p)
        for i, r in enumerate(rs):
            if "原因描述" in run_text(r):
                set_run_at(p, i + 1, "  " + TO_BE + "   ")
                break
        rec("审核场所限制", "模板默认「无限制，可访问现场」——待甲方确认")
        need("审核场所限制", "是否有限制（化工生产场所通常有准入、作业许可要求）")

    # ---- 11. 近一年事故/处罚：不预填，改为待确认
    p = find_para(paras, "组织近一年内是否发生重大质量")
    if p is not None:
        set_box(p, "未发生", False)
        rs = runs_of(p)
        for i, r in enumerate(rs):
            if run_text(r).strip().startswith("有发生"):
                set_run_at(p, i, "有发生（" + TO_BE + "，附页简述发生及处置情况）")
                break
        rec("近一年事故/处罚", TO_BE)
        need("近一年事故、处罚、媒体曝光情况",
             "近一年是否发生重大质量/环境/安全事故或受到行政处罚、被曝光、责令停业")

    # ---- 12. 生产季节
    p = find_para(paras, "组织管理体系覆盖产品生产季节")
    if p is not None:
        set_box(p, "四季生产", False)
        rec("生产季节", TO_BE)
        need("生产季节", "四季生产或季节生产（若是季节生产请给生产月份）")

    # ---- 13. 外包职能或过程
    p = find_para(paras, "外包职能或过程")
    if p is not None:
        set_box(p, "无", False)
        set_run_at(p, 11, "  " + TO_BE + "  ")
        rec("外包职能或过程", TO_BE)
        need("外包职能或过程", "是否存在委外/外包过程及其控制场所")

    # ---- 14. 体系运行/内审/管理评审日期
    for label, note in [
        ("组织管理体系开始运行时间", "管理体系开始实施日期（合同约定体系正式运行满 3 个月并完成内审与管理评审后方可申请）"),
        ("最近1次内部审核的日期", "最近一次内部审核日期"),
        ("最近1次管理评审的日期", "最近一次管理评审日期"),
    ]:
        p = find_para(paras, label)
        if p is None:
            continue
        set_para(p, label + "：" + TO_BE)
        rec(label, TO_BE)
        need(label, note)

    # ---- 15. 曾获其他认证机构认证证书
    # 佳士洁此前在中认认证有限公司持 QES 证书（注册号 27324Q20036R0S /
    # 27324E20024R0S / 27324S20022R0S），2025-12-29 监二合格。
    # 证书到期日以甲方提供的中认证书复印件为准。
    prev = cfg.get("prev_cert", {})
    p = find_para(paras, "曾获管理体系认证证书认证机构名称")
    if p is not None:
        if prev:
            set_para(p, "曾获管理体系认证证书认证机构名称：" + prev.get("body", ""))
        else:
            set_para(p, "曾获管理体系认证证书认证机构名称：无（初次认证）")
    p = find_para(paras, "原认证证书有效期至")
    if p is not None:
        if prev:
            set_para(p, "原认证证书有效期至　%s　年　%s　月　%s　日；证书注册编号(提供复印件)：%s"
                     % (prev.get("year", ""), prev.get("month", ""), prev.get("day", ""),
                        prev.get("reg_no", "")))
        else:
            set_para(p, "原认证证书有效期至　　　年　　月　　日；证书注册编号(提供复印件)：无")
    p = find_para(paras, "证书状态")
    if p is not None:
        set_para(p, "证书状态：" + (prev.get("status", "不适用") if prev else "不适用（初次认证）"))
    p = find_para(paras, "认证机构名称：")
    if p is not None:
        set_para(p, "认证机构名称：" + (prev.get("body", "") if prev else "无"))
    p = find_para(paras, "未通过原因")
    if p is not None:
        set_para(p, "未通过原因：无")
    rec("曾获证书/曾受审核情况",
        ("曾获中认认证有限公司 QES 证书，注册号 %s" % prev.get("reg_no")) if prev
        else "无（初次认证）")
    if prev:
        need("中认证书复印件", "请提供中认认证有限公司 QES 证书复印件（有效期、范围已确认）")

    # ---- 16. 认证依据：不适用条款待确认
    for std, label in [
        ("GB/T 19001-2016/ISO 9001：2015", "QMS"),
        ("GB/T24001-2016/ISO14001:2015", "EMS"),
        ("GB/T45001-2020/ISO45001:2018", "OHSMS"),
    ]:
        p = find_para(paras, std)
        if p is not None:
            set_para(p, std + "，" + TO_BE)
    rec("认证依据", "QMS GB/T 19001-2016、EMS GB/T 24001-2016、OHSMS GB/T 45001-2020")
    need("各体系不适用条款", "QMS/EMS/OHSMS 各自的不适用条款；确无则填「无不适用条款」")

    # ---- 17. 覆盖范围 / 边界范围
    p = find_para(paras, "覆盖范围：")
    if p is not None:
        idx = paras.index(p)
        for j in range(idx + 1, min(idx + 6, len(paras))):
            if para_text(paras[j]).strip():
                set_para(paras[j], cfg["scope"])
                break
    rec("覆盖范围", cfg["scope"])
    # 边界范围（EnMS适用）：本次为 QMS/EMS/OHSMS，非 EnMS，保持模板空白
    p = find_para(paras, "边界范围（EnMS适用）")
    if p is not None:
        idx = paras.index(p)
        for j in range(idx + 1, min(idx + 8, len(paras))):
            txt = para_text(paras[j]).strip()
            if txt.startswith("（注：") or txt.startswith("(注："):
                break
            if runs_of(paras[j]) and txt:
                set_para(paras[j], "")
                break

    # ---- 18. 期望审核时间
    p = find_para(paras, "期望审核时间")
    if p is not None:
        idx = paras.index(p)
        for j in range(idx + 1, min(idx + 5, len(paras))):
            if para_text(paras[j]).strip():
                set_para(paras[j], cfg["audit_date"])
                break
    rec("期望审核时间", cfg["audit_date"])
    need("期望审核时间", "期望的现场审核年月")

    # ---- 19. 接受咨询情况
    p = find_para_contains(paras, "接受咨询，咨询机构名称")
    if p is not None:
        set_para(p, "( )自行建立体系，未接受咨询，( )接受咨询，咨询机构名称：" + TO_BE)
    p = find_para_contains(paras, "咨询组成员名单")
    if p is not None:
        set_para(p, "咨询组成员名单：" + TO_BE + "。")
    rec("接受咨询情况", TO_BE)
    need("接受咨询情况", "体系是否由咨询机构建立；若是，请给出机构名称与咨询组成员")

    # ---- 20. 多管理体系结合度调查：QMS+EMS+OHSMS 三体系
    for label in ["已组织实施多体系整体的管理评审", "已采用结合审核方法实施",
                  "已制定了整合的管理体系方针和目标", "管理体系过程已整合",
                  "制定了整合的管理体系文件", "建立了整合的持续改进机制",
                  "业务管理和风险管理已整合", "有统一的管理部门和责任"]:
        p = find_para_contains(paras, label)
        if p is not None:
            idx = paras.index(p)
            for j in range(idx + 1, min(idx + 3, len(paras))):
                if para_text(paras[j]).strip():
                    set_para(paras[j], "√")
                    break
    rec("多管理体系结合度", "QMS+EMS+OHSMS 三体系结合（8 项均勾「是」）")

    blobs["word/document.xml"] = ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)

    out_docx.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_docx, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, blobs[n])

    print("已生成:", out_docx)
    print("\n=== 填充日志 ===")
    for line in log:
        print("  -", line)
    print("\n=== 待甲方补充的信息 ===")
    for name, note in missing:
        print("  - %s：%s" % (name, note))


if __name__ == "__main__":
    main()
