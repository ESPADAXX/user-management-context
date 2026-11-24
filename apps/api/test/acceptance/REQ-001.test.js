import { describe, it, expect } from 'vitest';
import { setup, withRoles } from '../helpers.js';

describe('REQ-001@v1 Create a user account', () => {
  it('admin creates a valid user → 201, status active, no password in the response', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const res = await t.as(admin).post('/api/users', { email: 'Sara@Example.com', name: 'Sara', role: 'member', password: 'Password123!' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'sara@example.com', name: 'Sara', role: 'member', status: 'active' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('email already used, in any letter case → 409', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const res = await t.as(admin).post('/api/users', { email: 'MONA.MANAGER@example.com', name: 'Dup', role: 'member', password: 'Password123!' });
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('password shorter than 10 characters or invalid email → 422', async () => {
    const t = setup();
    const { admin } = await withRoles(t);
    const short = await t.as(admin).post('/api/users', { email: 'x@example.com', name: 'X', role: 'member', password: 'short' });
    expect(short.status).toBe(422);
    expect(short.body.errors[0].field).toBe('password');
    const bad = await t.as(admin).post('/api/users', { email: 'not-an-email', name: 'X', role: 'member', password: 'Password123!' });
    expect(bad.status).toBe(422);
  });

  it('manager or member → 403', async () => {
    const t = setup();
    const { manager, member } = await withRoles(t);
    const body = { email: 'y@example.com', name: 'Y', role: 'member', password: 'Password123!' };
    expect((await t.as(manager).post('/api/users', body)).status).toBe(403);
    expect((await t.as(member).post('/api/users', body)).status).toBe(403);
  });
});
