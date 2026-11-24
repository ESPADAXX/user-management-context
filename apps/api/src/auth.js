// Tokens and permissions (ADR-002).
import jwt from 'jsonwebtoken';
import { unauthorized, forbidden } from './errors.js';

export const TOKEN_HOURS = 8; // REQ-002

export function issueToken(ctx, user) {
  const iat = Math.floor(ctx.clock() / 1000);
  const token = jwt.sign({ sub: String(user.id), tv: user.token_version, iat }, ctx.jwtSecret, { expiresIn: `${TOKEN_HOURS}h`, algorithm: 'HS256' });
  return { token, expiresAt: new Date((iat + TOKEN_HOURS * 3600) * 1000).toISOString() };
}

// Loads the user on every request, so role and status changes apply at once (REQ-003, REQ-005).
export function userFromToken(ctx, token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, ctx.jwtSecret, { algorithms: ['HS256'], clockTimestamp: Math.floor(ctx.clock() / 1000) });
  } catch {
    return null;
  }
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
  if (!row || row.status !== 'active' || row.token_version !== payload.tv) return null;
  return row;
}

export const authenticate = (ctx) => (req, _res, next) => {
  const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const user = userFromToken(ctx, m?.[1]);
  if (!user) return next(unauthorized(m ? 'The token is invalid, expired or revoked.' : 'A bearer token is required.'));
  req.user = user;
  next();
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(forbidden(`Only ${roles.join(' or ')} can do this.`));
  next();
};
