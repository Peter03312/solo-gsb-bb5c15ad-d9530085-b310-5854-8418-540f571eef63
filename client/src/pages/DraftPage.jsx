import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyNode = () => ({ id: '', name: '' });
const emptySeg = () => ({ id: '', from: '', to: '', minutes: 5, hasSteps: false });

export default function DraftPage() {
  const [nodes, setNodes] = useState([]);
  const [segments, setSegments] = useState([]);
  const [msg, setMsg] = useState(null); // { type: 'ok'|'error', text, errors? }
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const d = await api.getDraft();
      setNodes(d.nodes);
      setSegments(d.segments);
      setDirty(false);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  async function save() {
    setMsg(null);
    try {
      const payload = {
        nodes: nodes.map((n) => ({ id: n.id, name: n.name })),
        segments: segments.map((s) => ({
          id: s.id,
          from: s.from,
          to: s.to,
          minutes: Number(s.minutes),
          hasSteps: !!s.hasSteps,
        })),
      };
      const d = await api.saveDraft(payload);
      setMsg({ type: 'ok', text: `草稿已保存（${d.nodeCount} 节点 / ${d.segmentCount} 路段）` });
      setDirty(false);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  async function publish() {
    setMsg(null);
    try {
      if (dirty) await save();
      const d = await api.publish();
      setMsg({ type: 'ok', text: `发布成功：版本 ${d.version}（${d.publishedAt}）` });
    } catch (e) {
      setMsg({ type: 'error', text: e.message, errors: e.errors });
    }
  }

  const setNode = (i, patch) => {
    const next = nodes.slice();
    next[i] = { ...next[i], ...patch };
    setNodes(next);
    setDirty(true);
  };
  const setSeg = (i, patch) => {
    const next = segments.slice();
    next[i] = { ...next[i], ...patch };
    setSegments(next);
    setDirty(true);
  };

  return (
    <section>
      <h2>路网维护（草稿）</h2>
      <p className="hint">编辑草稿不会影响线上查询；点击「发布」后整体生效为一个新版本，旧版本仍可查询。</p>

      {msg && (
        <div className={`alert ${msg.type}`}>
          {msg.text}
          {msg.errors && (
            <ul>{msg.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      <div className="card">
        <h3>节点</h3>
        <table>
          <thead><tr><th>节点 id</th><th>名称</th><th></th></tr></thead>
          <tbody>
            {nodes.map((n, i) => (
              <tr key={i}>
                <td><input value={n.id} onChange={(e) => setNode(i, { id: e.target.value })} placeholder="如 LIB" /></td>
                <td><input value={n.name} onChange={(e) => setNode(i, { name: e.target.value })} placeholder="如 图书馆" /></td>
                <td><button className="danger" onClick={() => { setNodes(nodes.filter((_, j) => j !== i)); setDirty(true); }}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => { setNodes([...nodes, emptyNode()]); setDirty(true); }}>+ 添加节点</button>
      </div>

      <div className="card">
        <h3>有向路段</h3>
        <table>
          <thead>
            <tr><th>路段 id</th><th>起点</th><th>终点</th><th>通行分钟</th><th>含台阶</th><th></th></tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i}>
                <td><input value={s.id} onChange={(e) => setSeg(i, { id: e.target.value })} placeholder="如 S_LIB_TEACH" /></td>
                <td><input value={s.from} onChange={(e) => setSeg(i, { from: e.target.value })} placeholder="节点 id" /></td>
                <td><input value={s.to} onChange={(e) => setSeg(i, { to: e.target.value })} placeholder="节点 id" /></td>
                <td><input type="number" min="0" step="1" value={s.minutes} onChange={(e) => setSeg(i, { minutes: e.target.value })} style={{ width: '6em' }} /></td>
                <td><input type="checkbox" checked={!!s.hasSteps} onChange={(e) => setSeg(i, { hasSteps: e.target.checked })} /></td>
                <td><button className="danger" onClick={() => { setSegments(segments.filter((_, j) => j !== i)); setDirty(true); }}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => { setSegments([...segments, emptySeg()]); setDirty(true); }}>+ 添加路段</button>
      </div>

      <div className="actions">
        <button onClick={save}>保存草稿</button>
        <button className="primary" onClick={publish}>发布新版本</button>
        <button onClick={load}>放弃修改并重载</button>
      </div>
    </section>
  );
}
