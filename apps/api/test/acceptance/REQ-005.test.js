import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

describe('REQ-005@v1 Deactivate and reactivate a user', () => {
  it('admin deactivates a user → 200, status inactive', async () => {
    const t = setup();
    const { admin, member } = await withRoles(t);
    const id = (await t.as(member).get('/api/auth/me')).body.id;
    const res = await t.as(admin).post(`/api/users/${id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  it('deactivated user signs in → 403, and their old token → 401', async () => {
    const t = setup();
    const { admin, member } = await withRoles(t);
    const id = (await t.as(member).get('/api/auth/me')).body.id;
    await t.as(admin).post(`/api/users/${id}/deactivate`);
    const login = await t.api().post('/api/auth/login').send({ email: 'mehdi.member@example.com', password: 'Password123!' });
    expect(login.status).toBe(403);
    expect((await t.as(member).get('/api/auth/me')).status).toBe(401);
  });

  it('admin deactivates their own account → 409', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    expect((await t.as(admin).post('/api/users/1/deactivate')).status).toBe(409);
  });

  it('reactivated user signs in → 200', async () => {
    const t = setup();
    const { admin, member } = await withRoles(t);
    const id = (await t.as(member).get('/api/auth/me')).body.id;
    await t.as(admin).post(`/api/users/${id}/deactivate`);
    expect((await t.as(admin).post(`/api/users/${id}/reactivate`)).body.status).toBe('active');
    const login = await t.api().post('/api/auth/login').send({ email: 'mehdi.member@example.com', password: 'Password123!' });
    expect(login.status).toBe(200);
  });
});
