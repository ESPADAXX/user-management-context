import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, fieldErrors } from './Field.jsx';

// REQ-004: the invitee creates their own account from a single-use link.
export default function AcceptInvite({ token, onDone }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone(await api('POST', `/invitations/${token}/accept`, { name, password }));
    } catch (err) {
      setError(err);
    }
  };
  const fe = fieldErrors(error);

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1>Join the team</h1>
        <p className="muted">Choose your name and a password to finish creating your account.</p>
        <Field label="Your name" error={fe.name}><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="Password (10 characters or more)" error={fe.password}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && !error.errors.length && <div className="alert">{error.message}</div>}
        <button className="primary">Create my account</button>
      </form>
    </div>
  );
}
