import { describe, it, expect } from 'vitest';
import { setup, ADMIN } from '../helpers.js';

const login = (t, password, email = ADMIN.email) => t.api().post('/api/auth/login').send({ email, password });

describe('REQ-002@v2 Sign in', () => {
  it('right credentials → 200 with a token, and GET /auth/me with that token → 200', async () => {
    const t = setup();
    const res = await login(t, ADMIN.password);
    expect(res.status).toBe(200);
    expect(Date.parse(res.body.expiresAt) - t.now()).toBe(8 * 3600 * 1000);
    const me = await t.as(res.body.token).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(ADMIN.email);
  });

  it('wrong password → 401, with the same message as an unknown email', async () => {
    const t = setup();
    const wrong = await login(t, 'nope-nope-nope');
    const unknown = await login(t, 'nope-nope-nope', 'ghost@example.com');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.detail).toBe(unknown.body.detail);
  });

  it('5 failures within 15 minutes → the next attempt returns 423, even with the right password', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) { expect((await login(t, 'wrong-password')).status).toBe(401); t.advance(60_000); }
    expect((await login(t, ADMIN.password)).status).toBe(423);
  });

  it('after the 15-minute lock, the right password → 200', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) await login(t, 'wrong-password');
    t.advance(14 * 60_000);
    expect((await login(t, ADMIN.password)).status).toBe(423);
    t.advance(60_000);
    expect((await login(t, ADMIN.password)).status).toBe(200);
  });

  it('no token or an invalid token → 401', async () => {
    const t = setup();
    expect((await t.api().get('/api/auth/me')).status).toBe(401);
    expect((await t.as('not-a-token').get('/api/auth/me')).status).toBe(401);
    const token = await t.login();
    t.advance(8 * 3600 * 1000 + 1000);
    expect((await t.as(token).get('/api/auth/me')).status).toBe(401);
  });
});
