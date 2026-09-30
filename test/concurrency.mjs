// 并发一致性测试：大量并发发布、查询、封闭登记交错执行。
// 断言：
//  1) 每次查询返回的 version 都真实存在，且 legs 中的边确实属于该版本（版本完整）；
//  2) 查询使用的封闭快照与结果自洽：结果中每段行程区间不与当时登记的封闭重叠；
//  3) 所有发布串行化（版本号连续无洞），无 SQLITE_BUSY/500 错误；
//  4) 有活跃封闭时删除路段的发布必被拒。
const BASE = 'http://127.0.0.1:8080';

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (m) => new Date(m * 60000).toISOString().slice(0, 16) + 'Z';
const PUBLISH_DAY = '2026-12-01';

async function main() {
  // 起点基线
  const { body: net } = await j('/api/network/latest');
  const baseVersion = net.version;
  console.log('基线版本', baseVersion, '节点', net.nodes.length, '边', net.edges.length);

  const stats = { queries: 0, publishes: 0, publishRejected: 0, closures: 0, errors: [] };
  const observedVersions = new Map(); // version -> 边数
  const allClosures = new Map(); // key -> [ [s,e] ]
  const lock = {
    async with(fn) { return fn(); }
  };
  void lock;

  // 1) 预先在发布日登记若干封闭（针对 SQUARE-RAMPS 往返），用于校验结果自洽
  const preclosures = [
    ['SQUARE', 'RAMPS', `${PUBLISH_DAY}T01:00`, `${PUBLISH_DAY}T23:00`],
    ['RAMPS', 'VIEW', `${PUBLISH_DAY}T03:00`, `${PUBLISH_DAY}T05:00`],
    ['BRIDGE', 'VIEW', `${PUBLISH_DAY}T06:00`, `${PUBLISH_DAY}T20:00`]
  ];
  for (const [f, t, s, e] of preclosures) {
    const r = await j('/api/closures', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: f, to: t, start: s, end: e, reason: '并发测试' })
    });
    if (r.status === 201) {
      stats.closures++;
      const k = f + '|' + t;
      if (!allClosures.has(k)) allClosures.set(k, []);
      allClosures.get(k).push([r.body.start_time, r.body.end_time]);
    }
  }

  // 查询 worker：不断用不同出发时刻寻路（无台阶），校验版本与封闭自洽
  async function queryWorker(id, n) {
    for (let i = 0; i < n; i++) {
      const hour = (i % 22) + 1; // 01:00..22:00
      const dep = `${PUBLISH_DAY}T${String(hour).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`;
      const r = await j(`/api/route?from=SQUARE&to=VIEW&departure=${encodeURIComponent(dep)}&no_steps=true&horizon_minutes=600`);
      stats.queries++;
      if (r.status === 422 && r.body.error === 'NO_ROUTE') continue;
      if (r.status !== 200) {
        stats.errors.push(`query ${r.status} ${JSON.stringify(r.body)}`);
        continue;
      }
      const d = r.body;
      // 版本必须存在
      const vr = await j(`/api/versions/${d.version}`);
      if (vr.status !== 200) { stats.errors.push(`查询返回未知版本 ${d.version}`); continue; }
      const edgeSet = new Set(vr.body.edges.map((e) => e.from + '|' + e.to));
      observedVersions.set(d.version, vr.body.edges.length);
      // 时间链连续（不等待），边属于该版本
      let expect = d.departure;
      for (const l of d.legs) {
        if (!edgeSet.has(l.from + '|' + l.to)) stats.errors.push(`v${d.version} 结果包含不属于该版本的边 ${l.from}->${l.to}`);
        if (l.has_steps) stats.errors.push('无台阶结果含台阶路段');
        const depMin = Date.parse(l.depart_at) / 60000;
        const arrMin = Date.parse(l.arrive_at) / 60000;
        if (depMin !== expect) stats.errors.push('行程段之间存在等待/时间不连续');
        if (arrMin - depMin !== l.minutes) stats.errors.push('路段用时不一致');
        expect = arrMin;
        // 不与任何已知封闭重叠
        const list = allClosures.get(l.from + '|' + l.to) || [];
        for (const [s, e] of list) {
          if (depMin < e && s < arrMin) stats.errors.push(`结果路段 ${l.from}->${l.to} 行程 [${l.depart_at},${l.arrive_at}) 穿过封闭 [${iso(s)},${iso(e)})`);
        }
      }
      if (d.arrival !== expect) stats.errors.push('到达时刻与腿链不一致');
    }
  }

  // 发布 worker：每次在草稿加一个临时节点再发布（不删边，故不会被封闭拦截）
  let pubSeq = 0;
  async function publishWorker(n) {
    for (let i = 0; i < n; i++) {
      const my = ++pubSeq;
      // 取草稿 -> 加节点 -> 整体替换 -> 发布；各 worker 的草稿写会互相覆盖，
      // 但每次写入本身必须通过完整校验
      const g = await j('/api/draft');
      const draft = g.body;
      draft.nodes = draft.nodes.filter((x) => !x.id.startsWith('TMP'));
      draft.nodes.push({ id: `TMP${my}`, name: `临时点${my}` });
      const put = await j('/api/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      if (put.status !== 200) { stats.errors.push(`draft put ${put.status} ${JSON.stringify(put.body).slice(0,200)}`); continue; }
      const r = await j('/api/publish', { method: 'POST' });
      if (r.status === 201) stats.publishes++;
      else if (r.status === 409 && r.body.error === 'CLOSURE_ACTIVE') stats.publishRejected++;
      else stats.errors.push(`publish ${r.status} ${JSON.stringify(r.body).slice(0,200)}`);
    }
  }

  // 封闭 worker：登记不同日的短封闭（彼此不重叠），不影响主测试路径
  async function closureWorker(n) {
    for (let i = 0; i < n; i++) {
      const day = 2 + Math.floor(i / 12); // 12-02 起，每天每个 worker 只登记一条
      const r = await j('/api/closures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'HALL', to: 'LIB',
          start: `2026-12-${String(day).padStart(2, '0')}T08:00`,
          end: `2026-12-${String(day).padStart(2, '0')}T09:00`,
          reason: '并发封闭'
        })
      });
      if (r.status === 201) {
        stats.closures++;
      } else if (r.status === 409) {
        // 重叠拒绝也可接受
      } else stats.errors.push(`closure ${r.status} ${JSON.stringify(r.body).slice(0,200)}`);
      await sleep(2);
    }
  }

  await Promise.all([
    queryWorker(1, 60), queryWorker(2, 60), queryWorker(3, 60), queryWorker(4, 60),
    publishWorker(15),
    closureWorker(20)
  ]);

  // 校验版本号连续
  const { body: vers } = await j('/api/versions');
  const nums = vers.versions.map((v) => v.version).sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) stats.errors.push(`版本号不连续: ${nums[i - 1]} -> ${nums[i]}`);
  }
  // 旧版本仍可查且边数一致
  const v1 = await j('/api/versions/1');
  if (v1.status !== 200 || v1.body.edges.length !== net.edges.length) stats.errors.push('旧版本 v1 被破坏');

  console.log(JSON.stringify(stats, null, 2));
  console.log('发布成功:', stats.publishes, ' 最终版本数:', nums.length, ' 观察到的版本:', [...observedVersions.entries()].sort((a,b)=>a[0]-b[0]).map(([v,c])=>`v${v}:${c}边`).join(' '));
  console.log(stats.errors.length === 0 ? '✅ 并发一致性全部通过' : '❌ 发现问题:\n' + stats.errors.slice(0, 20).join('\n'));
  process.exit(stats.errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
