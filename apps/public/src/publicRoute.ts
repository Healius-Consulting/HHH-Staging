export type PublicView = 'site' | 'eligibility' | 'payment-complete' | 'payment-cancelled';

export const CANONICAL_ELIGIBILITY_ORIGIN = 'https://holistichealthhub.cc';
export const LEGACY_PUBLIC_HOST = 'hhh.thinktimeless.co.uk';
const ALLOWED_ATTRIBUTION_PARAMETERS = new Set(['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);

export function resolvePublicView(pathname: string, search: string): PublicView {
  const path = pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(search);

  // Pharmacy QR packs issued before the standalone eligibility path used the
  // public root with ?mode=eligibility. Keep that URL working indefinitely so
  // printed codes do not need to be recalled or replaced.
  if (path === '/' && query.get('mode') === 'eligibility') return 'eligibility';
  if (path === '/eligibility') return 'eligibility';
  if (path === '/payments/complete') return 'payment-complete';
  if (path === '/payments/cancelled') return 'payment-cancelled';
  return 'site';
}

export function canonicalEligibilityRedirect(hostname: string, pathname: string, search: string) {
  if (hostname.toLowerCase() !== LEGACY_PUBLIC_HOST) return null;
  if (resolvePublicView(pathname, search) !== 'eligibility') return null;
  const query = new URLSearchParams(search);
  if (!query.get('token')) return null;
  for (const key of [...query.keys()]) {
    if (key !== 'token' && !ALLOWED_ATTRIBUTION_PARAMETERS.has(key)) query.delete(key);
  }
  const destination = new URL('/eligibility', CANONICAL_ELIGIBILITY_ORIGIN);
  destination.search = query.toString();
  return destination.toString();
}
