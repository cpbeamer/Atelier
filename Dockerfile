FROM oven/bun:1-alpine AS base
WORKDIR /app
RUN apk add --no-cache git openssl python3 make g++ python3-dev

# =====================
# FRONTEND
# =====================
FROM base AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

FROM base
WORKDIR /app
COPY --from=frontend-builder /app/dist ./dist
COPY --from=frontend-builder /app/node_modules ./node_modules
COPY frontend/index.html ./
COPY frontend/vite.config.ts ./
EXPOSE 5173
CMD ["bun", "run", "dev"]

# =====================
# BACKEND
# =====================
FROM base AS backend-builder
WORKDIR /app
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile
COPY backend/ ./
RUN bun build src/index.ts --outdir dist

FROM base
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY backend/ ./
EXPOSE 3000 3001
CMD ["bun", "run", "--cwd", ".", "dev"]

# =====================
# WORKER
# =====================
FROM base AS worker-builder
WORKDIR /app
COPY worker/package.json worker/bun.lock* ./
RUN bun install --frozen-lockfile
COPY worker/ ./
RUN bun build src/worker.ts --outdir dist

FROM base
WORKDIR /app
COPY --from=worker-builder /app/dist ./dist
COPY --from=worker-builder /app/node_modules ./node_modules
COPY worker/ ./
EXPOSE 7233
CMD ["bun", "run", "--cwd", ".", "start"]