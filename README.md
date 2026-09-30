# ♿ 园区无障碍通行 Web 应用

Node.js（Express + better-sqlite3）+ React（Vite）+ SQLite 实现。维护者维护园区节点与有向路段、登记临时封闭并整体发布路网版本；访客按起终点、出发时刻与无台阶需求查询一条**途中不等待、每段通行全程避开封闭**的可行路线。

## 功能总览

### 维护者
- **草稿编辑 → 整体发布**：节点、有向路段的通行分钟（正整数）与台阶属性（含/无台阶）先在草稿中编辑，校验通过后一键整体发布为新版本。
- **发布校验**：端点不存在、自环、重复路段、通行分钟非正 → 拒绝发布（草稿校验失败时不会产生新版本）。
- **封闭保护**：新版本不得删除任何“尚有未结束封闭”的有向路段，否则拒绝发布（HTTP 409，返回具体路段）。
- **临时封闭登记**：按 `有向路段 + 起止时刻` 登记；登记成功后查询立即生效；结束时刻必须晚于开始时刻；与同路段未结束封闭重叠会被拒绝；可删除误登记记录。
- **旧版可查**：每次发布生成不可变版本（v1、v2…），访客可指定历史版本查询。

### 访客
- 输入起点、终点、出发时刻（浏览器本地时区输入，按 UTC 存储与计算）、是否要求无台阶。
- 返回：一条可行路线（每段出发/到达时刻、用时、台阶属性）、**到达时刻、全程用时、路网版本号及发布时间**。
- 明确报错：
  - 未知起点/终点 → `UNKNOWN_NODE`（404，附当前查询版本）
  - 出发/封闭时刻无法解析或结束不晚于开始 → `INVALID_TIME`（400/422）
  - 时间窗内无满足约束的路线 → `NO_ROUTE`（422，说明约束原因）

### 关键语义
- **时间模型**：所有时刻存为 epoch 分钟（整数）。封闭为半开区间 `[start, end)`，封闭结束当刻即可进入路段。
- **途中不等待**：路线到达中间节点后必须立即进入下一路段，不允许“等到封闭结束再走”。
  因此寻路采用**多标签时间相关 Dijkstra**（同一节点保留多个不同到达时刻标签）——更早到达的标签无法等待，更晚到达反而可能通过封闭。
- **全程避开封闭**：对每条候选边，其通行区间 `[进入时刻, 离开时刻)` 不得与该边任一封闭区间重叠。
- **并发一致性**：
  - 发布与封闭登记使用 SQLite `BEGIN IMMEDIATE` 写事务，自动串行化，版本号严格连续；
  - 访客查询在单个只读事务中同时读取“指定版本路网 + 封闭区间”，得到**一致快照**，不会读到半个版本或新旧封闭混杂。

## 一键启动（Docker Compose）

前置：安装 Docker（含 Compose v2 插件）。

```bash
# 在项目根目录
docker compose up -d --build
```

启动完成后访问：

- **应用地址**：<http://localhost:8080>
- 健康检查：<http://localhost:8080/api/health>

数据持久化在 Docker 命名卷 `park-data`（容器内 `/app/data/access.db`）。首次启动空库会自动建表并写入一个示例园区路网（v1）。

常用命令：

```bash
docker compose logs -f        # 查看日志
docker compose down           # 停止（保留数据卷）
docker compose down -v        # 停止并删除数据卷（下次启动重新初始化示例数据）
docker compose restart web    # 重启
```

## 本地开发（不用 Docker）

需要 Node.js ≥ 20。better-sqlite3 通常直接下载预编译二进制；若环境无法下载而回退源码编译，需要 Python3、make、g++。

```bash
# 1) 安装依赖（根目录后端 + frontend 前端）
npm install
npm --prefix frontend install

# 2) 初始化数据库（默认 ./data/access.db；重复执行安全）
npm run initdb          # 已有数据时跳过；加 --force 可重置为示例数据

# 3a) 启动后端（:8080，托管 frontend/dist 静态资源；需先构建前端）
npm run build
npm start

# 3b) 或前后端分离热更新开发：
npm run dev:server      # 后端 :8080（node --watch）
npm run dev:web         # 前端 :5173，/api 自动代理到 127.0.0.1:8080
# 开发模式访问 http://localhost:5173
```

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 后端监听端口（容器内） |
| `DATA_DIR` | `./data`（相对项目根） | SQLite 文件存放目录，需可写 |
| `SQLITE_PATH` | `$DATA_DIR/access.db` | SQLite 数据库文件完整路径 |
| `SEED_SAMPLE` | `true` | 启动时空库是否写入示例路网；设为 `false` 则只建表不写数据 |
| `ROUTE_HORIZON_MINUTES` | `1440` | 寻路搜索时间窗（出发后多少分钟内必须到达），超出仍无路则报无路线 |
| `WEB_PORT` | `8080` | **仅 compose 使用**：宿主机映射端口（见 `.env.example`） |
| `TZ` | compose 中为 `Asia/Shanghai` | 容器时区（影响日志；业务时刻以 UTC 存储） |

修改宿主机端口示例：

```bash
echo 'WEB_PORT=9090' > .env
docker compose up -d --build   # 访问 http://localhost:9090
```

## HTTP API 摘要

所有时间参数接受 ISO8601（如 `2026-10-01T08:30`、`2026-10-01 08:30` 或带 `Z`/`+08:00`）或非负整数 epoch 分钟。无时区后缀的日期时间按 **UTC** 解析。

| 方法 & 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 服务健康与最新版本 |
| `GET /api/draft` / `PUT /api/draft` | 读取 / 整体替换草稿（先校验后落库，失败不改动草稿） |
| `POST /api/draft/nodes`、`DELETE /api/draft/nodes/:id` | 草稿节点增删 |
| `PUT /api/draft/edges`、`DELETE /api/draft/edges/:from/:to` | 草稿路段增删改 |
| `POST /api/publish` | 草稿整体发布为新版本（含封闭保护） |
| `GET /api/versions`、`GET /api/versions/:v` | 版本列表 / 指定版本完整路网（旧版可查） |
| `GET /api/network/latest` | 最新版本完整路网 |
| `POST /api/closures` | 登记临时封闭 `{from,to,start,end,reason?}` |
| `GET /api/closures` | 封闭列表（支持 `?active_at=...` 过滤进行中） |
| `DELETE /api/closures/:id` | 删除封闭记录（撤销误登记） |
| `GET /api/route?from&to&departure&no_steps=true&version=&horizon_minutes=` | 访客寻路 |

示例：

```bash
# 登记封闭
curl -X POST http://localhost:8080/api/closures \
  -H 'Content-Type: application/json' \
  -d '{"from":"SQUARE","to":"RAMPS","start":"2026-10-01T08:05","end":"2026-10-01T08:10","reason":"坡道养护"}'

# 无台阶寻路
curl 'http://localhost:8080/api/route?from=SQUARE&to=VIEW&departure=2026-10-01T08:00&no_steps=true'

# 查询历史版本
curl 'http://localhost:8080/api/route?from=SQUARE&to=VIEW&departure=2026-10-01T08:00&no_steps=true&version=1'
```

错误响应统一为：

```json
{ "error": "错误码", "message": "中文原因", "details": { } }
```

## 示例路网

`server/seed.js` 内置 18 个节点、34 条有向路段的园区示例（门区、广场、报告厅、图书馆、食堂、宿舍、医务室、停车场、体育馆、景观桥、山顶观景台等），其中：

- `STAIRS_LK -> VIEW` 是含台阶近路（6 分钟）；
- `SQUARE -> RAMPS -> VIEW` 是无台阶绕行（7 + 9 分钟）。

可直接在界面中体验：要求无台阶时自动绕行；封闭坡道段时，不允许等待的路线会先通过其他路径“消耗时间”再在封闭结束后进入坡道，或在无法满足时给出无路线原因。

## 项目结构

```
.
├── Dockerfile              # 多阶段构建（builder 编译前端，runtime 精简运行）
├── docker-compose.yml      # 一键启动 + 数据卷 + 健康检查
├── package.json            # 后端依赖与脚本
├── server/
│   ├── db.js               # SQLite 连接、pragma 与建表 schema
│   ├── initdb.js           # 数据初始化（建表 + 示例路网，可重复执行）
│   ├── seed.js             # 示例园区数据
│   ├── routing.js          # 多标签时间相关 Dijkstra（不等待/全程避封闭）
│   ├── util.js             # 时间解析、校验、错误类型
│   └── index.js            # Express 路由与事务边界
├── frontend/               # React + Vite SPA
│   └── src/components/     # Visitor / DraftEditor / Closures 三个页面
└── test/concurrency.mjs    # 并发发布/查询/封闭一致性测试
```

## 一致性测试

```bash
# 先启动服务（默认 :8080），然后：
node test/concurrency.mjs
```

测试并发交错执行 15 次发布、20 次封闭登记与 240 次寻路，断言：版本号连续、每条结果的路段都属于所返回版本、腿链时间连续（无等待）、任何行程区间都不穿过封闭、旧版本不被破坏，且全程无 5xx / 数据库忙错误。
