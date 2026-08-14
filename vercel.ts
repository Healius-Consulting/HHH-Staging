type Surface = 'public' | 'pharmacy' | 'admin' | 'portal';

const surface = process.env.HHH_SURFACE as Surface | undefined;
if (!surface || !['public', 'pharmacy', 'admin', 'portal'].includes(surface)) {
  throw new Error('Set HHH_SURFACE to public, pharmacy, admin, or portal in this Vercel project.');
}

const apiOrigin = new URL(
  process.env.HHH_FIREBASE_API_ORIGIN
    ?? 'https://europe-west2-hhh26-4ebd2.cloudfunctions.net/apiLondon',
);
if (apiOrigin.protocol !== 'https:' || apiOrigin.username || apiOrigin.password || apiOrigin.search || apiOrigin.hash) {
  throw new Error('HHH_FIREBASE_API_ORIGIN must be an HTTPS origin/path without credentials, query, or fragment.');
}

const protectedSurface = surface === 'pharmacy' || surface === 'admin';
const portalSurface = surface === 'portal';
const outputDirectory = `dist-${surface}`;
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://storage.googleapis.com; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseappcheck.googleapis.com https://recaptchaenterprise.googleapis.com; frame-src https://www.google.com; worker-src 'self'; upgrade-insecure-requests" },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build:vercel',
  outputDirectory,
  regions: ['lhr1'],
  functions: (protectedSurface || portalSurface) ? {
    'api/page-gate.ts': {
      maxDuration: 10,
      regions: ['lhr1'],
      includeFiles: portalSurface ? '.vercel-private/**' : '.vercel-private/index.html',
    },
  } : undefined,
  redirects: portalSurface ? [
    { source: '/', destination: '/pharmacy', permanent: false },
  ] : undefined,
  rewrites: [
    ...(portalSurface ? [
      { source: '/login', destination: '/api/page-gate?__hhh_surface=pharmacy&__hhh_path=/login' },
      { source: '/v1/auth/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/auth/$1?__hhh_surface=auto` },
      { source: '/pharmacy/v1/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1?__hhh_surface=pharmacy` },
      { source: '/admin/v1/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1?__hhh_surface=admin` },
      { source: '/pharmacy', destination: '/api/page-gate?__hhh_surface=pharmacy&__hhh_path=/pharmacy' },
      { source: '/admin', destination: '/api/page-gate?__hhh_surface=admin&__hhh_path=/admin' },
      { source: '/pharmacy/(.*)', destination: '/api/page-gate?__hhh_surface=pharmacy&__hhh_path=/pharmacy/$1' },
      { source: '/admin/(.*)', destination: '/api/page-gate?__hhh_surface=admin&__hhh_path=/admin/$1' },
    ] : []),
    {
      source: '/v1/(.*)',
      destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1`,
    },
    protectedSurface
      ? { source: '/(.*)', destination: '/api/page-gate?__hhh_path=/$1' }
      : portalSurface
        ? { source: '/(.*)', destination: '/index.html' }
        : { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    { source: '/(.*)', headers: [...securityHeaders, { key: 'Cache-Control', value: 'private, no-store' }] },
    { source: '/assets/(.*)', headers: [...securityHeaders, { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ],
};
