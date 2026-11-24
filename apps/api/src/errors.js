// RFC 9457 problem+json errors (ADR-003).
import { ZodError } from 'zod';

export class Problem extends Error {
  constructor(status, title, detail, errors) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
  }
}

export const badRequest = (detail, errors) => new Problem(422, 'Validation failed', detail, errors);
export const unauthorized = (detail = 'Sign in again.') => new Problem(401, 'Unauthorized', detail);
export const forbidden = (detail = 'Your role does not allow this.') => new Problem(403, 'Forbidden', detail);
export const notFound = (detail = 'Not found.') => new Problem(404, 'Not found', detail);
export const conflict = (detail) => new Problem(409, 'Conflict', detail);

export function sendProblem(res, status, title, detail, errors) {
  res.status(status).type('application/problem+json').send(JSON.stringify({
    type: 'about:blank', title, status, ...(detail ? { detail } : {}), ...(errors ? { errors } : {}),
  }));
}

// Express error handler: never leaks stack traces.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return sendProblem(res, 422, 'Validation failed', 'Some fields are invalid.', err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })));
  }
  if (err instanceof Problem) return sendProblem(res, err.status, err.title, err.detail, err.errors);
  if (err.type === 'entity.parse.failed') return sendProblem(res, 422, 'Validation failed', 'The body is not valid JSON.');
  if (err.type === 'entity.too.large') return sendProblem(res, 422, 'Validation failed', 'The body is too large.');
  console.error(err);
  return sendProblem(res, 500, 'Internal error', 'Something went wrong.');
}
