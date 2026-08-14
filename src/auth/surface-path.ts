const configuredPrefix = (import.meta.env.VITE_APP_PATH_PREFIX as string | undefined)?.trim().replace(/\/+$/, '');

export const appPathPrefix = configuredPrefix && /^\/(pharmacy|admin)$/.test(configuredPrefix)
  ? configuredPrefix
  : '';

export function surfacePath(path: string) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${appPathPrefix}${suffix}`;
}

export function isCurrentSurfacePath(path: string) {
  if (path === '/login' && window.location.pathname === '/login') return true;
  return window.location.pathname === surfacePath(path);
}
