import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Visitor from './components/Visitor.jsx';
import DraftEditor from './components/DraftEditor.jsx';
import Closures from './components/Closures.jsx';

const TABS = [
  { key: 'visitor', label: '访客寻路' },
  { key: 'draft', label: '维护者 · 草稿与发布' },
  { key: 'closures', label: '维护者 · 临时封闭' }
];

export default function App() {
  const [tab, setTab] = useState('visitor');
  const [health, setHealth] = useState(null);
  const [versions, setVersions] = useState([]);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch {
      setHealth({ ok: false });
    }
  }, []);

  const refreshVersions = useCallback(async () => {
    try {
      const d = await api.versions();
      setVersions(d.versions);
    } catch {
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 15000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  return (
    <>
      <header className="topbar">
        <h1>♿ 园区无障碍通行</h1>
        <span className="meta">
          服务状态：{health?.ok ? <span style={{ color: '#a7f3d0' }}>正常</span> : <span style={{ color: '#fecaca' }}>连接中…</span>}
          {health?.latest_version ? ` · 最新路网 v${health.latest_version}` : ''}
          {health?.time ? ` · 服务器时间(UTC) ${health.time}` : ''}
        </span>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'visitor' && <Visitor versions={versions} refreshVersions={refreshVersions} />}
        {tab === 'draft' && (
          <DraftEditor
            onPublished={() => {
              refreshHealth();
              refreshVersions();
            }}
          />
        )}
        {tab === 'closures' && <Closures />}
      </main>
    </>
  );
}
