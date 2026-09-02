#!/bin/bash
# V2.1：证书预警日报 - 飞书推送（每日 09:00）
# 通过 AI 中心 API 推送 + @ 提醒刘军

set -e
export PGPASSWORD="f05de4efec73e486c116dff745db07e692186f05d567362b"

LOG="/tmp/cert-expiry-feishu.log"
echo "" >> "$LOG"
echo "============================================================" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始证书预警日报推送" >> "$LOG"

# 1. 读取 webhook URL（备用）
WEBHOOK_URL=$(cat /home/ygycliu/.hermes/secrets/feishu_webhook.txt 2>/dev/null | tr -d '\n')

# 2. 获取统计（用子查询避免 count 列名冲突）
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

# 3. 解析
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

🔗 查看详情：http://103.117.123.100:8080/ai/?page=cert-expiry"

echo "Text: $TEXT" >> "$LOG"

# 5. 通过 API 推送（支持 @ 提醒）
# AI 中心 server 需在 3001 端口运行
API_BASE="http://127.0.0.1:3001"

# 5.1 登录拿 cookie
LOGIN_RESPONSE=$(curl -s -c /tmp/feishu-push-cookie.txt -X POST "$API_BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}')

# 5.2 构造 payload（含 @ 提醒刘军）
PAYLOAD=$(jq -n \
    --arg text "$TEXT" \
    --arg chatid "oc_d0af80dec67d88e0895315a92256bf69" \
    --arg atuser "ou_1a6aa7161fee50eb39c15ca5098030a4" \
    '{
        chatId: $chatid,
        content: {
            text: $text,
            atUserIds: [$atuser]
        }
    }')

# 5.3 推送
RESULT=$(curl -s -X POST "$API_BASE/api/feishu/notify" \
    -H "Content-Type: application/json" \
    -b /tmp/feishu-push-cookie.txt \
    -d "$PAYLOAD")

CODE=$(echo "$RESULT" | jq -r '.data.code // .data.error.code // "unknown"')
MSG=$(echo "$RESULT" | jq -r '.data.msg // .data.error.msg // ""')
MSG_ID=$(echo "$RESULT" | jq -r '.data.data.data.message_id // ""')

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 推送结果: code=$CODE msg=$MSG message_id=$MSG_ID" >> "$LOG"

if [ "$CODE" = "0" ]; then
    echo "✅ 飞书推送成功（@刘军）: $MSG_ID"
else
    echo "❌ 飞书推送失败: $MSG"
fi