import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** Error shape returned to clients: { error: { code, message, details? } } */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, 'unauthorized', 'Please log in to continue.');

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'not_found', 'That endpoint does not exist.'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: err.issues[0]?.message ?? 'Invalid request.' },
    });
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'validation_error', message: 'Request body must be valid JSON.' } });
    return;
  }
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
    return;
  }
  // Never leak internals to the client.
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } });
};
