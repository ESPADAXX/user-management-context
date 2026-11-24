import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from '../api.js';
import { Field, fieldErrors } from './Field.jsx';

const ROLES = ['admin', 'manager', 'member'];

// REQ-008 search, REQ-007 live updates, REQ-001 create, REQ-003 roles, REQ-005 deactivate.
export default function Directory({ me, toast, onMeChanged }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page: 1, pageSize: 20 });
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState({});
  const [creating, setCreating] = useState(false);
  const isAdmin = me.role === 'admin';
  const query = useMemo(() => new URLSearchParams({ ...(q && { q }), ...(role && { role }), ...(status && { status }), page: String(page) }).toString(), [q, role, status, page]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = () => api('GET', `/users?${queryRef.current}`).then(setData).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [query]);

  // Live directory: any change by anyone re-loads the current page.
  useEffect(() => {
    const socket = io({ auth: { token: getToken() } });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    const onEvent = (label) => (u) => {
      load();
      if (u?.id) { setFlash((f) => ({ ...f, [u.id]: true })); setTimeout(() => setFlash((f) => ({ ...f, [u.id]: false })), 2000); }
      if (u?.id === me.id) onMeChanged();
      toast(`${label}: ${u.email}`);
    };
    socket.on('user.created', onEvent('New user'));
    socket.on('user.updated', onEvent('Updated'));
    socket.on('user.deactivated', onEvent('Deactivated'));
    socket.on('user.reactivated', onEvent('Reactivated'));
    socket.on('invitation.created', (i) => toast(`Invitation sent to ${i.email}`));
    return () => socket.close();
  }, []);

  const act = async (fn, okText) => {
    try { await fn(); if (okText) toast(okText); load(); } catch (e) { toast(e.message, 'bad'); }
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section>
      <div className="head">
        <div>
          <h2>Directory <span className={`live ${live ? 'on' : ''}`}>{live ? '● live' : '○ offline'}</span></h2>
          <p className="muted">{data.total} user(s). Changes made by anyone appear here within seconds.</p>
        </div>
        {isAdmin && <button className="primary" onClick={() => setCreating(true)}>+ New user</button>}
      </div>
      <div className="filters">
        <input placeholder="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option><option>active</option><option>inactive</option></select>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{isAdmin && <th />}</tr></thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id} className={`${flash[u.id] ? 'flash' : ''} ${u.status === 'inactive' ? 'dim' : ''}`}>
              <td>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</td>
              <td>{u.email}</td>
              <td>
                {isAdmin
                  ? <select value={u.role} onChange={(e) => act(() => api('PUT', `/users/${u.id}/role`, { role: e.target.value }), `${u.email} is now ${e.target.value}`)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                  : <span className={`role ${u.role}`}>{u.role}</span>}
              </td>
              <td><span className={`status ${u.status}`}>{u.status}</span></td>
              {isAdmin && <td className="right">
                {u.status === 'active'
                  ? <button disabled={u.id === me.id} onClick={() => act(() => api('POST', `/users/${u.id}/deactivate`), `${u.email} deactivated`)}>Deactivate</button>
                  : <button onClick={() => act(() => api('POST', `/users/${u.id}/reactivate`), `${u.email} reactivated`)}>Reactivate</button>}
              </td>}
            </tr>
          ))}
          {!data.items.length && <tr><td colSpan="5" className="muted center-text">No user matches.</td></tr>}
        </tbody>
      </table>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span>Page {data.page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
      {creating && <CreateUser onClose={() => setCreating(false)} onCreated={(u) => { setCreating(false); toast(`${u.email} created`); load(); }} />}
    </section>
  );
}

function CreateUser({ onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'member', password: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try { onCreated(await api('POST', '/users', form)); } catch (err) { setError(err); }
  };
  const fe = fieldErrors(error);
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={submit}>
        <h2>New user</h2>
        <Field label="Email" error={fe.email}><input type="email" value={form.email} onChange={set('email')} required autoFocus /></Field>
        <Field label="Name" error={fe.name}><input value={form.name} onChange={set('name')} required /></Field>
        <Field label="Role"><select value={form.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Temporary password (10+ characters)" error={fe.password}><input type="password" value={form.password} onChange={set('password')} required /></Field>
        {error && !error.errors.length && <div className="alert">{error.message}</div>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create</button></div>
      </form>
    </div>
  );
}
