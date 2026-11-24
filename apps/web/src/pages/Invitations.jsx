import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, fieldErrors } from './Field.jsx';

// REQ-004: invite by email; the link works once, until it expires.
export default function Invitations({ toast }) {
  const [list, setList] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState(null);
  const [last, setLast] = useState(null);
  const load = () => api('GET', '/invitations').then(setList).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const inv = await api('POST', '/invitations', { email, role });
      setLast(inv);
      setEmail('');
      toast(`Invitation sent to ${inv.email}`);
      load();
    } catch (err) { setError(err); }
  };
  const fe = fieldErrors(error);

  return (
    <section>
      <div className="head"><div><h2>Invitations</h2><p className="muted">Each link works once and expires.</p></div></div>
      <form className="card row" onSubmit={submit}>
        <Field label="Email" error={fe.email}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}><option>member</option><option>manager</option><option>admin</option></select></Field>
        <button className="primary">Send invitation</button>
      </form>
      {error && !error.errors.length && <div className="alert">{error.message}</div>}
      {last && <div className="card note">Link for <b>{last.email}</b> (also emailed): <code>{last.acceptUrl}</code> <button onClick={() => navigator.clipboard?.writeText(last.acceptUrl)}>Copy</button></div>}
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th></tr></thead>
        <tbody>
          {list.map((i) => <tr key={i.id}><td>{i.email}</td><td><span className={`role ${i.role}`}>{i.role}</span></td><td><span className={`status ${i.status}`}>{i.status}</span></td><td>{new Date(i.expiresAt).toLocaleString()}</td></tr>)}
          {!list.length && <tr><td colSpan="4" className="muted center-text">No invitations yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
