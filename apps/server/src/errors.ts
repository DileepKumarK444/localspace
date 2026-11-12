import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (msg: string) => new HttpError(400, 'BAD_REQUEST', msg);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION', message: err.issues.map((i) => i.message).join('; ') } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request too large' } });
    return;
  }
  console.error('[server error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
