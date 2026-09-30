'use strict';

/**
 * 时变最短路（不允许途中等待）：
 *  - 访客在 departMs 从起点出发，到达节点后立即进入下一路段，不等待；
 *  - 路段在时刻 t 可走，当且仅当整个通行区间 [t, t + minutes) 与该路段所有
 *    封闭区间 [start, end) 都不相交（全程避开封闭，而不是只在进入时刻避开）；
 *  - 各路段通行分钟为正常数，时间单调前进，满足 FIFO，故用标准 Dijkstra
 *    按「最早到达时刻」扩展即可得到最早到达路线。
 */

/**
 * @param {Array<{id:string,from:string,to:string,minutes:number,hasSteps:boolean}>} segments
 * @param {Map<string, Array<[number, number]>>} closuresBySeg  路段 -> [startMs, endMs)[]
 * @param {string} from 起点节点 id
 * @param {string} to   终点节点 id
 * @param {number} departMs 出发时刻（epoch ms）
 * @param {boolean} stepFree 是否要求全程无台阶
 * @returns {{arriveMs:number, legs:Array}|null} 可行路线或 null
 */
function findRoute(segments, closuresBySeg, from, to, departMs, stepFree) {
  if (from === to) return { arriveMs: departMs, legs: [] };

  // 邻接表；无台阶需求在此过滤含台阶路段
  const adj = new Map();
  for (const s of segments) {
    if (stepFree && s.hasSteps) continue;
    if (!adj.has(s.from)) adj.set(s.from, []);
    adj.get(s.from).push(s);
  }

  // 路段在 t0 进入是否可行：整个通行区间避开所有封闭区间
  const traverse = (seg, t0) => {
    const t1 = t0 + seg.minutes * 60000;
    const list = closuresBySeg.get(seg.id);
    if (list) {
      for (const [cs, ce] of list) {
        if (t0 < ce && cs < t1) return null; // 与封闭相交，且不允许等待
      }
    }
    return t1;
  };

  const dist = new Map([[from, departMs]]); // 节点 -> 最早到达时刻
  const prev = new Map();                   // 节点 -> { node, seg, departMs, arriveMs }
  // 小规模路网，用简单数组作优先队列即可
  const queue = [[departMs, from]];

  while (queue.length > 0) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
    const [t, u] = queue.splice(bi, 1)[0];
    if (t > dist.get(u)) continue; // 过期堆项
    if (u === to) break;

    for (const seg of adj.get(u) || []) {
      const arr = traverse(seg, t);
      if (arr === null) continue;
      if (arr < (dist.get(seg.to) ?? Infinity)) {
        dist.set(seg.to, arr);
        prev.set(seg.to, { node: u, seg, departMs: t, arriveMs: arr });
        queue.push([arr, seg.to]);
      }
    }
  }

  if (!dist.has(to)) return null;

  // 回溯路径
  const legs = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    legs.unshift({
      segment: p.seg.id,
      from: p.seg.from,
      to: p.seg.to,
      departMs: p.departMs,
      arriveMs: p.arriveMs,
      minutes: p.seg.minutes,
      hasSteps: !!p.seg.hasSteps,
    });
    cur = p.node;
  }
  return { arriveMs: dist.get(to), legs };
}

module.exports = { findRoute };
