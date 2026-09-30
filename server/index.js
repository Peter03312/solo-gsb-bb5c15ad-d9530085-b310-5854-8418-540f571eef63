import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { db } from './db.js';
import { initData } from './initdb.js';
import { findRoute, DEFAULT_HORIZON_MINUTES } from './routing.js';
import {
  ApiError,
  wrap,
  nowMinute,
  parseTime,
  fmtTime,
  validateNodeId,
  validateName,
  validateMinutes,
  validateHasSteps,
  overlaps
} from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const HORIZON_MINUTES = parseInt(process.env.ROUTE_HORIZON_MINUTES || String(DEFAULT_HORIZON_MINUTES), 10);

// ---------- 启动时初始化示例数据（空库才写；SEED_SAMPLE=false 可关闭） ----------
if (process.env.SEED_SAMPLE !== 'false') {
  initData(false);
}

// ---------- 预备语句 ----------
const q = {
  versions: db.prepare('SELECT * FROM network_versions ORDER BY version'),
  latestVersion: db.prepare('SELECT * FROM network_versions ORDER BY version DESC LIMIT 1'),
  versionById: db.prepare('SELECT * FROM network_versions WHERE version = ?'),
  vNodes: db.prepare('SELECT id, name FROM version_nodes WHERE version = ?'),
  vEdges: db.prepare(
    'SELECT edge_id, "from", "to", minutes, has_steps FROM version_edges WHERE version = ? ORDER BY edge_id'
  ),
  dNodes: db.prepare('SELECT id, name FROM draft_nodes ORDER BY id'),
  dEdges: db.prepare('SELECT edge_id, "from", "to", minutes, has_steps FROM draft_edges ORDER BY edge_id'),
  insDNode: db.prepare('INSERT INTO draft_nodes (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
  delDNode: db.prepare('DELETE FROM draft_nodes WHERE id = ?'),
  insDEdge: db.prepare(
    `INSERT INTO draft_edges ("from", "to", minutes, has_steps) VALUES (@from, @to, @minutes, @has_steps)
     ON CONFLICT("from", "to") DO UPDATE SET minutes = excluded.minutes, has_steps = excluded.has_steps`
  ),
  delDEdge: db.prepare('DELETE FROM draft_edges WHERE "from" = ? AND "to" = ?'),
  clearDNodes: db.prepare('DELETE FROM draft_nodes'),
  clearDEdges: db.prepare('DELETE FROM draft_edges'),
  clearDEdgeSeq: db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'draft_edges'`),
  activeClosureKeys: db.prepare('SELECT DISTINCT "from", "to" FROM closures WHERE end_time > ?'),
  closureByKey: db.prepare('SELECT id FROM closures WHERE "from" = ? AND "to" = ? LIMIT 1'),
  allClosures: db.prepare('SELECT * FROM closures ORDER BY start_time, id'),
  closureById: db.prepare('SELECT * FROM closures WHERE id = ?'),
  delClosure: db.prepare('DELETE FROM closures WHERE id = ?')
};

// ---------- 草稿整体校验 ----------
function validateNetwork(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ApiError('INVALID_NETWORK', '节点列表不能为空', 422);
  }
  if (!Array.isArray(edges)) {
    throw new ApiError('INVALID_NETWORK', '路段列表须为数组', 422);
  }
  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n !== 'object') throw new ApiError('INVALID_NODE', '节点格式非法');
    validateNodeId(n.id);
    if (ids.has(n.id)) throw new ApiError('INVALID_NODE', `节点标识重复：${n.id}`, 422);
    ids.add(n.id);
    validateName(n.name, n.id);
  }
  const pairs = new Set();
  for (const e of edges) {
    if (!e || typeof e !== 'object') throw new ApiError('INVALID_EDGE', '路段格式非法');
    validateNodeId(e.from);
    validateNodeId(e.to);
    if (e.from === e.to) throw new ApiError('INVALID_EDGE', `不允许自环路段：${e.from} -> ${e.to}`, 422);
    if (!ids.has(e.from)) throw new ApiError('INVALID_EDGE', `路段端点不存在：${e.from} -> ${e.to}`, 422);
    if (!ids.has(e.to)) throw new ApiError('INVALID_EDGE', `路段端点不存在：${e.from} -> ${e.to}`, 422);
    validateMinutes(e.minutes);
    validateHasSteps(e.has_steps);
    const key = e.from + '|' + e.to;
    if (pairs.has(key)) throw new ApiError('INVALID_EDGE', `重复的有向路段：${e.from} -> ${e.to}`, 422);
    pairs.add(key);
  }
  return { ids, pairs };
}

function readDraft() {
  return { nodes: q.dNodes.all(), edges: q.dEdges.all() };
}

// ---------- 发布 ----------
const publishTx = db.transaction(() => {
  const draft = readDraft();
  validateNetwork(draft.nodes, draft.edges);

  const now = nowMinute();
  const blocked = q.activeClosureKeys.all(now);
  const pairSet = new Set(draft.edges.map((e) => e.from + '|' + e.to));
  const missing = blocked
    .map((r) => ({ from: r.from, to: r.to }))
    .filter((r) => !pairSet.has(r.from + '|' + r.to));
  if (missing.length > 0) {
    throw new ApiError(
      'CLOSURE_ACTIVE',
      `发布被拒绝：以下路段仍有未结束封闭，新路网不得删除：${missing
        .map((m) => `${m.from}->${m.to}`)
        .join('、')}`,
      409,
      { active_on_missing_edges: missing }
    );
  }

  const latest = q.latestVersion.get();
  const info = db
    .prepare('INSERT INTO network_versions (published_at, note) VALUES (?, ?)')
    .run(now, `由草稿发布（上一版本 ${latest ? latest.version : '无'}）`);
  const version = Number(info.lastInsertRowid);

  const insNode = db.prepare('INSERT INTO version_nodes (version, id, name) VALUES (?, ?, ?)');
  const insEdge = db.prepare(
    'INSERT INTO version_edges (version, edge_id, "from", "to", minutes, has_steps) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const n of draft.nodes) insNode.run(version, n.id, n.name);
  draft.edges.forEach((e, i) =>
    insEdge.run(version, i + 1, e.from, e.to, e.minutes, e.has_steps ? 1 : 0)
  );
  const row = q.versionById.get(version);
  return { version, published_at: row.published_at, note: row.note };
});

// ---------- 应用 ----------
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const latest = q.latestVersion.get();
  res.json({ ok: true, latest_version: latest ? latest.version : null, time: fmtTime(nowMinute()) });
});

// ----- 草稿 -----
app.get('/api/draft', (req, res) => {
  res.json(readDraft());
});

app.put(
  '/api/draft',
  wrap((req, res) => {
    const { nodes, edges } = req.body || {};
    validateNetwork(nodes, edges);
    const tx = db.transaction(() => {
      q.clearDEdges.run();
      q.clearDNodes.run();
      q.clearDEdgeSeq.run();
      for (const n of nodes) q.insDNode.run(n.id, validateName(n.name, n.id));
      for (const e of edges)
        q.insDEdge.run({
          from: e.from,
          to: e.to,
          minutes: validateMinutes(e.minutes),
          has_steps: validateHasSteps(e.has_steps)
        });
    });
    tx.immediate();
    res.json(readDraft());
  })
);

app.post(
  '/api/draft/nodes',
  wrap((req, res) => {
    const { id, name } = req.body || {};
    validateNodeId(id);
    q.insDNode.run(id, validateName(name, id));
    res.status(201).json(readDraft());
  })
);

app.delete(
  '/api/draft/nodes/:id',
  wrap((req, res) => {
    const { id } = req.params;
    validateNodeId(id);
    const tx = db.transaction(() => {
      q.delDNode.run(id);
      // 连带删除以该节点为端点的草稿路段
      db.prepare('DELETE FROM draft_edges WHERE "from" = ? OR "to" = ?').run(id, id);
    });
    tx.immediate();
    res.json(readDraft());
  })
);

app.put(
  '/api/draft/edges',
  wrap((req, res) => {
    const e = req.body || {};
    validateNodeId(e.from);
    validateNodeId(e.to);
    if (e.from === e.to) throw new ApiError('INVALID_EDGE', '不允许自环路段', 422);
    validateMinutes(e.minutes);
    validateHasSteps(e.has_steps);
    const draft = readDraft();
    if (!draft.nodes.some((n) => n.id === e.from))
      throw new ApiError('INVALID_EDGE', `起点节点不存在：${e.from}`, 422);
    if (!draft.nodes.some((n) => n.id === e.to))
      throw new ApiError('INVALID_EDGE', `终点节点不存在：${e.to}`, 422);
    q.insDEdge.run({
      from: e.from,
      to: e.to,
      minutes: e.minutes,
      has_steps: validateHasSteps(e.has_steps)
    });
    res.json(readDraft());
  })
);

app.delete(
  '/api/draft/edges/:from/:to',
  wrap((req, res) => {
    const { from, to } = req.params;
    validateNodeId(from);
    validateNodeId(to);
    q.delDEdge.run(from, to);
    res.json(readDraft());
  })
);

// ----- 发布 -----
app.post(
  '/api/publish',
  wrap((req, res) => {
    const result = publishTx.immediate();
    res.status(201).json(result);
  })
);

// ----- 版本 -----
app.get('/api/versions', (req, res) => {
  const rows = q.versions.all().map((r) => ({
    version: r.version,
    published_at: r.published_at,
    published_at_iso: fmtTime(r.published_at),
    note: r.note
  }));
  res.json({ versions: rows });
});

function getVersionRows(version) {
  const ver = q.versionById.get(version);
  if (!ver) throw new ApiError('VERSION_NOT_FOUND', `路网版本不存在：${version}`, 404);
  return {
    ver,
    nodes: q.vNodes.all(version),
    edges: q.vEdges
      .all(version)
      .map((e) => ({ ...e, has_steps: !!e.has_steps }))
  };
}

app.get(
  '/api/versions/:version',
  wrap((req, res) => {
    const version = parseInt(req.params.version, 10);
    if (!Number.isInteger(version) || version <= 0)
      throw new ApiError('VERSION_NOT_FOUND', '版本号非法', 404);
    const { ver, nodes, edges } = getVersionRows(version);
    res.json({ version: ver.version, published_at: ver.published_at, published_at_iso: fmtTime(ver.published_at), note: ver.note, nodes, edges });
  })
);

app.get('/api/network/latest', (req, res) => {
  const latest = q.latestVersion.get();
  if (!latest) throw new ApiError('NO_VERSION', '尚无已发布路网版本，请先发布', 404);
  const { nodes, edges } = getVersionRows(latest.version);
  res.json({ version: latest.version, published_at: latest.published_at, published_at_iso: fmtTime(latest.published_at), note: latest.note, nodes, edges });
});

// ----- 临时封闭 -----
app.get('/api/closures', (req, res) => {
  let rows = q.allClosures.all();
  if (req.query.active_at) {
    const at = parseTime(req.query.active_at, 'active_at');
    rows = rows.filter((r) => r.start_time <= at && at < r.end_time);
  }
  res.json({
    closures: rows.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      start_time: r.start_time,
      end_time: r.end_time,
      start_iso: fmtTime(r.start_time),
      end_iso: fmtTime(r.end_time),
      reason: r.reason,
      created_at: r.created_at,
      ended: r.end_time <= nowMinute()
    }))
  });
});

app.post(
  '/api/closures',
  wrap((req, res) => {
    const { from, to, start, end, reason } = req.body || {};
    if (typeof from !== 'string' || typeof to !== 'string')
      throw new ApiError('INVALID_EDGE', '须提供路段起终点 from / to');
    validateNodeId(from);
    validateNodeId(to);
    if (from === to) throw new ApiError('INVALID_EDGE', '路段起终点不能相同');
    const startMin = parseTime(start, '开始时刻');
    const endMin = parseTime(end, '结束时刻');
    if (endMin <= startMin)
      throw new ApiError('INVALID_TIME', '结束时刻必须晚于开始时刻', 422);

    const tx = db.transaction(() => {
      const latest = q.latestVersion.get();
      if (!latest) throw new ApiError('NO_VERSION', '尚无已发布路网，无法登记封闭', 409);
      const edge = db
        .prepare('SELECT 1 FROM version_edges WHERE version = ? AND "from" = ? AND "to" = ?')
        .get(latest.version, from, to);
      if (!edge)
        throw new ApiError('EDGE_NOT_FOUND', `当前路网（v${latest.version}）不存在该有向路段：${from} -> ${to}`, 404);

      // 与同路段未结束的封闭区间重叠时拒绝，保证登记区间语义清晰
      const rows = db
        .prepare('SELECT start_time, end_time FROM closures WHERE "from" = ? AND "to" = ? AND end_time > ?')
        .all(from, to, startMin);
      for (const r of rows) {
        if (overlaps(startMin, endMin, r.start_time, r.end_time))
          throw new ApiError('CLOSURE_OVERLAP', '与该路段已登记的未结束封闭时段重叠', 409);
      }

      const info = db
        .prepare(
          'INSERT INTO closures ("from", "to", start_time, end_time, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(from, to, startMin, endMin, typeof reason === 'string' ? reason.slice(0, 200) : '', nowMinute());
      return q.closureById.get(Number(info.lastInsertRowid));
    });
    const row = tx.immediate();
    res.status(201).json({
      id: row.id,
      from: row.from,
      to: row.to,
      start_time: row.start_time,
      end_time: row.end_time,
      start_iso: fmtTime(row.start_time),
      end_iso: fmtTime(row.end_time),
      reason: row.reason
    });
  })
);

app.delete(
  '/api/closures/:id',
  wrap((req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new ApiError('INVALID_ID', '封闭记录 id 非法', 404);
    const existing = q.closureById.get(id);
    if (!existing) throw new ApiError('NOT_FOUND', `封闭记录不存在：${id}`, 404);
    q.delClosure.run(id);
    res.status(204).end();
  })
);

// ----- 访客寻路 -----
app.get(
  '/api/route',
  wrap((req, res) => {
    const { from, to, departure, no_steps, version, horizon_minutes } = req.query;
    if (typeof from !== 'string' || typeof to !== 'string')
      throw new ApiError('MISSING_PARAM', '须提供起点 from 与终点 to');
    validateNodeId(from);
    validateNodeId(to);
    const departureMin = parseTime(departure, '出发时刻');
    const noSteps = no_steps === 'true' || no_steps === '1';
    let horizon = departureMin + HORIZON_MINUTES;
    if (horizon_minutes !== undefined) {
      const h = parseInt(horizon_minutes, 10);
      if (!Number.isInteger(h) || h <= 0 || h > 7 * 24 * 60)
        throw new ApiError('INVALID_PARAM', 'horizon_minutes 须为 1~10080 的整数');
      horizon = departureMin + h;
    }

    // 一次只读事务：版本路网 + 封闭快照在同一 SQLite 快照内读取
    const readTx = db.transaction(() => {
      let verRow;
      if (version !== undefined) {
        const v = parseInt(version, 10);
        if (!Number.isInteger(v) || v <= 0) throw new ApiError('VERSION_NOT_FOUND', '版本号非法', 404);
        verRow = q.versionById.get(v);
        if (!verRow) throw new ApiError('VERSION_NOT_FOUND', `路网版本不存在：${v}`, 404);
      } else {
        verRow = q.latestVersion.get();
        if (!verRow) throw new ApiError('NO_VERSION', '尚无已发布路网版本', 404);
      }
      const nodes = q.vNodes.all(verRow.version);
      const edges = q.vEdges.all(verRow.version);
      // 只需读取可能与搜索时间窗相交的封闭
      const closureRows = db
        .prepare('SELECT "from", "to", start_time, end_time FROM closures WHERE start_time <= ? AND end_time > ?')
        .all(horizon, departureMin);
      return { verRow, nodes, edges, closureRows };
    });

    const { verRow, nodes, edges, closureRows } = readTx();
    const nodeMap = new Map(nodes.map((n) => [n.id, n.name]));

    if (!nodeMap.has(from))
      throw new ApiError('UNKNOWN_NODE', `起点节点未知：${from}（当前查询版本 v${verRow.version}）`, 404);
    if (!nodeMap.has(to))
      throw new ApiError('UNKNOWN_NODE', `终点节点未知：${to}（当前查询版本 v${verRow.version}）`, 404);

    const adj = new Map();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      adj.get(e.from).push({ to: e.to, minutes: e.minutes, hasSteps: e.has_steps });
    }
    const closuresByEdge = new Map();
    for (const c of closureRows) {
      const key = c.from + '|' + c.to;
      if (!closuresByEdge.has(key)) closuresByEdge.set(key, []);
      closuresByEdge.get(key).push([c.start_time, c.end_time]);
    }

    const result = findRoute(
      { nodes: nodeMap, adj },
      closuresByEdge,
      from,
      to,
      departureMin,
      noSteps,
      horizon
    );

    if (!result) {
      const reasons = [];
      if (noSteps) reasons.push('无台阶约束');
      reasons.push('临时封闭（全程不可重叠且途中不允许等待）');
      throw new ApiError(
        'NO_ROUTE',
        `在出发时刻 ${fmtTime(departureMin)} 起 ${horizon - departureMin} 分钟内，没有满足约束的可行路线（${reasons.join(
          '、'
        )}）`,
        422,
        { version: verRow.version, from, to, departure: fmtTime(departureMin) }
      );
    }

    res.json({
      version: verRow.version,
      published_at: verRow.published_at,
      published_at_iso: fmtTime(verRow.published_at),
      from,
      to,
      departure: departureMin,
      departure_iso: fmtTime(departureMin),
      arrival: result.arrival,
      arrival_iso: fmtTime(result.arrival),
      total_minutes: result.arrival - departureMin,
      no_steps: noSteps,
      legs: result.legs.map((l) => ({
        from: l.from,
        from_name: nodeMap.get(l.from),
        to: l.to,
        to_name: nodeMap.get(l.to),
        minutes: l.minutes,
        has_steps: l.has_steps,
        depart_at: fmtTime(l.departure),
        arrive_at: fmtTime(l.arrival)
      }))
    });
  })
);

// ---------- 静态前端 ----------
const distDir = join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(distDir, 'index.html')));
}

// 未知 API 路径返回 JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.path}` });
});

// ---------- 错误处理 ----------
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err && err.code === 'SQLITE_BUSY') {
    return res.status(503).json({ error: 'BUSY', message: '数据库繁忙，请重试' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_JSON', message: '请求体不是合法 JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'INTERNAL', message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`无障碍通行服务已启动: http://0.0.0.0:${PORT}`);
});
