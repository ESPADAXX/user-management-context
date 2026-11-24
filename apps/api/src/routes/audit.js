import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { pageQuery } from './schemas.js';

// REQ-006: admins read the log, newest first. There is deliberately no update or delete route.
export function auditRoutes(ctx) {
  const r = Router();
  r.get('/audit-events', authenticate(ctx), requireRole('admin'), (req, res) => {
    const { page, pageSize } = z.object(pageQuery).parse(req.query);
    const total = ctx.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    const rows = ctx.db.prepare(`
      SELECT e.*, a.email AS actor_email, t.email AS target_email
      FROM audit_events e
      LEFT JOIN users a ON a.id = e.actor_id
      LEFT JOIN users t ON t.id = e.target_id
      ORDER BY e.id DESC LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
    res.json({
      items: rows.map((e) => ({
        id: e.id, action: e.action, actorId: e.actor_id, actorEmail: e.actor_email,
        targetId: e.target_id, targetEmail: e.target_email, details: JSON.parse(e.details), createdAt: e.created_at,
      })),
      total, page, pageSize,
    });
  });
  return r;
}
