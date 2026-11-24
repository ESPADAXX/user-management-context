import { z } from 'zod';
import { notFound } from '../errors.js';

export const Role = z.enum(['admin', 'manager', 'member']);
export const Status = z.enum(['active', 'inactive']);
// Lengths count characters (code points), like JSON Schema does.
const chars = (min, max, msg) => z.string().refine((s) => [...s].length >= min && [...s].length <= max, msg ?? `Must be ${min} to ${max} characters`);

// RFC 5322 dot-atom address, the same rule as the contract's "format: email".
const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const Email = z.string().max(254).regex(EMAIL, 'Invalid email');
export const Name = chars(1, 100).refine((s) => /\S/.test(s), 'Must not be blank');
export const NewPassword = chars(10, 200, 'At least 10 characters');

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'pageSize must be 100 or less').default(20),
};

// Path ids that are not positive integers are simply not found.
export function idParam(req) {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw notFound('User not found.');
  return id;
}
