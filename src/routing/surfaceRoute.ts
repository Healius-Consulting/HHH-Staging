export type PortalPathPrefix = '/pharmacy' | '/admin';

export function surfaceRoutePath(relativePath: string, prefix: PortalPathPrefix) {
  const normalisedPrefix = prefix.replace(/\/+$/, '');
  const suffix = relativePath === '/' ? '' : `/${relativePath.replace(/^\/+|\/+$/g, '')}`;
  return `${normalisedPrefix}${suffix}` || '/';
}

export function surfaceRelativePath(pathname: string, prefix: PortalPathPrefix) {
  const normalisedPrefix = prefix.replace(/\/+$/, '');
  if (pathname === normalisedPrefix) return '/';
  if (!pathname.startsWith(`${normalisedPrefix}/`)) return null;
  return pathname.slice(normalisedPrefix.length) || '/';
}
