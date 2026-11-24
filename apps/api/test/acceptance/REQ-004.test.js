import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

const HOURS = 72;
const tokenOf = (inv) => inv.acceptUrl.split('/').pop();

describe('REQ-004@v1 Invite a user', () => {
  it(`admin invites an email → 201, expiring ${HOURS} hours later`, async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const res = await t.as(admin).post('/api/invitations', { email: 'new@example.com', role: 'manager' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(Date.parse(res.body.expiresAt) - t.now()).toBe(HOURS * 3600 * 1000);
    expect(t.outbox[0].to).toBe('new@example.com');
    expect(t.outbox[0].text).toContain(res.body.acceptUrl);
  });

  it('invitee accepts → 201, account active with the invited role', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const inv = (await t.as(admin).post('/api/invitations', { email: 'new@example.com', role: 'manager' })).body;
    const res = await t.api().post(`/api/invitations/${tokenOf(inv)}/accept`).send({ name: 'Newbie', password: 'Password123!' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new@example.com', role: 'manager', status: 'active' });
    expect((await t.as(res.body.token).get('/api/auth/me')).status).toBe(200);
  });

  it(`accepting twice, or after ${HOURS} hours → 410`, async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const a = (await t.as(admin).post('/api/invitations', { email: 'a@example.com', role: 'member' })).body;
    const b = (await t.as(admin).post('/api/invitations', { email: 'b@example.com', role: 'member' })).body;
    const accept = (inv) => t.api().post(`/api/invitations/${tokenOf(inv)}/accept`).send({ name: 'X', password: 'Password123!' });
    expect((await accept(a)).status).toBe(201);
    expect((await accept(a)).status).toBe(410);
    t.advance(HOURS * 3600 * 1000);
    expect((await accept(b)).status).toBe(410);
  });

  it('inviting an email that already has an account → 409', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    expect((await t.as(admin).post('/api/invitations', { email: 'mona.manager@example.com', role: 'member' })).status).toBe(409);
  });

  it('manager or member invites → 403', async () => {
    const t = setup();
    const { manager, member } = await withRoles(t);
    expect((await t.as(manager).post('/api/invitations', { email: 'z@example.com', role: 'member' })).status).toBe(403);
    expect((await t.as(member).post('/api/invitations', { email: 'z@example.com', role: 'member' })).status).toBe(403);
  });
});
