#!/bin/bash
# AI 中心停止脚本

PID_FILE="/tmp/ai-center.pid"

if [ ! -f "${PID_FILE}" ]; then
    echo "❌ PID 文件不存在：${PID_FILE}"
    # 尝试从端口找
    EXISTING_PID=$(ss -tlnp sport = 3001 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -z "${EXISTING_PID}" ]; then
        echo "   3001 端口未监听，无需停止"
        exit 0
    else
        echo "   但 3001 端口由 PID ${EXISTING_PID} 占用"
        PID="${EXISTING_PID}"
    fi
else
    PID=$(cat "${PID_FILE}")
fi

if [ -z "${PID}" ] || ! kill -0 "${PID}" 2>/dev/null; then
    echo "❌ PID ${PID} 不存在"
    rm -f "${PID_FILE}" 2>/dev/null
    exit 1
fi

echo "🛑 停止 AI 中心 (PID: ${PID})"
kill "${PID}"
sleep 2

if kill -0 "${PID}" 2>/dev/null; then
    echo "   强制停止..."
    kill -9 "${PID}"
fi

rm -f "${PID_FILE}"
echo "✅ 已停止"
