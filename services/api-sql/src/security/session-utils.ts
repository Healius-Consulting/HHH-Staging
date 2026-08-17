import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../bootstrap/config.js';

export const SESSION_IDLE_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes debounce

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function ipHash(request: Request): string {
  const address = request.ip || request.socket.remoteAddress || 'unknown';
  const secret = config.IP_HASH_SECRET ?? `${config.FIREBASE_PROJECT_ID}:default-ip-secret`;
  return createHmac('sha256', secret).update(address).digest('hex');
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [key, ...values] = pair.trim().split('=');
    if (key) {
      cookies[key] = decodeURIComponent(values.join('='));
    }
  }
  return cookies;
}
