import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

describe('REQ-006@v1 Audit log', () => {
  it('creating a user, changing a role, inviting and deactivating → one audit event each, with actor, action, target and time', async () => {
    const t = setup();
    const { admin } = await withRoles(t); // creates 2 users
    const u = await t.createUser(admin, { email: 'sara@example.com' });
    await t.as(admin).put(`/api/users/${u.id}/role`, { role: 'manager' });
    await t.as(admin).post('/api/invitations', { email: 'inv@example.com', role: 'member' });
    await t.as(admin).post(`/api/users/${u.id}/deactivate`);
    const { items } = (await t.as(admin).get('/api/audit-events')).body;
    const forSara = items.filter((e) => e.targetId === u.id).map((e) => e.action);
    expect(forSara.sort()).toEqual(['user.created', 'user.deactivated', 'user.role_changed']);
    expect(items.filter((e) => e.action === 'invitation.created')).toHaveLength(1);
    for (const e of items) {
      expect(e.actorId).toBe(1);
      expect(e.actorEmail).toBe('admin@example.com');
      expect(Date.parse(e.createdAt)).not.toBeNaN();
    }
    expect(items.find((e) => e.action === 'user.role_changed').details).toEqual({ from: 'member', to: 'manager' });
  });

  it('admin reads the log → 200, newest first', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const res = await t.as(admin).get('/api/audit-events');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it('manager or member → 403', async () => {
    const t = setup();
    const { manager, member } = await withRoles(t);
    expect((await t.as(manager).get('/api/audit-events')).status).toBe(403);
    expect((await t.as(member).get('/api/audit-events')).status).toBe(403);
  });

  it('the API has no endpoint that updates or deletes an audit event', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    for (const method of ['put', 'patch', 'delete']) {
      expect((await t.as(admin)[method]('/api/audit-events/1')).status).toBe(404);
    }
    expect(() => t.ctx.db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
  });
});
