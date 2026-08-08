#!/usr/bin/env sh
set -eu

if [ ! -f ".env" ]; then
  echo "缺少 .env，请先复制并编辑 .env.example"
  exit 1
fi

exec node apps/server/dist/index.js
