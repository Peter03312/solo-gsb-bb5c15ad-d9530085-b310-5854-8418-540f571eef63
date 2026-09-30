# 园区无障碍通行

面向园区访客的无障碍通行查询与路网维护系统。维护者以「草稿 → 整体发布」的方式版本化维护有向路网（节点 + 路段的通行分钟、台阶属性），并可登记临时封闭；访客按起点、终点、出发时刻与无台阶需求查询一条途中不等待、全程避开封闭的可行路线。

技术栈：**Node.js (Express) + React (Vite) + SQLite (better-sqlite3, WAL)**

## 一键启动（Docker Compose）

```bash
docker compose up --build
```

启动后访问：**http://localhost:3000**

- 首次启动自动建库建表，并写入示例园区路网（8 节点 / 18 路段，发布为版本 1）及一条演示封闭；
- SQLite 数据持久化在命名卷 `campus-data`（容器内 `/app/data`），重复启动不会重复初始化。

## 配置

| 环境变量  | 默认值      | 说明                     |
| --------- | ----------- | ------------------------ |
| `PORT`    | `3000`      | HTTP 服务端口            |
| `DATA_DIR`| `/app/data` | SQLite 数据库文件目录    |

修改端口映射可编辑 `docker-compose.yml` 中的 `ports`（如 `"8080:3000"`）。

## 本地开发（不用 Docker）

```bash
npm install                    # 后端依赖
npm --prefix client install    # 前端依赖
npm run build:client           # 构建前端到 client/dist
npm start                      # http://localhost:3000
```

前端热更新开发：另开终端 `npm --prefix client run dev`（Vite 端口 5173，已配置 `/api` 代理到 3000）。

## 功能与规则

### 路网维护（草稿 / 发布）

- 草稿可随时保存（`PUT /api/draft`），不影响线上查询；
- 「发布」将草稿整体校验并固化为新版本（`POST /api/publish`），以下情况拒绝发布并逐条列出原因：
  - 路段的起点或终点在草稿节点中不存在；
  - 路段通行分钟非正数；
  - 草稿删除了**尚有未结束封闭**的路段；
- 每次发布生成完整的新版本快照，**旧版本永久保留、可继续查询**。

### 临时封闭

- 以「路段 + 起止时刻」登记（`POST /api/closures`），登记成功即刻对后续查询生效；
- 路段须存在于最新发布版本；开始时刻必须早于结束时刻。

### 访客路线查询

`GET /api/route?from=&to=&depart=&stepFree=&version=`

- `depart` 为 ISO 8601 出发时刻；`stepFree=true` 时全程避开含台阶路段；`version` 缺省用最新版本，可指定历史版本；
- 返回一条**途中不等待**的路线：到达节点立即进入下一路段，且每段通行的**整个时间区间**都与该路段所有封闭区间不相交（通行区间跨过封闭起点同样不可行）；
- 响应包含逐路段进出时刻、总到达时刻与所用**路网版本号**；
- 失败时给出具体原因：
  - `INVALID_TIME` 出发时刻无法解析；
  - `UNKNOWN_NODE` 起点/终点在该版本中不存在；
  - `NO_ROUTE` 该出发时刻下无可行路线（不连通或被封闭截断）；
  - `VERSION_NOT_FOUND` / `NO_VERSION` 指定的版本不存在或尚未发布。

### 并发一致性

- SQLite 开启 WAL，发布（写）与查询（读）均在事务内执行：查询把「版本内容 + 封闭列表」放在**同一事务快照**中读取，并发发布提交时，进行中的查询仍看到完整的旧版本与一致的封闭快照；发布本身校验与落库在同一事务，版本要么完整出现、要么不出现。

## API 一览

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET  | `/api/draft` | 读取草稿 |
| PUT  | `/api/draft` | 整体替换草稿 `{nodes, segments}` |
| POST | `/api/publish` | 校验并发布草稿为新版本 |
| GET  | `/api/versions` | 版本列表 |
| GET  | `/api/versions/:id` | 版本详情（节点 + 路段） |
| POST | `/api/closures` | 登记封闭 `{segmentId, start, end, note}` |
| GET  | `/api/closures` | 封闭列表（含是否未结束） |
| GET  | `/api/route` | 访客路线查询 |

## 目录结构

```
├── Dockerfile             # 多阶段：前端构建 → 后端依赖 → 运行时（含数据初始化）
├── docker-compose.yml     # 一键启动
├── package.json           # 后端（Express + better-sqlite3）
├── server/
│   ├── index.js           # HTTP API 与静态托管
│   ├── db.js              # schema、事务、初始数据
│   └── route.js           # 时变最短路（不等待、全程避开封闭）
└── client/                # React + Vite 前端
    └── src/pages/         # 路线查询 / 路网维护 / 临时封闭 / 历史版本
```
