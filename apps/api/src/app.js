// Builds the API: REST routes under /api, Socket.IO live events, and (in production) the web app.
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase, ensureAdmin } from './db.js';
import { errorHandler, sendProblem } from './errors.js';
import { attachRealtime } from './realtime.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { invitationRoutes } from './routes/invitations.js';
import { auditRoutes } from './routes/audit.js';
import { metaRoutes } from './routes/meta.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../..');

function readManifest(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Simple fixed-window limiter per IP (threat model: API4).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    if (!max) return next();
    const now = Date.now();
    const key = req.ip;
    const e = hits.get(key);
    if (!e || now - e.start >= windowMs) hits.set(key, { start: now, n: 1 });
    else if (++e.n > max) return sendProblem(res, 429, 'Too many requests', 'Slow down and retry later.');
    if (hits.size > 10000) hits.clear();
    next();
  };
}

// Known paths answer 405 (with Allow) to methods the contract does not list.
const ROUTES = [
  [/^\/health$/, ['GET']], [/^\/meta$/, ['GET']], [/^\/auth\/login$/, ['POST']], [/^\/auth\/me$/, ['GET']],
  [/^\/users$/, ['GET', 'POST']], [/^\/users\/[^/]+$/, ['GET', 'PATCH']], [/^\/users\/[^/]+\/role$/, ['PUT']],
  [/^\/users\/[^/]+\/(de|re)activate$/, ['POST']], [/^\/invitations$/, ['GET', 'POST']],
  [/^\/invitations\/[^/]+\/accept$/, ['POST']], [/^\/audit-events$/, ['GET']],
];
function methodNotAllowed(req, res, next) {
  const route = ROUTES.find(([re]) => re.test(req.path));
  if (!route) return next();
  res.set('Allow', route[1].join(', '));
  sendProblem(res, 405, 'Method not allowed', `Use ${route[1].join(' or ')}.`);
}

export function createApp(options = {}) {
  const ctx = {
    clock: options.clock ?? (() => Date.now()),
    jwtSecret: options.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
    publicUrl: (options.publicUrl ?? process.env.PUBLIC_URL ?? '').replace(/\/$/, ''), // empty: use the request's origin
    corsOrigin: options.corsOrigin ?? process.env.CORS_ORIGIN ?? false,
    manifest: options.manifest ?? readManifest(process.env.CONTEXT_MANIFEST ?? join(REPO_ROOT, 'context/manifest.json')),
    mailer: options.mailer ?? { send: async (m) => console.log(`[mail] to=${m.to} subject="${m.subject}"\n${m.text}`) },
  };
  ctx.db = options.db ?? openDatabase(options.databasePath ?? process.env.DATABASE_PATH ?? ':memory:');

  const admin = options.admin ?? { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!' };
  if (admin) ensureAdmin(ctx.db, admin, ctx.clock());

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(rateLimit(options.rateLimit ?? { windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600) }));
  api.use(metaRoutes(ctx));
  api.use(authRoutes(ctx));
  api.use(userRoutes(ctx));
  api.use(invitationRoutes(ctx));
  api.use(auditRoutes(ctx));
  api.use(methodNotAllowed);
  api.use((_req, res) => sendProblem(res, 404, 'Not found', 'No such endpoint.'));
  api.use(errorHandler);
  app.use('/api', api);

  // Production: serve the built web app from the same origin.
  const webDist = options.webDist ?? join(REPO_ROOT, 'apps/web/dist');
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  const server = http.createServer(app);
  ctx.realtime = attachRealtime(server, ctx);
  return { app, server, ctx, io: ctx.realtime.io };
}
