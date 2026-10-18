import type { Request } from 'express';
import type { Config } from './config.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Placeholder authentication. Replace with your real session/auth middleware.
 * Outside production it trusts the X-Demo-User-Id header so the flows can be tried locally;
 * in production it refuses every request until real auth is wired in.
 */
export function currentUserId(req: Request, config: Config): string {
  if (config.isProduction) {
    throw new HttpError(501, 'Authentication is not implemented');
  }
  const id = req.header('X-Demo-User-Id');
  if (!id) throw new HttpError(401, 'Missing X-Demo-User-Id header');
  return id;
}
