#!/bin/bash
# 代码审查备份脚本
# 创建完整源码包 + DB 备份 + Git bundle

set -e
BACKUP_DIR="/home/ygycliu/backups"
PROJECT_DIR="/opt/ai-consulting-center"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "================================================"
echo "  代码审查备份 - $TIMESTAMP"
echo "================================================"

# 1. 源码包（不含 node_modules / dist）
echo "[1/4] 备份源代码..."
tar --exclude='node_modules' --exclude='dist' --exclude='.git' --exclude='*.log' \
    -czf "$BACKUP_DIR/ai-consulting-center-src-${TIMESTAMP}.tar.gz" \
    -C "$(dirname $PROJECT_DIR)" "$(basename $PROJECT_DIR)"

# 2. DB schema
echo "[2/4] 备份数据库 schema..."
pg_dump -h 127.0.0.1 -U ai_consult -d ai_consult \
    --schema-only --no-owner --no-privileges \
    -f "$BACKUP_DIR/schema-${TIMESTAMP}.sql"

# 3. DB 数据（关键表）
echo "[3/4] 备份数据库数据..."
PGPASSWORD="f05de4efec73e486c116dff745db07e692186f05d567362b" \
pg_dump -h 127.0.0.1 -U ai_consult -d ai_consult \
    --data-only --no-owner --no-privileges \
    -t customer -t certification_project -t project_certificate \
    -t auditor_profile -t todo \
    -f "$BACKUP_DIR/data-${TIMESTAMP}.sql"

# 4. Git bundle
echo "[4/4] 打包 Git 历史..."
cd "$PROJECT_DIR"
git bundle create "$BACKUP_DIR/ai-consulting-center-${TIMESTAMP}.bundle" --all

echo ""
echo "================================================"
echo "  备份完成！"
echo "================================================"
ls -lh "$BACKUP_DIR" | tail -10