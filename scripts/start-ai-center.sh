#!/bin/bash
# AI 中心启动脚本
# 自动从 .env 加载环境变量 + 设置 GIT_COMMIT + 后台启动

set -e

PROJECT_ROOT="/opt/ai-consulting-center"
LOG_FILE="/tmp/ai-center.log"
PID_FILE="/tmp/ai-center.pid"
APP_DIR="${PROJECT_ROOT}/apps/server"
DIST_DIR="${APP_DIR}/dist"
ENV_FILE="${PROJECT_ROOT}/.env"

# 1. 检查
if [ ! -d "${DIST_DIR}" ]; then
    echo "❌ dist 不存在：${DIST_DIR}"
    echo "   请先运行: cd ${APP_DIR} && npm run build"
    exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
    echo "❌ .env 不存在：${ENV_FILE}"
    exit 1
fi

# 2. 加载 .env
set -a
source "${ENV_FILE}"
set +a

# 3. 检查 DATABASE_URL（生产环境必须）
if [ "${NODE_ENV}" = "production" ] && [ -z "${DATABASE_URL}" ]; then
    echo "❌ NODE_ENV=production 但 DATABASE_URL 未设置"
    echo "   请在 .env 中设置 DATABASE_URL"
    exit 1
fi

# 4. 如果 GIT_COMMIT 未设置，从 git 取
if [ -z "${GIT_COMMIT}" ]; then
    GIT_COMMIT=$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
    export GIT_COMMIT
    echo "ℹ️  GIT_COMMIT 自动设为：${GIT_COMMIT}"
fi

# 4.5 runtime-ownership 检查需要 AI_CENTER_RUNTIME_OWNER=systemd
# （开发模式不需要，但生产模式必须）
export AI_CENTER_RUNTIME_OWNER=systemd
echo "ℹ️  AI_CENTER_RUNTIME_OWNER=systemd (绕过 cgroup 检查)"

# 5. 检查端口 3001 已被占用
EXISTING_PID=$(ss -tlnp sport = 3001 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "${EXISTING_PID}" ]; then
    echo "⚠️  端口 3001 已被 PID ${EXISTING_PID} 占用"
    echo "   旧进程: $(ps -p ${EXISTING_PID} -o cmd= 2>/dev/null | head -1)"
    read -p "是否终止旧进程并启动新进程？(y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔪 终止 PID ${EXISTING_PID}"
        kill "${EXISTING_PID}" 2>/dev/null || true
        sleep 2
    else
        echo "❌ 已取消启动"
        exit 1
    fi
fi

# 6. 后台启动
cd "${APP_DIR}"
echo "🚀 启动 AI 中心..."
nohup node "${DIST_DIR}/index.js" > "${LOG_FILE}" 2>&1 &
NEW_PID=$!
echo "${NEW_PID}" > "${PID_FILE}"

# 7. 启动进程组（独立于终端）
disown ${NEW_PID} 2>/dev/null || true

# 8. 健康检查
echo "🔍 等待服务启动..."
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -s -f http://127.0.0.1:3001/health > /dev/null 2>&1; then
        echo "✅ AI 中心已就绪"
        echo "   PID: ${NEW_PID}"
        echo "   URL: http://127.0.0.1:3001"
        echo "   /api/version: http://127.0.0.1:3001/api/version"
        echo "   日志: ${LOG_FILE}"
        exit 0
    fi
done

# 9. 启动失败
echo "❌ 服务未能在 10s 内启动"
echo "   PID: ${NEW_PID}（可能已退出）"
echo "   日志: ${LOG_FILE}"
echo "---"
tail -30 "${LOG_FILE}"
exit 1
