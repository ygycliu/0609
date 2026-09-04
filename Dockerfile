# =============================================================================
# AI 数字化咨询中心 - Dockerfile
# 构建可复现的生产镜像，封装 Node.js 应用 + PostgreSQL/pgvector 客户端
# =============================================================================

# --- 阶段 1：构建前端 + 后端 ---
FROM node:20-bookworm-slim AS builder

# 启用 corepack 准备 pnpm（与项目 lock 文件无关，使用 npm workspaces）
ENV NODE_ENV=production
ENV CI=true

WORKDIR /app

# 仅复制 lock + package 以最大化缓存命中
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# 安装依赖（含 dev，因为需要 tsc / vite 构建）
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --include=dev

# 复制源码
COPY tsconfig.json ./
COPY apps ./apps

# 构建后端 (tsc → apps/server/dist) + 前端 (vite build → apps/web/dist)
RUN npm run build

# --- 阶段 2：生产运行时 ---
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

# 安装运行时系统依赖（curl 用于健康检查，pgvector 客户端需要的 postgres tools 在主机/容器内）
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system app \
 && useradd --system --gid app --home /app app

WORKDIR /app

# 仅复制生产 package.json 与锁文件
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/server/src ./apps/server/src

# 安装生产依赖（不带 dev）
RUN npm install --omit=dev --omit=optional \
 && npm cache clean --force \
 && chown -R app:app /app

# 数据 / 上传 / 模板挂载点
RUN mkdir -p /app/data/uploads /app/templates \
 && chown -R app:app /app/data /app/templates

# 在容器中允许的 cgroup 检查绕过：禁用 AI_CENTER_RUNTIME_OWNER=systemd 强校验
ENV AI_CENTER_RUNTIME_OWNER=docker

USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
