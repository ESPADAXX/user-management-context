// REQ-006: one append-only event per change.
export function record(ctx, { actorId, action, targetId = null, details = {} }) {
  ctx.db.prepare('INSERT INTO audit_events (actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actorId ?? null, action, targetId, JSON.stringify(details), new Date(ctx.clock()).toISOString());
}
