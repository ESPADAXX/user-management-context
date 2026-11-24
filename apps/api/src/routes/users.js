import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { toUser } from '../db.js';
import { record } from '../audit.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { Role, Status, Email, Name, NewPassword, pageQuery, idParam } from './schemas.js';

const CreateUser = z.object({ email: Email, name: Name, role: Role, password: NewPassword }).strict();
const UpdateUser = z.object({ name: Name }).strict();
const SetRole = z.object({ role: Role }).strict();
const Search = z.object({ q: z.string().max(100).optional(), role: Role.optional(), status: Status.optional(), ...pageQuery });

export function userRoutes(ctx) {
  const r = Router();
  const now = () => new Date(ctx.clock()).toISOString();
  const get = (id) => ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const mustGet = (id) => { const u = get(id); if (!u) throw notFound('User not found.'); return u; };
  r.use('/users', authenticate(ctx));

  // REQ-008: search the directory (admins and managers).
  r.get('/users', requireRole('admin', 'manager'), (req, res) => {
    const { q, role, status, page, pageSize } = Search.parse(req.query);
    const where = [];
    const args = [];
    if (q) { where.push("(instr(lower(name), lower(?)) > 0 OR instr(email, lower(?)) > 0)"); args.push(q, q); }
    if (role) { where.push('role = ?'); args.push(role); }
    if (status) { where.push('status = ?'); args.push(status); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM users ${w}`).get(...args).n;
    const rows = ctx.db.prepare(`SELECT * FROM users ${w} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    res.json({ items: rows.map(toUser), total, page, pageSize });
  });

  // REQ-001: create an account (admin).
  r.post('/users', requireRole('admin'), (req, res) => {
    const body = CreateUser.parse(req.body);
    const email = body.email.toLowerCase();
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('This email is already used.');
    const ts = now();
    const { lastInsertRowid } = ctx.db.prepare('INSERT INTO users (email, name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, body.name, body.role, bcrypt.hashSync(body.password, 10), ts, ts);
    const user = toUser(get(Number(lastInsertRowid)));
    record(ctx, { actorId: req.user.id, action: 'user.created', targetId: user.id, details: { role: user.role } }); // REQ-006
    ctx.realtime?.publish('user.created', user); // REQ-007
    res.status(201).json(user);
  });

  // REQ-003: members read only their own profile.
  r.get('/users/:id', (req, res) => {
    const id = idParam(req);
    if (req.user.role === 'member' && req.user.id !== id) throw forbidden('Members can only read their own profile.');
    res.json(toUser(mustGet(id)));
  });

  r.patch('/users/:id', (req, res) => {
    const id = idParam(req);
    if (req.user.role !== 'admin' && req.user.id !== id) throw forbidden('Only an admin can change another user.');
    const { name } = UpdateUser.parse(req.body);
    const before = mustGet(id);
    ctx.db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
    const user = toUser(get(id));
    record(ctx, { actorId: req.user.id, action: 'user.updated', targetId: id, details: { name: { from: before.name, to: name } } });
    ctx.realtime?.publish('user.updated', user);
    res.json(user);
  });

  // REQ-003: change a role; never leave the app without an active admin.
  r.put('/users/:id/role', requireRole('admin'), (req, res) => {
    const id = idParam(req);
    const { role } = SetRole.parse(req.body);
    const target = mustGet(id);
    if (target.role === 'admin' && role !== 'admin' && target.status === 'active') {
      const admins = ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n;
      if (admins <= 1) throw conflict('This is the last active admin.');
    }
    if (target.role !== role) {
      ctx.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now(), id);
      record(ctx, { actorId: req.user.id, action: 'user.role_changed', targetId: id, details: { from: target.role, to: role } });
    }
    const user = toUser(get(id));
    ctx.realtime?.roleChanged(user);
    ctx.realtime?.publish('user.updated', user);
    res.json(user);
  });

  // REQ-005: deactivate revokes every token (token_version + 1).
  r.post('/users/:id/deactivate', requireRole('admin'), (req, res) => {
    const id = idParam(req);
    if (id === req.user.id) throw conflict('You cannot deactivate your own account.');
    const target = mustGet(id);
    if (target.status !== 'inactive') {
      ctx.db.prepare("UPDATE users SET status = 'inactive', token_version = token_version + 1, updated_at = ? WHERE id = ?").run(now(), id);
      record(ctx, { actorId: req.user.id, action: 'user.deactivated', targetId: id });
      ctx.realtime?.disconnectUser(id);
    }
    const user = toUser(get(id));
    ctx.realtime?.publish('user.deactivated', user);
    res.json(user);
  });

  r.post('/users/:id/reactivate', requireRole('admin'), (req, res) => {
    const id = idParam(req);
    const target = mustGet(id);
    if (target.status !== 'active') {
      ctx.db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(now(), id);
      record(ctx, { actorId: req.user.id, action: 'user.reactivated', targetId: id });
    }
    const user = toUser(get(id));
    ctx.realtime?.publish('user.reactivated', user);
    res.json(user);
  });

  return r;
}
