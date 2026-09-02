#!/bin/bash
# V2.1：证书预警日报 - 飞书推送（每日 09:00）
# 直接调 webhook，绕过 API 鉴权

set -e
export PGPASSWORD="f05de4efec73e486c116dff745db07e692186f05d567362b"

LOG="/tmp/cert-expiry-feishu.log"
echo "" >> "$LOG"
echo "============================================================" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始证书预警日报推送" >> "$LOG"

# 1. 读取 webhook URL
WEBHOOK_URL=$(cat /home/ygycliu/.hermes/secrets/feishu_webhook.txt 2>/dev/null | tr -d '\n')
if [ -z "$WEBHOOK_URL" ]; then
    echo "ERROR: FEISHU_WEBHOOK_URL 未配置" >> "$LOG"
    exit 1
fi

# 2. 获取统计（用子查询避免 count 列 名冲突）
SQL=$(cat <<'EOF'
SELECT t.urgency_level || ':' || t.cnt
FROM (
    SELECT urgency_level, COUNT(*) AS cnt
    FROM vw_certificate_expiry_alerts
    GROUP BY urgency_level
) t
ORDER BY 
    CASE t.urgency_level
        WHEN '已过期' THEN 1
        WHEN '再认证紧急' THEN 2
        WHEN '再认证预警' THEN 3
        WHEN '即将到期' THEN 4
        WHEN '正常' THEN 5
    END
EOF
)

STATS=$(psql -h 127.0.0.1 -U ai_consult -d ai_consult -t -A -c "$SQL")
echo "Stats: $STATS" >> "$LOG"

# 3. 解析（处理 0 张情况）
get_count() {
    local pattern="$1"
    local val=$(echo "$STATS" | grep -E "^${pattern}:" | cut -d: -f2)
    echo "${val:-0}"
}

EXPIRED=$(get_count "已过期")
RECERT_CRITICAL=$(get_count "再认证紧急")
RECERT_WARNING=$(get_count "再认证预警")
EXPIRING=$(get_count "即将到期")
NORMAL=$(get_count "正常")

# 4. 构造消息
TEXT="【AI 数字化认证中心】📊 证书预警日报
⏰ 今日数据（$(date '+%Y-%m-%d')）：
🔴 再认证紧急：${RECERT_CRITICAL} 张（30 天内）
🟠 再认证预警：${RECERT_WARNING} 张（91-180 天）
🟡 即将到期：${EXPIRING} 张（监督审核）
✅ 正常：${NORMAL} 张"

if [ "$EXPIRED" != "0" ]; then
    TEXT="$TEXT
⚫ 已过期：${EXPIRED} 张"
fi

TEXT="$TEXT

🔗 查看详情：http://103.117.123.100:8080/ai/?page=cert-expiry

【合同管理台账】每日自动推送（含合同关键词）"

echo "Text: $TEXT" >> "$LOG"

# 5. 调飞书 webhook
PAYLOAD=$(jq -n --arg text "$TEXT" '{msg_type: "text", content: {text: $text}}')
RESULT=$(curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

CODE=$(echo "$RESULT" | jq -r '.code // .StatusCode // "unknown"')
MSG=$(echo "$RESULT" | jq -r '.msg // .StatusMessage // ""')
MSG_ID=$(echo "$RESULT" | jq -r '.data.message_id // ""')

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 推送结果: code=$CODE msg=$MSG message_id=$MSG_ID" >> "$LOG"

if [ "$CODE" = "0" ]; then
    echo "✅ 飞书推送成功: $MSG_ID"
else
    echo "❌ 飞书推送失败: $MSG"
fi