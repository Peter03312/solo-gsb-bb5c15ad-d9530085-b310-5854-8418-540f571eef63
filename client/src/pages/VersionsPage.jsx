import React, { useEffect, useState } from 'react';
import { api, fmtTime } from '../api.js';

export default function VersionsPage() {
  const [versions, setVersions] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getVersions().then((d) => setVersions(d.versions)).catch((e) => setError(e.message));
  }, []);

  async function show(id) {
    setError(null);
    try {
      setDetail(await api.getVersion(id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <h2>历史版本</h2>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr><th>版本</th><th>发布时间</th><th>节点数</th><th>路段数</th><th></th></tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.id}</td>
                <td>{fmtTime(v.publishedAt)}</td>
                <td>{v.nodeCount}</td>
                <td>{v.segmentCount}</td>
                <td><button onClick={() => show(v.id)}>查看</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card">
          <h3>版本 {detail.version.id} 详情（发布于 {fmtTime(detail.version.publishedAt)}）</h3>
          <h4>节点</h4>
          <p>{detail.nodes.map((n) => `${n.name}(${n.id})`).join('、') || '无'}</p>
          <h4>路段</h4>
          <table>
            <thead>
              <tr><th>id</th><th>起点</th><th>终点</th><th>分钟</th><th>台阶</th></tr>
            </thead>
            <tbody>
              {detail.segments.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td><td>{s.from}</td><td>{s.to}</td><td>{s.minutes}</td><td>{s.hasSteps ? '有' : '无'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
