# syntax=docker/dockerfile:1

# ---- 构建阶段：安装依赖并编译前端 ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 优先使用官方预编译二进制；python3/make/g++ 作为源码编译兜底
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 仅在依赖清单变化时重装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && (npm ci || npm install)

# 复制源码并构建前端静态资源
COPY . .
RUN npm run build

# ---- 运行阶段：精简镜像，不含编译工具链 ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=8080 \
    SEED_SAMPLE=true \
    ROUTE_HORIZON_MINUTES=1440

# tini 负责信号转发，便于容器优雅停止
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

# 复制后端代码、已编译的生产依赖（含 better-sqlite3 原生模块）与前端构建产物
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY server ./server
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
# 启动即初始化：空库写入示例路网（已初始化则跳过），随后启动 Web 服务
CMD ["sh", "-c", "node server/initdb.js && node server/index.js"]
