#!/usr/bin/env python3
"""
YoooClaw 录音自动扫描与导入（增强版）

逻辑：
1. 调 `yoooclaw recording list` 获取录音列表
2. 调 /api/customers/names 拿所有客户名
3. 对每条 status=transcribed 的录音：
   a. 读 transcripts/<id>_<title>.md
   b. 读 summaries/<id>.md
   c. 匹配客户名（精确 + 子串）
   d. 智能生成 todos / followUps
   e. POST /api/yoooclaw/import-recording
4. DB 去重（recording_id UNIQUE）

支持：cron 每天 12:00 + 20:00
"""
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib import request as urlrequest
from urllib.error import HTTPError

API_BASE = "http://127.0.0.1:3001"
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"
COMPANY_ID = "00000000-0000-0000-0000-000000000001"
COOKIE_JAR = "/tmp/yoooclaw_scan_cookies.txt"

# 匹配强度阈值（必须 >= 2 个 token 命中，或 1 个长匹配）
MIN_MATCH_CHARS = 4
MIN_TOKENS = 1


# === CLI 调用 ===

def run_cli(*args, timeout=30):
    """执行 yoooclaw CLI"""
    try:
        result = subprocess.run(
            ["yoooclaw"] + list(args) + ["--format", "json"],
            capture_output=True, text=True, timeout=timeout
        )
        if result.returncode != 0:
            print(f"  ⚠️ CLI 错误: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"  ⚠️ CLI 异常: {e}", file=sys.stderr)
        return None


# === API 调用 ===

def login():
    """登录获取 session"""
    cookie_path = Path(COOKIE_JAR)
    if cookie_path.exists():
        age = time.time() - cookie_path.stat().st_mtime
        if age < 23 * 3600:
            with open(cookie_path) as f:
                line = f.read().strip()
                if "ai_center_session=" in line:
                    return line.split("ai_center_session=", 1)[1]

    url = f"{API_BASE}/api/auth/login"
    data = json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode()
    req = urlrequest.Request(url, data=data, method="POST",
                              headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                set_cookies = resp.headers.get_all("Set-Cookie") or []
                for sc in set_cookies:
                    if "ai_center_session=" in sc:
                        session_cookie = sc.split(";")[0]
                        with open(COOKIE_JAR, "w") as f:
                            f.write(session_cookie)
                        return session_cookie.split("=", 1)[1]
    except Exception as e:
        print(f"  ❌ 登录失败: {e}", file=sys.stderr)
    return None


def api_get(path, cookie):
    """GET"""
    url = f"{API_BASE}{path}"
    req = urlrequest.Request(url, headers={"Cookie": f"ai_center_session={cookie}"})
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        return {"error": True, "status": e.code, "body": e.read().decode()[:300]}
    except Exception as e:
        return {"error": True, "message": str(e)}


def api_post(path, data, cookie):
    """POST"""
    url = f"{API_BASE}{path}"
    payload = json.dumps(data).encode("utf-8")
    req = urlrequest.Request(url, data=payload, method="POST",
                              headers={
                                  "Content-Type": "application/json",
                                  "Cookie": f"ai_center_session={cookie}"
                              })
    try:
        with urlrequest.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        return {"error": True, "status": e.code, "body": e.read().decode()[:300]}
    except Exception as e:
        return {"error": True, "message": str(e)}


# === 文件查找 ===

def find_files(recording_id, storage_path):
    """定位转写和摘要文件"""
    transcripts_dir = Path(storage_path) / "transcripts"
    summaries_dir = Path(storage_path) / "summaries"

    transcript_path = None
    for f in transcripts_dir.glob(f"{recording_id}_*.md"):
        transcript_path = f
        break

    summary_matches = list(summaries_dir.glob(f"{recording_id}*"))
    summary_path = summary_matches[0] if summary_matches else None

    return transcript_path, summary_path


def read_file_safe(path, max_size=200_000):
    if not path or not path.exists():
        return None
    if path.stat().st_size > max_size:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_size) + "\n\n[内容过长，已截断]"
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


# === 客户名匹配（核心） ===

def normalize_name(name):
    """规范化客户名用于匹配：去括号/后缀"""
    core = name.strip()
    # 去全/半括号包裹
    core = re.sub(r"^[（(](.+)[）)]$", r"\1", core)
    return core.strip()


def match_customers(text, customers):
    """
    在文本中匹配客户名

    匹配规则：
    1. 完整名出现（按规范化）
    2. 核心名出现（去"有限公司"等后缀后）
    3. 简称（前 4+ 个字符）

    返回：[(customerId, customerName, matched_name), ...]
    """
    if not text or not customers:
        return []

    matches = []

    # 排除：纯年份、数字、月份
    year_pattern = re.compile(r"(19|20)\d{2}\s*年?")

    for cust in customers:
        cust_name = cust["name"]
        cust_id = cust["id"]
        norm = normalize_name(cust_name)

        # 过滤无效客户名
        if not norm or len(norm) < 4:
            continue
        # 排除纯年份
        if year_pattern.fullmatch(norm):
            continue
        # 排除纯数字
        if norm.replace("年", "").isdigit():
            continue
        # 排除月份（如 "1月" "12月"）
        if re.match(r"^\d{1,2}月$", norm):
            continue
        # 排除日期（如 "2024-01" "2024-12-31"）
        if re.match(r"^\d{4}[-/]\d{1,2}", norm):
            continue
        # 排除单字符/纯中文标点
        if re.match(r"^[\W_]+$", norm):
            continue

        text_lower = text

        # 1. 完整匹配（规范化后）
        if norm in text_lower:
            matches.append((cust_id, cust_name, norm))
            continue

        # 2. 去后缀的核心名匹配
        core = norm
        for suffix in ["有限责任公司", "股份有限公司", "有限公司", "股份公司", "公司", "集团"]:
            if core.endswith(suffix):
                core = core[:-len(suffix)]
                break
        if core and len(core) >= MIN_MATCH_CHARS and core in text_lower:
            matches.append((cust_id, cust_name, core))
            continue

        # 3. 简称（取前 8 个字符）
        if len(norm) >= 8 and norm[:8] in text_lower:
            prefix = norm[:8]
            if re.search(rf"{re.escape(prefix)}[一-龥]?[\s。，,]", text_lower):
                matches.append((cust_id, cust_name, prefix))

    # 去重（同一客户只保留一次）
    seen = set()
    unique = []
    for cid, name, _ in matches:
        if cid not in seen:
            seen.add(cid)
            unique.append((cid, name))
    return unique


# === 智能生成 todos / followUps ===

# 关键词触发
STAGE_KEYWORDS = {
    "quoted": ["报价", "已报", "价格", "费用", "多少钱", "报价单", "询价"],
    "contract_review": ["合同评审", "合同审", "审合同", "评审中"],
    "contract_signed": ["签合同", "已签", "合同签订", "签约"],
    "implementing": ["实施", "审核进行", "现场", "推进中", "在做"],
    "certified": ["出证", "发证", "证书", "下证"],
    "completed": ["完成", "结束", "通过"],
    "expired": ["到期", "过期", "续期", "快到期", "快到"]
}

PRIORITY_KEYWORDS = {
    "urgent": ["紧急", "马上", "立即", "ASAP", "今天", "必须"],
    "high": ["尽快", "本周", "重要", "催", "急"],
    "low": ["不急", "有空", "改天", "再说"]
}

ACTION_KEYWORDS = ["跟进", "联系", "回复", "确认", "催", "安排", "通知", "沟通", "拜访", "发送", "提供"]


def infer_stage(text):
    """根据文本推断跟进阶段"""
    text_lower = text.lower() if text else ""
    matches = []
    for stage, keywords in STAGE_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                matches.append((stage, kw))
                break
    # 优先级：contract_signed > contract_review > quoted > implementing > certified > completed > expired
    priority_order = ["contract_signed", "contract_review", "quoted", "implementing", "certified", "completed", "expired"]
    matched_stages = set(m[0] for m in matches)
    for stage in priority_order:
        if stage in matched_stages:
            return stage
    return None


def infer_priority(text):
    """根据文本推断优先级"""
    if not text:
        return "normal"
    for prio, keywords in PRIORITY_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                return prio
    return "normal"


def infer_action(text, customer_name):
    """推断需要做什么动作（生成 todo 标题）"""
    if not text:
        return f"跟进 {customer_name}"

    text_lower = text

    # 找到动作词
    actions = []
    for kw in ACTION_KEYWORDS:
        if kw in text_lower:
            actions.append(kw)

    if actions:
        return f"{actions[0]}{customer_name}"
    return f"跟进 {customer_name}"


def build_todo_and_followup(customer_id, customer_name, transcript, summary, recording_id):
    """根据客户 + 文本生成 todo 和 followUp"""
    full_text = (transcript or "") + "\n" + (summary or "")
    todos = []
    follow_ups = []

    # 提取金额（中文 + 数字，万元/百元等）
    # 排除 1900-2100 之间的纯数字（这些是年份）
    amounts = re.findall(r"(\d+(?:\.\d+)?)\s*[万千百]?", full_text)
    contract_amount = None
    for amt_str in amounts:
        try:
            amt = float(amt_str)
            if amt < 1900 or amt > 2100:  # 排除年份范围
                if 100 <= amt <= 10_000_000:  # 合理金额范围
                    contract_amount = amt
                    break
        except ValueError:
            pass

    # 推断阶段
    stage = infer_stage(full_text) or "expired"
    priority = infer_priority(full_text)

    # 生成 todo
    action = infer_action(full_text, customer_name)
    todos.append({
        "title": f"{action}（{customer_name}）",
        "description": f"来源：录音 {recording_id[:8]}。{summary[:200] if summary else '请查看完整转写'}",
        "priority": priority,
        "category": "follow_up",
        "customerName": customer_name
    })

    # 生成 followUp
    follow_up = {
        "customerName": customer_name,
        "stage": stage,
        "year": datetime.now().year,
        "issuingBody": "zhongren",  # 默认中认
        "summary": (summary or transcript)[:200]
    }
    if contract_amount:
        follow_up["contractAmount"] = contract_amount
    follow_ups.append(follow_up)

    return todos, follow_ups


# === 主流程 ===

def main():
    print("=" * 60)
    print(f"YoooClaw 扫描开始: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. 登录
    cookie = login()
    if not cookie:
        print("❌ 无法登录 API")
        return 1
    print("✅ 登录成功")

    # 2. 拿所有客户名（用于匹配）
    print("📋 获取客户列表...")
    cust_resp = api_get("/api/customers/names?limit=10000", cookie)
    if cust_resp.get("error"):
        print(f"❌ 拿客户列表失败: {cust_resp}")
        return 1
    customers = cust_resp.get("data", [])
    print(f"   共 {len(customers)} 个客户")

    # 3. 拿存储路径
    storage = run_cli("recording", "storage-path")
    if not storage or not storage.get("ok"):
        print("❌ 无法获取存储路径")
        return 1
    storage_path = storage["path"]
    print(f"📁 存储路径: {storage_path}")

    # 4. 列录音
    rec_list = run_cli("recording", "list")
    if not rec_list or not rec_list.get("ok"):
        print("❌ 无法列出录音")
        return 1
    recordings = rec_list.get("recordings", [])

    # 过滤
    transcribed = [r for r in recordings if r.get("status") == "transcribed" and r.get("has_transcript")]
    print(f"📼 总 {len(recordings)} 条，已转写 {len(transcribed)} 条")

    if not transcribed:
        print("💡 没有已转写录音")
        return 0

    # 5. 处理每条
    imported = 0
    skipped = 0
    failed = 0
    with_customers = 0

    for rec in transcribed:
        rec_id = rec.get("id")
        rec_name = rec.get("name", "未命名")
        print(f"\n📼 {rec_name} ({rec_id[:8]})")

        # 定位文件
        transcript_path, summary_path = find_files(rec_id, storage_path)
        if not transcript_path:
            print(f"  ⏭️ 转写文件不存在")
            skipped += 1
            continue

        transcript = read_file_safe(transcript_path)
        summary = read_file_safe(summary_path) if summary_path else None
        if not transcript or len(transcript.strip()) < 5:
            print(f"  ⏭️ 转写内容为空")
            skipped += 1
            continue

        # 🔍 匹配客户名
        full_text = (transcript or "") + "\n" + (summary or "")
        matched_customers = match_customers(full_text, customers)

        if matched_customers:
            with_customers += 1
            customer_names = [c[1] for c in matched_customers]
            print(f"  🎯 命中客户: {', '.join(customer_names)}")

        # 生成 todos / followUps
        todos = []
        follow_ups = []
        for cid, cname in matched_customers:
            t, f = build_todo_and_followup(cid, cname, transcript, summary, rec_id)
            todos.extend(t)
            follow_ups.extend(f)

        # 调用导入 API
        payload = {
            "recordingId": rec_id,
            "recordingName": rec_name,
            "transcript": transcript,
            "summary": summary or "",
            "durationSec": rec.get("duration_sec"),
            "todos": todos,
            "followUps": follow_ups
        }

        result = api_post("/api/yoooclaw/import-recording", payload, cookie)

        if result.get("error"):
            error_msg = result.get("body", result.get("message", "未知"))
            if "alreadyImported" in str(error_msg):
                print(f"  ⏭️ 已导入")
                skipped += 1
            else:
                print(f"  ❌ 失败: {str(error_msg)[:200]}")
                failed += 1
        elif result.get("data", {}).get("alreadyImported"):
            print(f"  ⏭️ 已导入")
            skipped += 1
        elif "data" in result:
            summary_data = result["data"].get("summary", {})
            extra = ""
            if matched_customers:
                extra = f" | 匹配 {len(matched_customers)} 客户"
            print(f"  ✅ 导入: 知识 {summary_data.get('knowledge', 0)} | 待办 {summary_data.get('todo', 0)} | 跟进 {summary_data.get('follow_up', 0)}{extra}")
            imported += 1
        else:
            print(f"  ❌ 未知响应: {result}")
            failed += 1

        time.sleep(0.5)

    print("\n" + "=" * 60)
    print(f"📊 扫描完成")
    print(f"   导入: {imported}")
    print(f"   跳过: {skipped}")
    print(f"   失败: {failed}")
    print(f"   命中客户: {with_customers} 条录音涉及客户")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())