#!/usr/bin/env python3
"""
YoooClaw 录音自动扫描与导入

逻辑：
1. 调 `yoooclaw recording list` 获取录音列表
2. 对每条 status=transcribed 的录音
3. 读 transcripts/<id>_<title>.md
4. 读 summaries/<id>.md
5. 调 AI 中心 API：POST /api/yoooclaw/import-recording
6. 数据库去重（recording_id UNIQUE）

支持：定时任务每小时跑一次
"""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import urllib.request
import urllib.error

# === 配置 ===
API_BASE = "http://127.0.0.1:3001"
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"
COMPANY_ID = "00000000-0000-0000-0000-000000000001"

COOKIE_JAR = "/tmp/yoooclaw_scan_cookies.txt"

# === 工具函数 ===

def run_cli(*args, timeout=30):
    """执行 yoooclaw CLI 命令，返回 JSON"""
    try:
        result = subprocess.run(
            ["yoooclaw"] + list(args) + ["--format", "json"],
            capture_output=True, text=True, timeout=timeout
        )
        if result.returncode != 0:
            print(f"  ⚠️ CLI 错误: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ CLI 超时", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"  ⚠️ JSON 解析失败: {e}", file=sys.stderr)
        return None

def login():
    """登录获取 session cookie 值（不含 key=）"""
    cookie_path = Path(COOKIE_JAR)
    if cookie_path.exists():
        age = time.time() - cookie_path.stat().st_mtime
        if age < 23 * 3600:
            # 读出 cookie value
            with open(cookie_path) as f:
                line = f.read().strip()
                if "ai_center_session=" in line:
                    return line.split("ai_center_session=", 1)[1]

    url = f"{API_BASE}/api/auth/login"
    data = json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                # 保存 session cookie
                set_cookies = resp.headers.get_all("Set-Cookie") or []
                session_cookie = None
                for sc in set_cookies:
                    if "ai_center_session=" in sc:
                        session_cookie = sc.split(";")[0]
                        break
                if session_cookie:
                    with open(COOKIE_JAR, "w") as f:
                        f.write(session_cookie)
                return COOKIE_JAR
    except Exception as e:
        print(f"  ❌ 登录失败: {e}", file=sys.stderr)
    return None

def post_api(path, data, cookie):
    """POST 到 AI 中心 API"""
    url = f"{API_BASE}{path}"
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST",
                                 headers={
                                     "Content-Type": "application/json",
                                     "Cookie": f"ai_center_session={cookie}" if not cookie.startswith("ai_center_session=") else cookie
                                 })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": True, "status": e.code, "body": body}
    except Exception as e:
        return {"error": True, "message": str(e)}

def find_transcript_file(recording_id, storage_path):
    """定位转写文件"""
    transcripts_dir = Path(storage_path) / "transcripts"
    if not transcripts_dir.exists():
        return None
    # 匹配 <id>_*.md
    for f in transcripts_dir.glob(f"{recording_id}_*.md"):
        return f
    return None

def find_summary_file(recording_id, storage_path):
    """定位摘要文件"""
    summaries_dir = Path(storage_path) / "summaries"
    if not summaries_dir.exists():
        return None
    matches = list(summaries_dir.glob(f"{recording_id}*"))
    return matches[0] if matches else None

def read_file_safe(path, max_size=200_000):
    """安全读取文件"""
    if not path or not path.exists():
        return None
    if path.stat().st_size > max_size:
        # 截断
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_size) + "\n\n[内容过长，已截断]"
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

# === 主流程 ===

def main():
    print("=" * 60)
    print(f"YoooClaw 扫描开始: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. 登录
    cookie = login()
    if not cookie:
        print("❌ 无法登录 API，扫描中止")
        return 1
    print(f"✅ 登录成功")

    # 2. 拿存储路径
    storage = run_cli("recording", "storage-path")
    if not storage or not storage.get("ok"):
        print("❌ 无法获取录音存储路径")
        return 1
    storage_path = storage["path"]
    print(f"📁 存储路径: {storage_path}")

    # 3. 列录音
    rec_list = run_cli("recording", "list")
    if not rec_list or not rec_list.get("ok"):
        print("❌ 无法列出录音")
        return 1
    recordings = rec_list.get("recordings", [])
    print(f"📋 总录音数: {len(recordings)}")

    # 4. 过滤已转写
    transcribed = [r for r in recordings if r.get("status") == "transcribed" and r.get("has_transcript")]
    print(f"✅ 已转写: {len(transcribed)}")

    if not transcribed:
        print("💡 没有新录音可处理")
        return 0

    # 5. 处理每条
    imported = 0
    skipped = 0
    failed = 0
    for rec in transcribed:
        rec_id = rec.get("id")
        rec_name = rec.get("name", "未命名")
        print(f"\n📼 处理: {rec_name} ({rec_id[:8]}...)")

        # 定位文件
        transcript_path = find_transcript_file(rec_id, storage_path)
        summary_path = find_summary_file(rec_id, storage_path)

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

        # 调用 AI 中心 API
        payload = {
            "recordingId": rec_id,
            "recordingName": rec_name,
            "transcript": transcript,
            "summary": summary or "",
            "durationSec": rec.get("duration_sec"),
            # 暂不指定 todos/followUps，等业务侧确认
            "todos": [],
            "followUps": []
        }

        result = post_api("/api/yoooclaw/import-recording", payload, cookie)

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
            print(f"  ✅ 导入成功: 知识 {summary_data.get('knowledge', 0)} | 待办 {summary_data.get('todo', 0)} | 跟进 {summary_data.get('follow_up', 0)}")
            imported += 1
        else:
            print(f"  ❌ 未知响应: {result}")
            failed += 1

        # 避免过快
        time.sleep(0.5)

    print("\n" + "=" * 60)
    print(f"📊 扫描完成: 导入 {imported} | 跳过 {skipped} | 失败 {failed}")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())