import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtLocal, localInputToUtc, defaultDeparture } from '../api.js';

export default function Visitor({ versions, refreshVersions }) {
  const [network, setNetwork] = useState(null);
  const [form, setForm] = useState({
    from: '',
    to: '',
    departure: defaultDeparture(),
    noSteps: true,
    version: ''
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    api
      .latestNetwork()
      .then((d) => {
        setNetwork(d);
        setForm((f) => ({
          ...f,
          from: f.from || '',
          to: f.to || ''
        }));
      })
      .catch(() => setNetwork(null));
  }, []);

  const nodeOptions = useMemo(() => (network ? network.nodes : []), [network]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!form.from || !form.to) {
      setError('请选择起点和终点。');
      return;
    }
    if (form.from === form.to) {
      setError('起点和终点不能相同。');
      return;
    }
    const depUtc = localInputToUtc(form.departure);
    if (!depUtc) {
      setError('出发时刻无效，请选择合法的日期与时间。');
      return;
    }
    setLoading(true);
    try {
      const d = await api.route({
        from: form.from,
        to: form.to,
        departure: depUtc,
        no_steps: form.noSteps ? 'true' : 'false',
        version: form.version || undefined
      });
      setResult(d);
    } catch (err) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    setForm((f) => ({ ...f, from: f.to, to: f.from }));
  }

  return (
    <div>
      <form className="card" onSubmit={submit}>
        <h2>路线查询</h2>
        <div className="grid grid-4">
          <label className="field">
            起点
            <select value={form.from} onChange={(e) => setField('from', e.target.value)}>
              <option value="">请选择起点…</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}（{n.id}）
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn" onClick={swap} title="交换起终点">
              ⇄
            </button>
          </div>
          <label className="field">
            终点
            <select value={form.to} onChange={(e) => setField('to', e.target.value)}>
              <option value="">请选择终点…</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}（{n.id}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            出发时刻（本地时间）
            <input
              type="datetime-local"
              value={form.departure}
              onChange={(e) => setField('departure', e.target.value)}
            />
          </label>
          <label className="field">
            路网版本
            <select value={form.version} onChange={(e) => setField('version', e.target.value)}>
              <option value="">最新版本{network ? `（v${network.version}）` : ''}</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {fmtLocal(v.published_at_iso)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <label className="checkline">
            <input
              type="checkbox"
              checked={form.noSteps}
              onChange={(e) => setField('noSteps', e.target.checked)}
            />
            无台阶需求（全程避开含台阶路段）
          </label>
          <div className="spacer" />
          <button className="btn primary" disabled={loading || !network}>
            {loading ? '查询中…' : '查询可行路线'}
          </button>
        </div>
        {!network && <div className="alert info" style={{ marginTop: 12 }}>尚无已发布路网，请维护者先在“草稿与发布”中发布。</div>}
      </form>

      {error && <div className="alert error">⚠ {error}</div>}

      {result && (
        <div className="card">
          <h2>
            可行路线 <span className="badge">路网 v{result.version}</span>{' '}
            <span className="muted small">该版本发布于 {fmtLocal(result.published_at_iso)}（本地时间）</span>
          </h2>
          <div className="route-summary">
            <div className="stat">
              <div className="v">{fmtLocal(result.departure_iso)}</div>
              <div className="k">出发时刻</div>
            </div>
            <div className="stat">
              <div className="v">{result.total_minutes} 分钟</div>
              <div className="k">全程用时（途中不等待）</div>
            </div>
            <div className="stat">
              <div className="v">{fmtLocal(result.arrival_iso)}</div>
              <div className="k">到达时刻</div>
            </div>
          </div>

          {result.legs.length === 0 ? (
            <div className="alert ok">起点即终点，无需通行。</div>
          ) : (
            <div>
              {result.legs.map((l, i) => (
                <div className="leg" key={i}>
                  <div className="times">
                    {fmtLocal(l.depart_at)}
                    <br />→ {fmtLocal(l.arrive_at)}
                  </div>
                  <div className="arrow">→</div>
                  <div>
                    <span className="place">{l.from_name}</span>（{l.from}） 至{' '}
                    <span className="place">{l.to_name}</span>（{l.to}）
                    <div className="muted small">
                      通行 {l.minutes} 分钟 ·{' '}
                      {l.has_steps ? <span className="badge steps">含台阶</span> : <span className="badge flat">无台阶</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="muted small" style={{ marginTop: 10 }}>
            每段行程区间均已避开临时封闭（半开区间，封闭结束当刻即可进入）；结果基于路网 v{result.version} 的一致快照。
          </div>
        </div>
      )}
    </div>
  );
}
