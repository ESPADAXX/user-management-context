import request from 'supertest';
import { createApp } from '../src/app.js';

export const ADMIN = { email: 'admin@example.com', password: 'ChangeMe123!' };

// A fresh in-memory app with a controllable clock and a captured mailbox.
export function setup() {
  let now = Date.parse('2026-11-24T09:00:00Z');
  const outbox = [];
  const built = createApp({
    databasePath: ':memory:',
    jwtSecret: 'test-secret',
    clock: () => now,
    admin: ADMIN,
    publicUrl: 'http://app.test',
    manifest: { contextVersion: 1, requirements: {} },
    mailer: { send: async (m) => { outbox.push(m); } },
    rateLimit: { windowMs: 1000, max: 0 },
  });
  const api = () => request(built.app);
  const t = {
    ...built,
    outbox,
    api,
    advance: (ms) => { now += ms; },
    now: () => now,
    async login(email = ADMIN.email, password = ADMIN.password) {
      const res = await api().post('/api/auth/login').send({ email, password });
      return res.body.token;
    },
    async createUser(token, user) {
      const body = { name: user.email.split('@')[0], role: 'member', password: 'Password123!', ...user };
      const res = await api().post('/api/users').set('Authorization', `Bearer ${token}`).send(body);
      return res.body;
    },
    as: (token) => ({
      get: (url) => api().get(url).set('Authorization', `Bearer ${token}`),
      post: (url, body) => api().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
      put: (url, body) => api().put(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
      patch: (url, body) => api().patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
      delete: (url) => api().delete(url).set('Authorization', `Bearer ${token}`),
    }),
  };
  return t;
}

// Two users of each role, signed in.
export async function withRoles(t) {
  const admin = await t.login();
  await t.createUser(admin, { email: 'mona.manager@example.com', name: 'Mona Manager', role: 'manager' });
  await t.createUser(admin, { email: 'mehdi.member@example.com', name: 'Mehdi Member', role: 'member' });
  return {
    admin,
    manager: await t.login('mona.manager@example.com', 'Password123!'),
    member: await t.login('mehdi.member@example.com', 'Password123!'),
  };
}
