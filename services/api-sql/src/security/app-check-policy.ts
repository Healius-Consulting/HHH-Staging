import { config } from '../bootstrap/config.js';

export function appCheckIsRequired(): boolean {
  if (config.REQUIRE_APP_CHECK === 'true') return true;
  if (config.REQUIRE_APP_CHECK === 'false') return false;
  return config.NODE_ENV === 'production';
}

export function isAppCheckExempt(method: string, path: string): boolean {
  if (method === 'OPTIONS') return true;
  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) return true;
  if (method === 'POST' && path.includes('/public/payments/worldpay/webhook')) return true;
  return false;
}
