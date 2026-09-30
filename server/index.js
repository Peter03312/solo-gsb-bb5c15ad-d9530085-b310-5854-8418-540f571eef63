'use strict';

const path = require('path');
const express = require('express');
const { db, seedIfEmpty } = require('./db');
const { findRoute } = require('./route');

const PORT = Number(process.env.PORT || 3000);

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ---------------- 工具 ---------------- */

const iso = (ms) => new Date(ms).toISOString();

function parseTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function fail(res, status, code, message, extra) {
  res.status(status).json({ ok: false, code, message, ...(extra || {}) });
}

const segRow = (r) => ({
  id: r.id,
  from: r.from_node,
  to: r.to_node,
  minutes: r.minutes,
  hasSteps: !!r.has_steps,
});

/* ---------------- 草稿（维护者） ---------------- */

// 读取草稿
app.get('/api/draft', (req, res) => {
  const nodes = db.prepare('SELECT id, name FROM draft_nodes ORDER BY id').all();
  const segments = db.prepare('SELECT * FROM draft_segments ORDER BY id').all().map(segRow);
  res.json({ ok: true, nodes, segments });
});

// 整体替换草稿（单事务，要么全改要么不改）
app.put('/api/draft', (req, res) => {
  const { nodes, segments } = req.body || {};
  if (!Array.isArray(nodes) || !Array.isArray(segments)) {
    return fail(res, 400, 'BAD_SHAPE', '请求体须为 { nodes: [...], segments: [...] }');
  }
  const cleanId = (v) => (typeof v === 'string' ? v.trim() : '');
  const nIds = new Set();
  for (const n of nodes) {
    if (!cleanId(n.id)) return fail(res, 400, 'BAD_NODE', '节点 id 不能为空');
    if (nIds.has(n.id)) return fail(res, 400, 'DUP_NODE', `节点 id 重复：${n.id}`);
    nIds.add(n.id);
  }
  const sIds = new Set();
  for (const s of segments) {
    if (!cleanId(s.id)) return fail(res, 400, 'BAD_SEGMENT', '路段 id 不能为空');
    if (sIds.has(s.id)) return fail(res, 400, 'DUP_SEGMENT', `路段 id 重复：${s.id}`);
    sIds.add(s.id);
    if (typeof s.minutes !== 'number' || !Number.isFinite(s.minutes)) {
      return fail(res, 400, 'BAD_MINUTES', `路段 ${s.id} 的通行分钟必须是数字`);
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM draft_segments').run();
    db.prepare('DELETE FROM draft_nodes').run();
    const insN = db.prepare('INSERT INTO draft_nodes (id, name) VALUES (?, ?)');
    const insS = db.prepare(
      'INSERT INTO draft_segments (id, from_node, to_node, minutes, has_steps) VALUES (?, ?, ?, ?, ?)'
    );
    for (const n of nodes) insN.run(n.id.trim(), String(n.name ?? ''));
    for (const s of segments) {
      insS.run(s.id.trim(), cleanId(s.from), cleanId(s.to), s.minutes, s.hasSteps ? 1 : 0);
    }
  })();

  res.json({ ok: true, nodeCount: nodes.length, segmentCount: segments.length });
});

/* ---------------- 发布 ---------------- */

app.post('/api/publish', (req, res) => {
  // 校验 + 发布放在同一事务：校验通过即原子落库，并发发布串行执行，
  // 版本要么完整出现、要么不出现。
  const publish = db.transaction(() => {
    const nodes = db.prepare('SELECT id, name FROM draft_nodes').all();
    const segments = db.prepare('SELECT * FROM draft_segments').all();

    const errors = [];
    const nodeIds = new Set(nodes.map((n) => n.id));
    if (nodes.length === 0) errors.push('路网为空：草稿中没有任何节点');

    for (const s of segments) {
      if (!nodeIds.has(s.from_node)) {
        errors.push(`路段 ${s.id} 的起点「${s.from_node}」不存在`);
      }
      if (!nodeIds.has(s.to_node)) {
        errors.push(`路段 ${s.id} 的终点「${s.to_node}」不存在`);
      }
      if (!(typeof s.minutes === 'number' && s.minutes > 0)) {
        errors.push(`路段 ${s.id} 的通行分钟必须为正数（当前：${s.minutes}）`);
      }
    }

    // 不得删除尚有未结束封闭的路段
    const nowMs = Date.now();
    const open = db
      .prepare('SELECT DISTINCT segment_id FROM closures WHERE end_ms > ?')
      .all(nowMs);
    const draftSegIds = new Set(segments.map((s) => s.id));
    for (const c of open) {
      if (!draftSegIds.has(c.segment_id)) {
        errors.push(`路段 ${c.segment_id} 尚有未结束的封闭，发布不能将其删除`);
      }
    }

    if (errors.length > 0) return { errors };

    const publishedAt = new Date().toISOString();
    const vid = db.prepare('INSERT INTO versions (published_at) VALUES (?)').run(publishedAt)
      .lastInsertRowid;
    const insN = db.prepare('INSERT INTO version_nodes (version_id, id, name) VALUES (?, ?, ?)');
    const insS = db.prepare(
      'INSERT INTO version_segments (version_id, id, from_node, to_node, minutes, has_steps) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const n of nodes) insN.run(vid, n.id, n.name);
    for (const s of segments) insS.run(vid, s.id, s.from_node, s.to_node, s.minutes, s.has_steps);
    return { version: Number(vid), publishedAt };
  });

  const result = publish();
  if (result.errors) {
    return fail(res, 409, 'PUBLISH_INVALID', '草稿校验未通过，未发布', { errors: result.errors });
  }
  res.json({ ok: true, ...result });
});

/* ---------------- 版本查询 ---------------- */

app.get('/api/versions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.id, v.published_at AS publishedAt,
              (SELECT COUNT(*) FROM version_nodes n WHERE n.version_id = v.id)    AS nodeCount,
              (SELECT COUNT(*) FROM version_segments s WHERE s.version_id = v.id) AS segmentCount
       FROM versions v ORDER BY v.id DESC`
    )
    .all();
  res.json({ ok: true, versions: rows });
});

app.get('/api/versions/:id', (req, res) => {
  const vid = Number(req.params.id);
  const v = db.prepare('SELECT id, published_at AS publishedAt FROM versions WHERE id = ?').get(vid);
  if (!v) return fail(res, 404, 'VERSION_NOT_FOUND', `版本 ${req.params.id} 不存在`);
  const nodes = db.prepare('SELECT id, name FROM version_nodes WHERE version_id = ? ORDER BY id').all(vid);
  const segments = db
    .prepare('SELECT * FROM version_segments WHERE version_id = ? ORDER BY id')
    .all(vid)
    .map(segRow);
  res.json({ ok: true, version: v, nodes, segments });
});

/* ---------------- 临时封闭 ---------------- */

app.post('/api/closures', (req, res) => {
  const { segmentId, start, end, note } = req.body || {};
  const segId = typeof segmentId === 'string' ? segmentId.trim() : '';
  if (!segId) return fail(res, 400, 'BAD_SEGMENT', '缺少路段 id');

  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (startMs === null || endMs === null) {
    return fail(res, 400, 'INVALID_TIME', '起止时刻无效，请使用 ISO 8601 时间');
  }
  if (startMs >= endMs) {
    return fail(res, 400, 'INVALID_TIME', '封闭开始时刻必须早于结束时刻');
  }

  // 封闭作用于查询，而查询基于最新发布版本，因此路段须存在于最新版本中
  const seg = db
    .prepare(
      `SELECT s.id FROM version_segments s
       WHERE s.version_id = (SELECT MAX(id) FROM versions) AND s.id = ?`
    )
    .get(segId);
  if (!seg) {
    return fail(res, 400, 'UNKNOWN_SEGMENT', `路段「${segId}」在最新发布版本中不存在`);
  }

  const createdAt = new Date().toISOString();
  const id = db
    .prepare('INSERT INTO closures (segment_id, start_ms, end_ms, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(segId, startMs, endMs, String(note ?? ''), createdAt).lastInsertRowid;

  res.status(201).json({
    ok: true,
    closure: { id: Number(id), segmentId: segId, start: iso(startMs), end: iso(endMs), note: String(note ?? '') },
  });
});

app.get('/api/closures', (req, res) => {
  const nowMs = Date.now();
  const rows = db.prepare('SELECT * FROM closures ORDER BY start_ms DESC').all();
  res.json({
    ok: true,
    now: iso(nowMs),
    closures: rows.map((c) => ({
      id: c.id,
      segmentId: c.segment_id,
      start: iso(c.start_ms),
      end: iso(c.end_ms),
      note: c.note,
      active: c.end_ms > nowMs, // 未结束
    })),
  });
});

/* ---------------- 访客路线查询 ---------------- */

app.get('/api/route', (req, res) => {
  const { from, to, version: versionParam } = req.query;
  const stepFree = req.query.stepFree === 'true' || req.query.stepFree === '1';

  const departMs = parseTime(req.query.depart);
  if (departMs === null) {
    return fail(res, 400, 'INVALID_TIME', `出发时刻无效：「${req.query.depart ?? ''}」，请使用 ISO 8601 时间`);
  }
  if (!from || !to) return fail(res, 400, 'BAD_ENDPOINT', '必须提供起点 from 与终点 to');

  // 同一事务内读取版本内容与封闭列表 => 一致的封闭快照；
  // 即使此刻有发布提交，本事务看到的仍是完整旧版本。
  const snapshot = db.transaction(() => {
    let vid;
    if (versionParam !== undefined && versionParam !== '') {
      vid = Number(versionParam);
      if (!Number.isInteger(vid)) return { error: ['VERSION_NOT_FOUND', `版本号无效：${versionParam}`] };
    } else {
      vid = db.prepare('SELECT MAX(id) AS m FROM versions').get().m;
      if (vid === null) return { error: ['NO_VERSION', '尚未发布任何路网版本'] };
    }
    const v = db.prepare('SELECT id, published_at AS publishedAt FROM versions WHERE id = ?').get(vid);
    if (!v) return { error: ['VERSION_NOT_FOUND', `版本 ${vid} 不存在`] };

    const nodes = db.prepare('SELECT id, name FROM version_nodes WHERE version_id = ?').all(vid);
    const segments = db
      .prepare('SELECT * FROM version_segments WHERE version_id = ?')
      .all(vid)
      .map(segRow);
    const closures = db.prepare('SELECT segment_id, start_ms, end_ms FROM closures').all();
    return { version: v, nodes, segments, closures };
  })();

  if (snapshot.error) {
    const [code, message] = snapshot.error;
    return fail(res, code === 'NO_VERSION' ? 409 : 404, code, message);
  }

  const { version, nodes, segments, closures } = snapshot;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeName = (id) => (nodes.find((n) => n.id === id) || {}).name || id;

  if (!nodeIds.has(from)) {
    return fail(res, 404, 'UNKNOWN_NODE', `起点「${from}」在版本 ${version.id} 中不存在`, { version: version.id });
  }
  if (!nodeIds.has(to)) {
    return fail(res, 404, 'UNKNOWN_NODE', `终点「${to}」在版本 ${version.id} 中不存在`, { version: version.id });
  }

  const closuresBySeg = new Map();
  for (const c of closures) {
    if (!closuresBySeg.has(c.segment_id)) closuresBySeg.set(c.segment_id, []);
    closuresBySeg.get(c.segment_id).push([c.start_ms, c.end_ms]);
  }

  const route = findRoute(segments, closuresBySeg, from, to, departMs, stepFree);
  if (!route) {
    return fail(
      res,
      404,
      'NO_ROUTE',
      `从「${nodeName(from)}」到「${nodeName(to)}」在该出发时刻没有可行路线` +
        (stepFree ? '（已限定无台阶路段）' : '') +
        '：可能路网不连通，或沿途路段在通行时段内被封闭',
      { version: version.id }
    );
  }

  res.json({
    ok: true,
    version: version.id,
    publishedAt: version.publishedAt,
    from,
    to,
    stepFree,
    depart: iso(departMs),
    arrive: iso(route.arriveMs),
    totalMinutes: Math.round(((route.arriveMs - departMs) / 60000) * 100) / 100,
    legs: route.legs.map((l) => ({
      segment: l.segment,
      from: l.from,
      fromName: nodeName(l.from),
      to: l.to,
      toName: nodeName(l.to),
      depart: iso(l.departMs),
      arrive: iso(l.arriveMs),
      minutes: l.minutes,
      hasSteps: l.hasSteps,
    })),
  });
});

/* ---------------- 前端静态资源 ---------------- */

const distDir = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(distDir));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(503).send('前端尚未构建：请先运行 npm --prefix client run build');
  });
});

app.listen(PORT, () => {
  console.log(`园区无障碍通行服务已启动: http://localhost:${PORT}`);
});
