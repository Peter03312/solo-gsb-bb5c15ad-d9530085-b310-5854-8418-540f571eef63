// 时变路网寻路：多标签 Dijkstra（标签 = 到达时刻）。
//
// 约束：
//  - 途中不等待：到达中间节点后立即进入下一路段；
//  - 每段通行全程避开封闭：区间 [进入时刻, 离开时刻) 不得与该路段任何封闭区间重叠；
//  - 无台阶需求下，含台阶路段不可用。
//
// 为什么不能用"每节点只保留最早到达"的普通 Dijkstra：
//  早到的状态无法等待到封闭结束（不允许等待），因此更晚到达同一节点反而可能通过，
//  故每个节点保留多个不同的到达时刻；正权边 + 时间上限保证状态有限。
import { overlaps } from './util.js';

export const DEFAULT_HORIZON_MINUTES = 24 * 60;

/**
 * @param {object} network { nodes: Map<id,name>, adj: Map<id, Array<{to,minutes,hasSteps}>> }
 * @param {Map<string, Array<[number,number]>>} closuresByEdge  key: from + '|' + to
 * @returns {{arrival:number, legs:Array}|null}
 */
export function findRoute(network, closuresByEdge, from, to, departure, noSteps, horizon) {
  if (from === to) {
    return { arrival: departure, legs: [] };
  }

  const labels = new Map(); // node -> Set(arrivalMinute)
  const parents = new Map(); // node + '@' + time -> { prevNode, prevTime, edge }
  const heap = new MinHeap();

  labels.set(from, new Set([departure]));
  heap.push(departure, { node: from, time: departure });

  const blocked = (u, v, t0, t1) => {
    const list = closuresByEdge.get(u + '|' + v);
    if (list) {
      for (const [s, e] of list) {
        if (overlaps(t0, t1, s, e)) return true;
      }
    }
    return false;
  };

  while (heap.size > 0) {
    const { node: u, time: t } = heap.pop();
    if (u === to) {
        return buildResult(parents, to, t, departure);
    }
    const edges = network.adj.get(u);
    if (!edges) continue;
    for (const edge of edges) {
      if (noSteps && edge.hasSteps) continue;
      const t1 = t + edge.minutes;
      if (t1 > horizon) continue;
      if (blocked(u, edge.to, t, t1)) continue;
      let set = labels.get(edge.to);
      if (!set) {
        set = new Set();
        labels.set(edge.to, set);
      }
      if (set.has(t1)) continue;
      set.add(t1);
      parents.set(edge.to + '@' + t1, { prevNode: u, prevTime: t, edge });
      heap.push(t1, { node: edge.to, time: t1 });
    }
  }
  return null;
}

function buildResult(parents, to, arrival, departure) {
  const legs = [];
  let node = to;
  let time = arrival;
  while (!(node === undefined)) {
    const p = parents.get(node + '@' + time);
    if (!p) break;
    legs.push({
      from: p.prevNode,
      to: node,
      minutes: p.edge.minutes,
      has_steps: p.edge.hasSteps === 1,
      departure: p.prevTime,
      arrival: time
    });
    node = p.prevNode;
    time = p.prevTime;
  }
  legs.reverse();
  return { arrival, legs, departure };
}

// 二叉小顶堆
class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(key, value) {
    const a = this.a;
    let i = a.length;
    a.push({ key, value });
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && a[l].key < a[smallest].key) smallest = l;
        if (r < n && a[r].key < a[smallest].key) smallest = r;
        if (smallest === i) break;
        [a[smallest], a[i]] = [a[i], a[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}
