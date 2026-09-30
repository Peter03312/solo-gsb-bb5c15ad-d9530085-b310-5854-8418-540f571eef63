import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtLocal, localInputToUtc } from '../api.js';

export default function Closures() {
  const [network, setNetwork] = useState(null);
  const [closures, setClosures] = useState([]);
  const [form, setForm] = useState({ from: '', to: '', start: '', end: '', reason: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, c] = await Promise.all([api.latestNetwork(), api.closures()]);
      setNetwork(n);
      setClosures(c.closures);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 选择起点后，终点下拉只列出存在的有向路段
  const tos = (form.from && network
    ? network.edges.filter((e) => e.from === form.from).map((e) => e.to)
    : []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!form.from || !form.to) { setError('请选择要封闭的有向路段。'); return; }
    const start = localInputToUtc(form.start);
    const end = localInputToUtc(form.end);
    if (!start || !end) { setError('起止时刻无效。'); return; }
    if (end <= start) { setError('结束时刻必须晚于开始时刻。'); return; }
    setBusy(true);
    try {
      const r = await api.addClosure({ from: form.from, to: form.to, start, end, reason: form.reason.trim() });
      setMsg(`封闭已登记：${r.from} -> ${r.to}，${fmtLocal(r.start_iso)} 至 ${fmtLocal(r.end_iso)}。登记后的查询立即生效。`);
      setForm((f) => ({ ...f, start: '', end: '', reason: '' }));
      await load();
    } catch (e2) {
      setError('登记失败：' + (e2.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await api.deleteClosure(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <form className="card" onSubmit={submit}>
        <h2>登记临时封闭</h2>
        <p className="muted small">
          针对当前最新路网中的某条<strong>有向路段</strong>，登记封闭起止时刻。封闭为半开区间 <code className="k">[开始, 结束)</code>：
          路段通行全程与之重叠的路线将被排除；结束当刻即可进入。登记成功后访客查询立即生效。
          已登记且未结束封闭的路段不允许在发布时被删除。
        </p>
        <div className="grid grid-4">
          <label className="field">
            路段起点
            <select value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value, to: '' }))}>
              <option value="">请选择…</option>
              {(network?.nodes || []).map((n) => (
                <option key={n.id} value={n.id}>{n.name}（{n.id}）</option>
              ))}
            </select>
          </label>
          <label className="field">
            路段终点（仅有向相连）
            <select value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} disabled={!form.from}>
              <option value="">请选择…</option>
              {tos.map((id) => {
                const node = network.nodes.find((n) => n.id === id);
                return <option key={id} value={id}>{node ? `${node.name}（${id}）` : id}</option>;
              })}
            </select>
          </label>
          <label className="field">
            开始时刻（本地）
            <input type="datetime-local" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
          </label>
          <label className="field">
            结束时刻（本地）
            <input type="datetime-local" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            事由（可选）
            <input type="text" value={form.reason} maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="如：道路施工、活动管制" />
          </label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy || !network}>{busy ? '提交中…' : '登记封闭'}</button>
          {!network && <span className="muted small">尚无已发布路网。</span>}
        </div>
        {error && <div className="alert error">⚠ {error}</div>}
        {msg && <div className="alert ok">✔ {msg}</div>}
      </form>

      <div className="card">
        <h2>封闭记录（{closures.length}）</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>有向路段</th><th>开始（本地）</th><th>结束（本地）</th>
                <th>状态</th><th>事由</th><th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {closures.length === 0 && (
                <tr><td colSpan={7} className="muted">暂无封闭记录。</td></tr>
              )}
              {closures.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td><code className="k">{c.from} → {c.to}</code></td>
                  <td>{fmtLocal(c.start_iso)}</td>
                  <td>{fmtLocal(c.end_iso)}</td>
                  <td>{c.ended ? <span className="badge ended">已结束</span> : <span className="badge closed">封闭中</span>}</td>
                  <td>{c.reason || <span className="muted">—</span>}</td>
                  <td><button className="btn danger" onClick={() => remove(c.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          提示：删除封闭记录会立刻解除该时段限制（用于误登记的撤销）。
          页面当前时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}；提交时按本地时间换算为 UTC 存储。
        </p>
      </div>
    </div>
  );
}
