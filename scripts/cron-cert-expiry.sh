#!/bin/bash
# 证书到期提醒 cron 任务
# 每天上午 9:00 执行，检查 180 天内到期的证书并创建 todo

set -e
export PATH="/usr/local/pgsql/bin:/usr/bin:/bin:$PATH"
export PGPASSWORD="f05de4efec73e486c116dff745db07e692186f05d567362b"

# 调用函数
psql -h 127.0.0.1 -U ai_consult -d ai_consult -c "
SELECT auto_create_cert_expiry_todos(
  180,
  '00000000-0000-0000-0000-000000000001'::uuid
) AS created_todos;
"

# 记录日志
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 证书到期提醒任务执行完成"