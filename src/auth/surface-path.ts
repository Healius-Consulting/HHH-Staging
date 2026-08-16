import type { PortalPathPrefix } from '../routing/surfaceRoute';

const configuredPrefix = (import.meta.env.VITE_APP_PATH_PREFIX as string | undefined)?.trim().replace(/\/+$/, '');

export const appPathPrefix: PortalPathPrefix = configuredPrefix && /^\/(pharmacy|admin)$/.test(configuredPrefix)
  ? configuredPrefix as PortalPathPrefix
  : '/pharmacy';

export function surfacePath(path: string) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${appPathPrefix}${suffix}`;
}

export function isCurrentSurfacePath(path: string) {
  if ((path === '/login' || path === '/reset-password') && window.location.pathname === path) return true;
  return window.location.pathname === surfacePath(path);
}
