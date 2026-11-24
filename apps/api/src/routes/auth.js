import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Problem, unauthorized, forbidden } from '../errors.js';
import { issueToken, authenticate } from '../auth.js';
import { toUser } from '../db.js';
import { Email } from './schemas.js';

// REQ-002 v2: lock sign-in after 5 failures within 15 minutes, for 15 minutes.
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

const LoginBody = z.object({ email: Email, password: z.string().min(1).max(400) }).strict();
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

export function lockedUntil(ctx, email) {
  const last = ctx.db.prepare('SELECT attempted_at FROM login_attempts WHERE email = ? ORDER BY attempted_at DESC LIMIT ?').all(email, MAX_FAILURES);
  if (last.length < MAX_FAILURES) return null;
  const newest = last[0].attempted_at;
  const oldest = last[last.length - 1].attempted_at;
  if (newest - oldest > WINDOW_MS) return null;
  const until = newest + LOCK_MS;
  return ctx.clock() < until ? until : null;
}

export function authRoutes(ctx) {
  const r = Router();

  r.post('/auth/login', (req, res) => {
    const { email: rawEmail, password } = LoginBody.parse(req.body);
    const email = rawEmail.toLowerCase();
    const until = lockedUntil(ctx, email);
    if (until) {
      const minutes = Math.ceil((until - ctx.clock()) / 60000);
      throw new Problem(423, 'Locked', `Too many failed attempts. Try again in ${minutes} minute(s).`);
    }
    const row = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = bcrypt.compareSync(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !valid) {
      ctx.db.prepare('INSERT INTO login_attempts (email, attempted_at) VALUES (?, ?)').run(email, ctx.clock());
      throw unauthorized('Wrong email or password.'); // same message for unknown email (REQ-002)
    }
    if (row.status !== 'active') throw forbidden('This account is deactivated.'); // REQ-005
    ctx.db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
    res.json({ ...issueToken(ctx, row), user: toUser(row) });
  });

  r.get('/auth/me', authenticate(ctx), (req, res) => res.json(toUser(req.user)));

  return r;
}
