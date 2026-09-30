import React, { useEffect, useState } from 'react';
import { api, localToIso, fmtTime } from '../api.js';

export default function QueryPage() {
  const [versions, setVersions] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [form, setForm] = useState({ from: '', to: '', depart: '', version: '', stepFree: false });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // 载入版本列表；默认最新版本，并加载其节点供下拉选择
  useEffect(() => {
    api.getVersions().then((d) => {
      setVersions(d.versions);
      if (d.versions.length > 0) loadNodes(d.versions[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  function loadNodes(vid) {
    api.getVersion(vid).then((d) => setNodes(d.nodes)).catch(() => setNodes([]));
  }

  function onVersionChange(v) {
    setForm({ ...form, version: v });
    if (v) loadNodes(Number(v));
    else if (versions.length > 0) loadNodes(versions[0].id);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const departIso = localToIso(form.depart);
    if (!departIso) {
      setError('请填写有效的出发时刻');
      return;
    }
    setLoading(true);
    try {
      const params = {
        from: form.from,
        to: form.to,
        depart: departIso,
        stepFree: form.stepFree ? 'true' : 'false',
      };
      if (form.version) params.version = form.version;
      const data = await api.queryRoute(params);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2>访客路线查询</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          起点
          <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required>
            <option value="">请选择</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name}（{n.id}）</option>
            ))}
          </select>
        </label>
        <label>
          终点
          <select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required>
            <option value="">请选择</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name}（{n.id}）</option>
            ))}
          </select>
        </label>
        <label>
          出发时刻
          <input
            type="datetime-local"
            value={form.depart}
            onChange={(e) => setForm({ ...form, depart: e.target.value })}
            required
          />
        </label>
        <label>
          路网版本（留空用最新）
          <select value={form.version} onChange={(e) => onVersionChange(e.target.value)}>
            <option value="">最新版本</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>版本 {v.id}（{fmtTime(v.publishedAt)}）</option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.stepFree}
            onChange={(e) => setForm({ ...form, stepFree: e.target.checked })}
          />
          需要全程无台阶
        </label>
        <button type="submit" disabled={loading}>{loading ? '查询中…' : '查询路线'}</button>
      </form>

      {error && <div className="alert error">⚠ {error}</div>}

      {result && (
        <div className="card">
          <h3>可行路线（路网版本 {result.version}）</h3>
          <p>
            出发：<b>{fmtTime(result.depart)}</b>　到达：<b>{fmtTime(result.arrive)}</b>
            全程 <b>{result.totalMinutes}</b> 分钟{result.stepFree ? '（无台阶）' : ''}
          </p>
          {result.legs.length === 0 ? (
            <p>起点即终点，无需通行。</p>
          ) : (
            <table>
              <thead>
                <tr><th>#</th><th>路段</th><th>从</th><th>到</th><th>进入时刻</th><th>到达时刻</th><th>分钟</th><th>台阶</th></tr>
              </thead>
              <tbody>
                {result.legs.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{l.segment}</td>
                    <td>{l.fromName}</td>
                    <td>{l.toName}</td>
                    <td>{fmtTime(l.depart)}</td>
                    <td>{fmtTime(l.arrive)}</td>
                    <td>{l.minutes}</td>
                    <td>{l.hasSteps ? '有' : '无'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
