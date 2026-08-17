import type { NextFunction, Request, Response } from 'express';
import { portalAppOrigins, secureSessionCookies } from '../bootstrap/config.js';
import { HttpError } from '../domain/common/errors.js';
import { constantTimeEqual, parseCookies, randomToken, SESSION_ABSOLUTE_MS } from './session-utils.js';

export const csrfCookieName = secureSessionCookies ? '__Host-hhh_csrf' : 'hhh_csrf';

export function cookieOptions(httpOnly: boolean, maxAge = SESSION_ABSOLUTE_MS) {
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
  const source = request.get('origin') ?? request.get('referer');
  if (!source) return true;

  try {
    const origin = new URL(source).origin;
    if (portalAppOrigins.has(origin)) return true;
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.vercel.app')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (
      host === 'holistichealthhub.cc' || host.endsWith('.holistichealthhub.cc') ||
      host === 'holistichealthhub.live' || host.endsWith('.holistichealthhub.live') ||
      host === 'holistichealthhub.co.uk' || host.endsWith('.holistichealthhub.co.uk') ||
      host === 'thinktimeless.co.uk' || host.endsWith('.thinktimeless.co.uk')
    ) return true;
    return false;
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
