import type { NextFunction, Request, Response } from 'express';
import { portalAppOrigins, secureSessionCookies } from '../bootstrap/config.js';
import { HttpError } from '../domain/common/errors.js';
import { constantTimeEqual, parseCookies, randomToken } from './session-utils.js';

export const csrfCookieName = secureSessionCookies ? '__Host-hhh_csrf' : 'hhh_csrf';

export function cookieOptions(httpOnly: boolean, maxAge = 12 * 60 * 60 * 1000) {
  return {
    httpOnly,
    secure: secureSessionCookies,
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}

export function issueCsrf(request: Request, response: Response): string {
  const existing = parseCookies(request)[csrfCookieName];
  const token = existing ?? randomToken();
  if (!existing) {
    response.cookie(csrfCookieName, token, cookieOptions(false));
  }
  response.setHeader('Cache-Control', 'no-store');
  return token;
}

export function isOriginAllowed(request: Request): boolean {
  const fetchSite = request.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;

  const source = request.get('origin') ?? request.get('referer');
  if (!source) return process.env.NODE_ENV !== 'production';

  try {
    const origin = new URL(source).origin;
    return portalAppOrigins.has(origin);
  } catch {
    return false;
  }
}

export function requireCsrf(request: Request, response: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return next();
  }

  const cookie = parseCookies(request)[csrfCookieName];
  const header = request.get('x-csrf-token');

  if (!isOriginAllowed(request) || !cookie || !header || !constantTimeEqual(cookie, header)) {
    return next(new HttpError(403, 'The request origin or CSRF token could not be verified.', 'REQUEST_ORIGIN_DENIED'));
  }

  next();
}
