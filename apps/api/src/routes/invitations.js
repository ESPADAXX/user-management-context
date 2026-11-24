import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, requireRole, issueToken } from '../auth.js';
import { toUser } from '../db.js';
import { record } from '../audit.js';
import { Problem, conflict, notFound } from '../errors.js';
import { Role, Email, Name, NewPassword } from './schemas.js';

export const INVITATION_HOURS = 72; // REQ-004 v1

const CreateInvitation = z.object({ email: Email, role: Role }).strict();
const AcceptInvitation = z.object({ name: Name, password: NewPassword }).strict();

export function invitationRoutes(ctx) {
  const r = Router();
  const nowIso = () => new Date(ctx.clock()).toISOString();
  const statusOf = (row) => (row.accepted_at ? 'accepted' : Date.parse(row.expires_at) <= ctx.clock() ? 'expired' : 'pending');
  const toInvitation = (row) => ({
    id: row.id, email: row.email, role: row.role, status: statusOf(row),
    expiresAt: row.expires_at, createdAt: row.created_at, invitedBy: row.invited_by,
  });

  r.get('/invitations', authenticate(ctx), requireRole('admin'), (_req, res) => {
    res.json(ctx.db.prepare('SELECT * FROM invitations ORDER BY id DESC').all().map(toInvitation));
  });

  // REQ-004: single-use link valid for 72 hours.
  r.post('/invitations', authenticate(ctx), requireRole('admin'), async (req, res, next) => {
    try {
      const body = CreateInvitation.parse(req.body);
      const email = body.email.toLowerCase();
      if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('This email already has an account.');
      const pending = ctx.db.prepare('SELECT * FROM invitations WHERE email = ? AND accepted_at IS NULL').all(email).filter((i) => statusOf(i) === 'pending');
      if (pending.length) throw conflict('This email already has a pending invitation.');
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(ctx.clock() + INVITATION_HOURS * 3600 * 1000).toISOString();
      const { lastInsertRowid } = ctx.db.prepare('INSERT INTO invitations (token, email, role, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(token, email, body.role, req.user.id, expiresAt, nowIso());
      const invitation = toInvitation(ctx.db.prepare('SELECT * FROM invitations WHERE id = ?').get(Number(lastInsertRowid)));
      const origin = ctx.publicUrl || `${req.protocol}://${req.get('host')}`;
      const acceptUrl = `${origin}/invite/${token}`;
      await ctx.mailer.send({ to: email, subject: 'You are invited', text: `You were invited as ${body.role}. Accept within ${INVITATION_HOURS} hours: ${acceptUrl}` });
      record(ctx, { actorId: req.user.id, action: 'invitation.created', details: { email, role: body.role } }); // REQ-006
      ctx.realtime?.publish('invitation.created', invitation); // REQ-007
      res.status(201).json({ ...invitation, acceptUrl });
    } catch (e) { next(e); }
  });

  r.post('/invitations/:token/accept', (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.token)) throw notFound('Invitation not found.');
    const inv = ctx.db.prepare('SELECT * FROM invitations WHERE token = ?').get(req.params.token);
    if (!inv) throw notFound('Invitation not found.');
    if (statusOf(inv) !== 'pending') throw new Problem(410, 'Gone', inv.accepted_at ? 'This invitation was already used.' : 'This invitation has expired.');
    const { name, password } = AcceptInvitation.parse(req.body);
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(inv.email)) throw conflict('This email already has an account.');
    const ts = nowIso();
    const { lastInsertRowid } = ctx.db.prepare('INSERT INTO users (email, name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(inv.email, name, inv.role, bcrypt.hashSync(password, 10), ts, ts);
    ctx.db.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?').run(ts, inv.id);
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid));
    record(ctx, { actorId: row.id, action: 'invitation.accepted', targetId: row.id, details: { invitationId: inv.id, role: inv.role } });
    ctx.realtime?.publish('user.created', toUser(row));
    res.status(201).json({ ...issueToken(ctx, row), user: toUser(row) });
  });

  return r;
}
