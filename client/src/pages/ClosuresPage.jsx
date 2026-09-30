import React, { useEffect, useState } from 'react';
import { api, localToIso, fmtTime } from '../api.js';

export default function ClosuresPage() {
  const [closures, setClosures] = useState([]);
  const [segments, setSegments] = useState([]);
  const [form, setForm] = useState({ segmentId: '', start: '', end: '', note: '' });
  const [msg, setMsg] = useState(null);

  async function load() {
    try {
      const [c, v] = await Promise.all([api.getClosures(), api.getVersions()]);
      setClosures(c.closures);
      if (v.versions.length > 0) {
        const detail = await api.getVersion(v.versions[0].id);
        setSegments(detail.segments);
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const start = localToIso(form.start);
    const end = localToIso(form.end);
    if (!start || !end) {
      setMsg({ type: 'error', text: '请填写有效的起止时刻' });
      return;
    }
    try {
      await api.addClosure({ segmentId: form.segmentId, start, end, note: form.note });
      setMsg({ type: 'ok', text: '封闭登记成功，即刻对查询生效' });
      setForm({ segmentId: '', start: '', end: '', note: '' });
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  }

  return (
    <section>
      <h2>临时封闭登记</h2>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <form className="card form" onSubmit={submit}>
        <label>
          路段（最新发布版本）
          <select value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })} required>
            <option value="">请选择</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>{s.id}（{s.from} → {s.to}）</option>
            ))}
          </select>
        </label>
        <label>
          封闭开始
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required />
        </label>
        <label>
          封闭结束
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required />
        </label>
        <label>
          备注
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="如 施工维修" />
        </label>
        <button type="submit" className="primary">登记封闭</button>
      </form>

      <div className="card">
        <h3>封闭记录</h3>
        <table>
          <thead>
            <tr><th>#</th><th>路段</th><th>开始</th><th>结束</th><th>状态</th><th>备注</th></tr>
          </thead>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'muted'}>
                <td>{c.id}</td>
                <td>{c.segmentId}</td>
                <td>{fmtTime(c.start)}</td>
                <td>{fmtTime(c.end)}</td>
                <td>{c.active ? '未结束' : '已结束'}</td>
                <td>{c.note}</td>
              </tr>
            ))}
            {closures.length === 0 && <tr><td colSpan="6">暂无封闭记录</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
