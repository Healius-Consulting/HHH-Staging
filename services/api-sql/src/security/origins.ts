import { config, portalAppOrigins } from '../bootstrap/config.js';

function originFrom(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isPermittedWebOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const normalised = originFrom(origin);
  if (!normalised) return false;
  if (portalAppOrigins.has(normalised)) return true;
  if (config.NODE_ENV === 'production') return false;

  try {
    const host = new URL(normalised).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
