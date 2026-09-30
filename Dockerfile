# ---------- 阶段 1：构建前端 ----------
FROM node:20 AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---------- 阶段 2：安装后端生产依赖 ----------
FROM node:20 AS server-deps
WORKDIR /build
COPY package.json package-lock.json* ./
# better-sqlite3 为原生模块：优先使用预编译二进制，失败时 node-gyp 源码编译
# （node:20 镜像已自带 python3 / make / g++）
RUN npm install --omit=dev

# ---------- 阶段 3：运行时 ----------
FROM node:20
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app

COPY --from=server-deps /build/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY --from=client-build /build/client/dist ./client/dist

# SQLite 数据目录（可挂载卷持久化）；数据库 schema 与初始路网在首次启动时自动初始化
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
