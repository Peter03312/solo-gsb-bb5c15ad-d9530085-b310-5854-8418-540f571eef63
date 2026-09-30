import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtLocal } from '../api.js';

const emptyDraft = { nodes: [], edges: [] };

export default function DraftEditor({ onPublished }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [versions, setVersions] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newNode, setNewNode] = useState({ id: '', name: '' });
  const [newEdge, setNewEdge] = useState({ from: '', to: '', minutes: '', has_steps: false });

  const loadAll = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api.getDraft(), api.versions()]);
      setDraft(d);
      setVersions(v.versions);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function mutate(fn) {
    setDraft((d) => {
      const copy = { nodes: d.nodes.map((n) => ({ ...n })), edges: d.edges.map((e) => ({ ...e })) };
      fn(copy);
      return copy;
    });
    setDirty(true);
    setMsg(null);
  }

  function addNode() {
    const id = newNode.id.trim();
    const name = newNode.name.trim();
    if (!id || !name) { setError('节点标识与名称不能为空'); return; }
    if (draft.nodes.some((n) => n.id === id)) { setError(`节点标识已存在：${id}`); return; }
    mutate((d) => d.nodes.push({ id, name }));
    setNewNode({ id: '', name: '' });
    setError('');
  }

  function removeNode(id) {
    mutate((d) => {
      d.nodes = d.nodes.filter((n) => n.id !== id);
      d.edges = d.edges.filter((e) => e.from !== id && e.to !== id);
    });
  }

  function renameNode(id, name) {
    mutate((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n) n.name = name;
    });
  }

  function addEdge() {
    const m = parseInt(newEdge.minutes, 10);
    if (!newEdge.from || !newEdge.to) { setError('请选择路段起终点'); return; }
    if (newEdge.from === newEdge.to) { setError('不允许自环路段'); return; }
    if (!Number.isInteger(m) || m <= 0) { setError('通行分钟须为正整数'); return; }
    if (draft.edges.some((e) => e.from === newEdge.from && e.to === newEdge.to)) {
      setError('该有向路段已存在');
      return;
    }
    mutate((d) =>
      d.edges.push({ from: newEdge.from, to: newEdge.to, minutes: m, has_steps: !!newEdge.has_steps })
    );
    setNewEdge({ from: '', to: '', minutes: '', has_steps: false });
    setError('');
  }

  function removeEdge(from, to) {
    mutate((d) => {
      d.edges = d.edges.filter((e) => !(e.from === from && e.to === to));
    });
  }

  function updateEdge(edge, patch) {
    mutate((d) => {
      const e = d.edges.find((x) => x.from === edge.from && x.to === edge.to);
      if (e) Object.assign(e, patch);
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    setMsg(null);
    try {
      // 本地预检（服务端仍为最终裁决）
      const ids = new Set();
      for (const n of draft.nodes) {
        if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(n.id)) throw new Error(`节点标识非法：${n.id}`);
        if (ids.has(n.id)) throw new Error(`节点标识重复：${n.id}`);
        ids.add(n.id);
      }
      const pairs = new Set();
      for (const e of draft.edges) {
        if (e.from === e.to) throw new Error(`不允许自环路段：${e.from}`);
        if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`路段端点不存在：${e.from} -> ${e.to}`);
        if (!Number.isInteger(e.minutes) || e.minutes <= 0) throw new Error(`路段 ${e.from}->${e.to} 通行分钟须为正整数`);
        const k = e.from + '|' + e.to;
        if (pairs.has(k)) throw new Error(`重复路段：${k}`);
        pairs.add(k);
      }
      const saved = await api.putDraft({
        nodes: draft.nodes.map((n) => ({ id: n.id, name: n.name })),
        edges: draft.edges.map((e) => ({
          from: e.from,
          to: e.to,
          minutes: Number(e.minutes),
          has_steps: !!e.has_steps
        }))
      });
      setDraft(saved);
      setDirty(false);
      setMsg({ type: 'ok', text: `草稿已保存：${saved.nodes.length} 个节点、${saved.edges.length} 条有向路段。` });
    } catch (e) {
      setError('保存被拒绝：' + (e.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  async function resetLocal() {
    setError('');
    setMsg(null);
    await loadAll();
  }

  async function publish() {
    setBusy(true);
    setError('');
    setMsg(null);
    try {
      const r = await api.publish();
      setMsg({ type: 'ok', text: `已整体发布为新版本 v${r.version}（发布时间（本地）${fmtLocal(new Date(r.published_at * 60000).toISOString())}）。旧版本继续可查。` });
      setDirty(false);
      await loadAll();
      onPublished && onPublished();
    } catch (e) {
      if (e.code === 'CLOSURE_ACTIVE' && e.data?.details?.active_on_missing_edges) {
        const list = e.data.details.active_on_missing_edges.map((x) => `${x.from} -> ${x.to}`).join('、');
        setError(`发布被拒绝：以下路段尚有未结束封闭，新版本不得删除：${list}。请保留这些路段，或待封闭结束后再发布。`);
      } else {
        setError('发布失败：' + (e.message || '未知错误'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>路网草稿编辑 {dirty && <span className="badge">有未保存修改</span>}</h2>
        <p className="muted small">
          在草稿中维护节点与有向路段（通行分钟、是否含台阶）。修改先保存到草稿，校验通过后再“整体发布”生成新版本；发布不影响旧版本查询。
          保存/发布时服务端将拒绝：端点不存在、通行分钟非正、自环、重复路段，以及删除仍有未结束封闭的路段。
        </p>
        <div className="row">
          <button className="btn primary" disabled={busy || !dirty} onClick={save}>保存草稿</button>
          <button className="btn" disabled={busy || dirty} onClick={publish} title={dirty ? '请先保存草稿' : ''}>
            整体发布新版本
          </button>
          <button className="btn" disabled={busy} onClick={resetLocal}>放弃本地修改并重载</button>
        </div>
        {error && <div className="alert error">⚠ {error}</div>}
        {msg?.type === 'ok' && <div className="alert ok">✔ {msg.text}</div>}
      </div>

      <div className="card">
        <h2>节点（{draft.nodes.length}）</h2>
        <div className="inline-form" style={{ marginBottom: 10 }}>
          <input type="text" placeholder="节点标识，如 GATE3" value={newNode.id}
            onChange={(e) => setNewNode((s) => ({ ...s, id: e.target.value }))} style={{ width: 180 }} />
          <input type="text" placeholder="节点名称，如 3号门" value={newNode.name}
            onChange={(e) => setNewNode((s) => ({ ...s, name: e.target.value }))} style={{ width: 200 }} />
          <button className="btn" onClick={addNode}>添加节点</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 140 }}>标识</th><th>名称</th><th style={{ width: 90 }}>操作</th></tr></thead>
            <tbody>
              {draft.nodes.map((n) => (
                <tr key={n.id}>
                  <td><code className="k">{n.id}</code></td>
                  <td>
                    <input type="text" value={n.name} style={{ width: 260 }}
                      onChange={(e) => renameNode(n.id, e.target.value)} />
                  </td>
                  <td><button className="btn danger" onClick={() => removeNode(n.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>有向路段（{draft.edges.length}）</h2>
        <div className="inline-form" style={{ marginBottom: 10 }}>
          <select value={newEdge.from} onChange={(e) => setNewEdge((s) => ({ ...s, from: e.target.value }))}>
            <option value="">起点…</option>
            {draft.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}（{n.id}）</option>)}
          </select>
          <select value={newEdge.to} onChange={(e) => setNewEdge((s) => ({ ...s, to: e.target.value }))}>
            <option value="">终点…</option>
            {draft.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}（{n.id}）</option>)}
          </select>
          <input type="text" placeholder="通行分钟（正整数）" value={newEdge.minutes}
            onChange={(e) => setNewEdge((s) => ({ ...s, minutes: e.target.value }))} style={{ width: 150 }} />
          <label className="checkline">
            <input type="checkbox" checked={newEdge.has_steps}
              onChange={(e) => setNewEdge((s) => ({ ...s, has_steps: e.target.checked }))} />
            含台阶
          </label>
          <button className="btn" onClick={addEdge}>添加路段</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>起点</th><th>终点</th>
                <th style={{ width: 120 }}>通行分钟</th>
                <th style={{ width: 120 }}>台阶属性</th>
                <th style={{ width: 90 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {draft.edges.map((e) => (
                <tr key={`${e.from}|${e.to}`}>
                  <td><code className="k">{e.from}</code></td>
                  <td><code className="k">{e.to}</code></td>
                  <td>
                    <input type="number" min="1" step="1" value={e.minutes} style={{ width: 90 }}
                      onChange={(ev) => updateEdge(e, { minutes: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={!!e.has_steps}
                      onChange={(ev) => updateEdge(e, { has_steps: ev.target.checked })} />
                    <span className="muted small"> {e.has_steps ? '含台阶' : '无台阶'}</span>
                  </td>
                  <td><button className="btn danger" onClick={() => removeEdge(e.from, e.to)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>已发布版本（旧版本持续可查）</h2>
        <table>
          <thead><tr><th>版本</th><th>发布时间（本地）</th><th>说明</th></tr></thead>
          <tbody>
            {versions.slice().reverse().map((v) => (
              <tr key={v.version}>
                <td><span className="badge">v{v.version}</span></td>
                <td>{fmtLocal(v.published_at_iso)}</td>
                <td>{v.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
