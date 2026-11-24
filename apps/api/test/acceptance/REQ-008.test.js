import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

describe('REQ-008@v1 Search the user directory', () => {
  it('search "ali" → users whose name or email contains "ali", in any letter case', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    await t.createUser(admin, { email: 'alice@example.com', name: 'Alice' });
    await t.createUser(admin, { email: 'k.benali@example.com', name: 'Karim' });
    await t.createUser(admin, { email: 'bob@example.com', name: 'Bob ALIOUI' });
    await t.createUser(admin, { email: 'zed@example.com', name: 'Zed' });
    const res = await t.as(admin).get('/api/users?q=ali');
    expect(res.status).toBe(200);
    expect(res.body.items.map((u) => u.email).sort()).toEqual(['alice@example.com', 'bob@example.com', 'k.benali@example.com']);
  });

  it('filter role=manager and status=active → only active managers', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const off = await t.createUser(admin, { email: 'old.manager@example.com', role: 'manager' });
    await t.as(admin).post(`/api/users/${off.id}/deactivate`);
    const res = await t.as(admin).get('/api/users?role=manager&status=active');
    expect(res.body.items.map((u) => u.email)).toEqual(['mona.manager@example.com']);
  });

  it('no page size → 20 per page, with the total count', async () => {
    const t = setup();
    const { admin, manager } = await withRoles(t);
    for (let i = 0; i < 25; i++) await t.createUser(admin, { email: `user${i}@example.com` });
    const res = await t.as(manager).get('/api/users');
    expect(res.body.items).toHaveLength(20);
    expect(res.body).toMatchObject({ total: 28, page: 1, pageSize: 20 });
  });

  it('page size above 100 → 422', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    expect((await t.as(admin).get('/api/users?pageSize=101')).status).toBe(422);
  });

  it('member → 403', async () => {
    const t = setup();
    const { member } = await withRoles(t);
    expect((await t.as(member).get('/api/users')).status).toBe(403);
  });
});
