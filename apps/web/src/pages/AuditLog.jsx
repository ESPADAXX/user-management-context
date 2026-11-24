import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const LABEL = {
  'user.created': 'created user', 'user.updated': 'updated', 'user.role_changed': 'changed role of',
  'user.deactivated': 'deactivated', 'user.reactivated': 'reactivated', 'invitation.created': 'invited', 'invitation.accepted': 'accepted an invitation',
};

// REQ-006: read-only, newest first.
export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 20 });
  useEffect(() => { api('GET', `/audit-events?page=${page}`).then(setData); }, [page]);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const detail = (e) => e.action === 'user.role_changed' ? `${e.details.from} → ${e.details.to}` : e.action === 'invitation.created' ? `${e.details.email} as ${e.details.role}` : e.details.role ?? '';
  return (
    <section>
      <div className="head"><div><h2>Audit log</h2><p className="muted">Every change, who made it and when. Events can never be edited or deleted.</p></div></div>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Details</th></tr></thead>
        <tbody>
          {data.items.map((e) => (
            <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.actorEmail ?? 'system'}</td><td>{LABEL[e.action] ?? e.action}</td><td>{e.targetEmail ?? ''}</td><td className="muted">{detail(e)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span>Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </section>
  );
}
