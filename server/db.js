'use strict';

/**
 * 数据库层：schema、事务助手与初始数据。
 *
 * 一致性设计：
 *  - better-sqlite3 为同步驱动，配合 WAL 模式，单连接内的读写天然串行；
 *  - 发布（写版本快照）与查询（读版本 + 封闭快照）都包在 db.transaction 中，
 *    因此并发请求要么看到完整旧版本，要么看到完整新版本，不会读到半个版本；
 *  - 查询时把「版本内容 + 封闭列表」放在同一个事务里读取，得到一致的封闭快照。
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'campus.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS draft_nodes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS draft_segments (
  id        TEXT PRIMARY KEY,
  from_node TEXT NOT NULL,
  to_node   TEXT NOT NULL,
  minutes   REAL NOT NULL,
  has_steps INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS version_nodes (
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS version_segments (
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  from_node  TEXT NOT NULL,
  to_node    TEXT NOT NULL,
  minutes    REAL NOT NULL,
  has_steps  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS closures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closures_segment ON closures(segment_id);
CREATE INDEX IF NOT EXISTS idx_closures_end ON closures(end_ms);
`);

/* ------------------------------------------------------------------ */
/* 初始数据：仅在从未发布过任何版本时写入，保证容器重复启动幂等。        */
/* ------------------------------------------------------------------ */

const SEED_NODES = [
  { id: 'N_GATE',  name: '北门' },
  { id: 'E_GATE',  name: '东门' },
  { id: 'LIB',     name: '图书馆' },
  { id: 'CANTEEN', name: '食堂' },
  { id: 'DORM',    name: '宿舍' },
  { id: 'TEACH',   name: '教学楼' },
  { id: 'GYM',     name: '体育馆' },
  { id: 'PLAZA',   name: '中心广场' },
];

// minutes 为通行分钟数；has_steps=1 表示路段含台阶（无台阶需求者不可走）。
const SEED_SEGMENTS = [
  { id: 'S_NGATE_PLAZA',  from: 'N_GATE',  to: 'PLAZA',   minutes: 6,  hasSteps: false },
  { id: 'S_PLAZA_NGATE',  from: 'PLAZA',   to: 'N_GATE',  minutes: 6,  hasSteps: false },
  { id: 'S_EGATE_PLAZA',  from: 'E_GATE',  to: 'PLAZA',   minutes: 5,  hasSteps: false },
  { id: 'S_PLAZA_EGATE',  from: 'PLAZA',   to: 'E_GATE',  minutes: 5,  hasSteps: false },
  { id: 'S_PLAZA_LIB',    from: 'PLAZA',   to: 'LIB',     minutes: 4,  hasSteps: false },
  { id: 'S_LIB_PLAZA',    from: 'LIB',     to: 'PLAZA',   minutes: 4,  hasSteps: false },
  { id: 'S_PLAZA_CANT',   from: 'PLAZA',   to: 'CANTEEN', minutes: 3,  hasSteps: false },
  { id: 'S_CANT_PLAZA',   from: 'CANTEEN', to: 'PLAZA',   minutes: 3,  hasSteps: false },
  { id: 'S_LIB_TEACH',    from: 'LIB',     to: 'TEACH',   minutes: 7,  hasSteps: true  }, // 台阶捷径
  { id: 'S_TEACH_LIB',    from: 'TEACH',   to: 'LIB',     minutes: 7,  hasSteps: true  },
  { id: 'S_LIB_CANT',     from: 'LIB',     to: 'CANTEEN', minutes: 8,  hasSteps: false },
  { id: 'S_CANT_DORM',    from: 'CANTEEN', to: 'DORM',    minutes: 6,  hasSteps: false },
  { id: 'S_DORM_CANT',    from: 'DORM',    to: 'CANTEEN', minutes: 6,  hasSteps: false },
  { id: 'S_CANT_TEACH',   from: 'CANTEEN', to: 'TEACH',   minutes: 10, hasSteps: false }, // 无台阶绕行
  { id: 'S_TEACH_CANT',   from: 'TEACH',   to: 'CANTEEN', minutes: 10, hasSteps: false },
  { id: 'S_TEACH_GYM',    from: 'TEACH',   to: 'GYM',     minutes: 5,  hasSteps: false },
  { id: 'S_GYM_TEACH',    from: 'GYM',     to: 'TEACH',   minutes: 5,  hasSteps: false },
  { id: 'S_DORM_GYM',     from: 'DORM',    to: 'GYM',     minutes: 12, hasSteps: true  }, // 山坡台阶
];

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM versions').get();
  if (row.n > 0) return false;

  const seed = db.transaction(() => {
    const insNode = db.prepare('INSERT INTO draft_nodes (id, name) VALUES (?, ?)');
    const insSeg = db.prepare(
      'INSERT INTO draft_segments (id, from_node, to_node, minutes, has_steps) VALUES (?, ?, ?, ?, ?)'
    );
    for (const n of SEED_NODES) insNode.run(n.id, n.name);
    for (const s of SEED_SEGMENTS) insSeg.run(s.id, s.from, s.to, s.minutes, s.hasSteps ? 1 : 0);

    // 直接把种子草稿发布为版本 1
    const now = new Date().toISOString();
    const v = db.prepare('INSERT INTO versions (published_at) VALUES (?)').run(now);
    const vid = v.lastInsertRowid;
    const insVN = db.prepare('INSERT INTO version_nodes (version_id, id, name) VALUES (?, ?, ?)');
    const insVS = db.prepare(
      'INSERT INTO version_segments (version_id, id, from_node, to_node, minutes, has_steps) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const n of SEED_NODES) insVN.run(vid, n.id, n.name);
    for (const s of SEED_SEGMENTS) insVS.run(vid, s.id, s.from, s.to, s.minutes, s.hasSteps ? 1 : 0);

    // 演示用封闭：图书馆—教学楼台阶捷径，当前时刻起封闭 2 小时
    const nowMs = Date.now();
    db.prepare(
      'INSERT INTO closures (segment_id, start_ms, end_ms, note, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('S_LIB_TEACH', nowMs - 30 * 60000, nowMs + 2 * 3600000, '台阶维修（演示数据）', now);

    return vid;
  });

  const vid = seed();
  console.log(`[init] 已写入初始路网并发布为版本 ${vid}`);
  return true;
}

module.exports = { db, seedIfEmpty };
