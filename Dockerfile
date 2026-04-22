# Atelier - Dockerfile for containerized services
#
# Note: Backend and worker require native Node.js modules (node-pty, keytar)
# that are difficult to build in Docker. For local development, use:
#   docker compose up temporal postgres    # Start Temporal in Docker
#   make dev                             # Run backend + worker on host
#
# For full Docker support, see docker-compose.yml services.

FROM docker.io/oven/bun:1-debian AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# =====================
# BACKEND (requires native modules - run on host for best experience)
# =====================
FROM base AS backend
WORKDIR /app
COPY package.json bun.lock* ./
COPY backend ./backend
COPY frontend ./frontend
RUN bun install --frozen-lockfile
EXPOSE 3000 3001
CMD ["bun", "run", "--cwd", "backend", "src/index.ts"]

# =====================
# WORKER
# =====================
FROM base AS worker
WORKDIR /app
COPY worker/package.json worker/bun.lock* ./
COPY worker/src ./src
RUN bun install --frozen-lockfile
EXPOSE 7233
CMD ["bun", "run", "--cwd", "worker", "src/worker.ts"]