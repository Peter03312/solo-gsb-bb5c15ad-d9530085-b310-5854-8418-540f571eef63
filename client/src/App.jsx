import React, { useState } from 'react';
import QueryPage from './pages/QueryPage.jsx';
import DraftPage from './pages/DraftPage.jsx';
import ClosuresPage from './pages/ClosuresPage.jsx';
import VersionsPage from './pages/VersionsPage.jsx';

const TABS = [
  { key: 'query', label: '路线查询' },
  { key: 'draft', label: '路网维护' },
  { key: 'closures', label: '临时封闭' },
  { key: 'versions', label: '历史版本' },
];

export default function App() {
  const [tab, setTab] = useState('query');
  return (
    <div className="app">
      <header>
        <h1>园区无障碍通行</h1>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'tab active' : 'tab'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'query' && <QueryPage />}
        {tab === 'draft' && <DraftPage />}
        {tab === 'closures' && <ClosuresPage />}
        {tab === 'versions' && <VersionsPage />}
      </main>
    </div>
  );
}
