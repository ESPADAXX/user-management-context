import React, { useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import Directory from './pages/Directory.jsx';
import Invitations from './pages/Invitations.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Profile from './pages/Profile.jsx';

const TABS = [
  { id: 'directory', label: 'Directory', roles: ['admin', 'manager'] },
  { id: 'invitations', label: 'Invitations', roles: ['admin'] },
  { id: 'audit', label: 'Audit log', roles: ['admin'] },
  { id: 'profile', label: 'My profile', roles: ['admin', 'manager', 'member'] },
];

export function Toasts({ items }) {
  return <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.kind || ''}`}>{t.text}</div>)}</div>;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [tab, setTab] = useState(null);
  const [meta, setMeta] = useState(null);
  const [toasts, setToasts] = useState([]);
  const invite = window.location.pathname.match(/^\/invite\/([a-f0-9]{64})$/)?.[1];

  const toast = useCallback((text, kind) => {
    const id = Math.random();
    setToasts((l) => [...l, { id, text, kind }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);

  const refreshMe = useCallback(() => api('GET', '/auth/me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false)), []);

  useEffect(() => {
    api('GET', '/meta').then(setMeta).catch(() => {});
    if (getToken()) refreshMe();
    const out = () => setMe(null);
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, [refreshMe]);

  const signedIn = (session) => {
    setToken(session.token);
    setMe(session.user);
    if (invite) window.history.replaceState(null, '', '/');
  };

  if (invite && !me) return <AcceptInvite token={invite} onDone={signedIn} />;
  if (loading) return null;
  if (!me) return <Login onDone={signedIn} />;

  const tabs = TABS.filter((t) => t.roles.includes(me.role));
  const current = tabs.find((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">● User Management</div>
        <nav>{tabs.map((t) => <button key={t.id} className={current === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>
        <div className="who">
          <span>{me.name}</span><span className={`role ${me.role}`}>{me.role}</span>
          <button className="link" onClick={() => { setToken(null); setMe(null); }}>Sign out</button>
        </div>
      </header>
      <main>
        {current === 'directory' && <Directory me={me} toast={toast} onMeChanged={refreshMe} />}
        {current === 'invitations' && <Invitations toast={toast} />}
        {current === 'audit' && <AuditLog />}
        {current === 'profile' && <Profile me={me} toast={toast} onSaved={refreshMe} />}
      </main>
      <footer>Built from context v{meta?.contextVersion ?? '?'} · requirements {meta ? Object.entries(meta.requirements).map(([k, v]) => `${k}@v${v}`).join(' ') : ''}</footer>
      <Toasts items={toasts} />
    </div>
  );
}
