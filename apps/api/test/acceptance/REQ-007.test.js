import { describe, it, expect, afterEach } from 'vitest';
import { io as connect } from 'socket.io-client';
import { setup, withRoles } from '../helpers.js';

const open = [];
afterEach(async () => {
  for (const c of open.splice(0)) c.close();
});

async function listen(t) {
  if (!t.server.listening) await new Promise((r) => t.server.listen(0, r));
  return `http://localhost:${t.server.address().port}`;
}

function client(url, token) {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  open.push(s);
  return s;
}
const ready = (s) => new Promise((resolve, reject) => { s.on('ready', resolve); s.on('connect_error', reject); });

describe('REQ-007@v1 Live user directory', () => {
  it('admin creates a user → connected admins and managers receive user.created within 2 seconds', async () => {
    const t = setup();
    const { admin, manager } = await withRoles(t);
    const url = await listen(t);
    const a = client(url, admin);
    const m = client(url, manager);
    await Promise.all([ready(a), ready(m)]);
    const got = (s) => new Promise((resolve) => s.on('user.created', (u) => resolve({ u, at: Date.now() })));
    const start = Date.now();
    const both = Promise.all([got(a), got(m)]);
    await t.createUser(admin, { email: 'live@example.com' });
    const [ra, rm] = await both;
    expect(ra.u.email).toBe('live@example.com');
    expect(rm.u.email).toBe('live@example.com');
    expect(Math.max(ra.at, rm.at) - start).toBeLessThan(2000);
    t.io.close();
  });

  it('a connected member receives no directory events', async () => {
    const t = setup();
    const { admin, member } = await withRoles(t);
    const url = await listen(t);
    const mb = client(url, member);
    const ad = client(url, admin);
    await Promise.all([ready(mb), ready(ad)]);
    let leaked = false;
    mb.onAny(() => { leaked = true; });
    const adminGot = new Promise((r) => ad.on('user.created', r));
    await t.createUser(admin, { email: 'secret@example.com' });
    await adminGot;
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
    t.io.close();
  });

  it('a connection without a valid token is refused', async () => {
    const t = setup();
    const url = await listen(t);
    const s = client(url, 'bad-token');
    await expect(ready(s)).rejects.toThrow(/unauthorized/);
    t.io.close();
  });
});
