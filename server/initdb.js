// 数据初始化：建表（db.js 已执行），空库时写入示例路网 v1 与草稿。
// 可重复执行：已有发布版本时跳过。
import { db } from './db.js';
import { SAMPLE } from './seed.js';
import { nowMinute } from './util.js';

export function initData(force = false) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM network_versions').get().c;
  if (count > 0 && !force) return { seeded: false, reason: 'already initialized' };

  const tx = db.transaction(() => {
    if (force) {
      db.exec(`
        DELETE FROM closures;
        DELETE FROM version_edges;
        DELETE FROM version_nodes;
        DELETE FROM network_versions;
        DELETE FROM draft_edges;
        DELETE FROM draft_nodes;
        DELETE FROM sqlite_sequence;
      `);
    }
    const publishedAt = nowMinute();
    const info = db
      .prepare('INSERT INTO network_versions (published_at, note) VALUES (?, ?)')
      .run(publishedAt, SAMPLE.note);
    const version = info.lastInsertRowid;

    const insNode = db.prepare('INSERT INTO version_nodes (version, id, name) VALUES (?, ?, ?)');
    const insEdge = db.prepare(
      'INSERT INTO version_edges (version, edge_id, "from", "to", minutes, has_steps) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insDNode = db.prepare('INSERT INTO draft_nodes (id, name) VALUES (?, ?)');
    const insDEdge = db.prepare(
      'INSERT INTO draft_edges ("from", "to", minutes, has_steps) VALUES (?, ?, ?, ?)'
    );
    for (const n of SAMPLE.nodes) {
      insNode.run(version, n.id, n.name);
      insDNode.run(n.id, n.name);
    }
    SAMPLE.edges.forEach((e, i) => {
      insEdge.run(version, i + 1, e.from, e.to, e.minutes, e.has_steps);
      insDEdge.run(e.from, e.to, e.minutes, e.has_steps);
    });
    return version;
  });

  const version = tx();
  return { seeded: true, version };
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invokedPath.endsWith('initdb.js')) {
  const result = initData(process.argv.includes('--force'));
  console.log(JSON.stringify(result));
}
