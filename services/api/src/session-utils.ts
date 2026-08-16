import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { ProtectedSurface } from './types.js';

export const SESSION_IDLE_MS = 15 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function parseCookies(request: Pick<Request, 'headers'>) {
  const header = request.headers.cookie ?? '';
  return Object.fromEntries(header.split(';').flatMap(part => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { return [[key, decodeURIComponent(value)]]; }
    catch { return []; }
  }));
}

export function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeReturnTo(value: unknown, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const decoded = decodeURIComponent(decodeURIComponent(value));
    if (decoded.startsWith('//') || decoded.includes('\\') || [...decoded].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return fallback;
    const parsed = new URL(value, 'https://protected.invalid');
    if (parsed.origin !== 'https://protected.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
}

function hostname(origin: string) {
  return new URL(origin).hostname.toLowerCase();
}

export function requestHostname(request: Pick<Request, 'get' | 'hostname'>) {
  const forwarded = request.get('x-forwarded-host')?.split(',')[0]?.trim();
  return (forwarded || request.get('host') || request.hostname).split(':')[0]!.toLowerCase();
}

export function surfaceForRequest(
  request: Pick<Request, 'get' | 'hostname'>,
  origins: { pharmacy: string; admin: string },
  allowDevelopmentHeader = false,
): ProtectedSurface | null {
  if (allowDevelopmentHeader) {
    const requested = request.get('x-hhh-surface');
    if (requested === 'pharmacy' || requested === 'admin') return requested;
  }
  const host = requestHostname(request);
  if (host === hostname(origins.pharmacy)) return 'pharmacy';
  if (host === hostname(origins.admin)) return 'admin';
  if (allowDevelopmentHeader && ['localhost', '127.0.0.1', '::1'].includes(host)) return 'pharmacy';
  return null;
}

export function surfaceFromPortalApiPath(value: string) {
  let pathname: string;
  try { pathname = new URL(value, 'https://portal.invalid').pathname; }
  catch { return null; }
  if (pathname === '/pharmacy/v1' || pathname.startsWith('/pharmacy/v1/')) return 'pharmacy' as const;
  if (pathname === '/admin/v1' || pathname.startsWith('/admin/v1/')) return 'admin' as const;
  if (pathname === '/pharmacy/v2' || pathname.startsWith('/pharmacy/v2/')) return 'pharmacy' as const;
  if (pathname === '/admin/v2' || pathname.startsWith('/admin/v2/')) return 'admin' as const;
  return null;
}
