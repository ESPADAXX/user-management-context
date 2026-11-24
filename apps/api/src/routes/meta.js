import { Router } from 'express';

// Release gate: every build states the context version it was made from.
export function metaRoutes(ctx) {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ status: 'ok' }));
  r.get('/meta', (_req, res) => res.json({ contextVersion: ctx.manifest?.contextVersion ?? 0, requirements: ctx.manifest?.requirements ?? {} }));
  return r;
}
