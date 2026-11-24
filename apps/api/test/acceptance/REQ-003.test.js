import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

describe('REQ-003@v1 Roles and permissions', () => {
  it("admin sets a role → 200, and the user's next request uses the new role", async () => {
    const t = setup();
    const { admin, member } = await withRoles(t);
    const me = (await t.as(member).get('/api/auth/me')).body;
    expect((await t.as(member).get('/api/users')).status).toBe(403);
    const res = await t.as(admin).put(`/api/users/${me.id}/role`, { role: 'manager' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('manager');
    expect((await t.as(member).get('/api/users')).status).toBe(200); // same token, new role
  });

  it('manager or member changes a role → 403', async () => {
    const t = setup();
    const { manager, member } = await withRoles(t);
    expect((await t.as(manager).put('/api/users/1/role', { role: 'member' })).status).toBe(403);
    expect((await t.as(member).put('/api/users/1/role', { role: 'member' })).status).toBe(403);
  });

  it('demoting the last active admin → 409', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    expect((await t.as(admin).put('/api/users/1/role', { role: 'member' })).status).toBe(409);
  });

  it("member reads another user's profile → 403, and reads their own → 200", async () => {
    const t = setup();
    const { member } = await withRoles(t);
    const me = (await t.as(member).get('/api/auth/me')).body;
    expect((await t.as(member).get('/api/users/1')).status).toBe(403);
    expect((await t.as(member).get(`/api/users/${me.id}`)).status).toBe(200);
  });
});
