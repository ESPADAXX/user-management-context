import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, fieldErrors } from './Field.jsx';

// REQ-003: every user can read and rename their own profile.
export default function Profile({ me, toast, onSaved }) {
  const [name, setName] = useState(me.name);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try { await api('PATCH', `/users/${me.id}`, { name }); toast('Saved'); setError(null); onSaved(); } catch (err) { setError(err); }
  };
  return (
    <section>
      <div className="head"><div><h2>My profile</h2></div></div>
      <form className="card narrow" onSubmit={save}>
        <Field label="Email"><input value={me.email} disabled /></Field>
        <Field label="Name" error={fieldErrors(error).name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role"><input value={me.role} disabled /></Field>
        <Field label="Member since"><input value={new Date(me.createdAt).toLocaleDateString()} disabled /></Field>
        <button className="primary">Save</button>
      </form>
    </section>
  );
}
