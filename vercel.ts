import { CONTENT_SECURITY_POLICY } from './platform/vercel/security-headers.js';

type Surface = 'public' | 'portal';

function resolveSurface(): Surface {
  if (process.env.HHH_SURFACE === 'public' || process.env.HHH_SURFACE === 'portal') {
    return process.env.HHH_SURFACE;
  }
  const projectName = process.env.VERCEL_PROJECT_NAME ?? '';
  if (projectName.includes('api') || projectName.includes('public')) {
    return 'public';
  }
  return 'portal';
}

const surface: Surface = resolveSurface();



const apiOrigin = new URL(
  process.env.HHH_FIREBASE_API_ORIGIN
    ?? 'https://europe-west2-hhh26-4ebd2.cloudfunctions.net/apiLondon',
);
if (apiOrigin.protocol !== 'https:' || apiOrigin.username || apiOrigin.password || apiOrigin.search || apiOrigin.hash) {
  throw new Error('HHH_FIREBASE_API_ORIGIN must be an HTTPS origin/path without credentials, query, or fragment.');
}

const portalSurface = surface === 'portal';
const securityHeaders = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
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
  outputDirectory: 'dist',
  regions: ['lhr1'],
  functions: portalSurface ? {

    'api/page-gate.ts': {
      maxDuration: 10,
      regions: ['lhr1'],
      includeFiles: '.vercel-private/**',
    },
  } : undefined,
  redirects: portalSurface ? [
    { source: '/', destination: '/login', permanent: false },
    { source: '/pharmacy/login', destination: '/login', permanent: true },
    { source: '/admin/login', destination: '/login', permanent: true },
    { source: '/pharmacy/reset-password', destination: '/reset-password', permanent: true },
    { source: '/admin/reset-password', destination: '/reset-password', permanent: true },
    { source: '/pharmacy/home', destination: '/pharmacy', permanent: true },
    { source: '/admin/overview', destination: '/admin', permanent: true },
  ] : [
    { source: '/general-5', destination: '/faq', permanent: true },
    { source: '/general-5-1', destination: '/privacy', permanent: true },
  ],
  rewrites: [
    ...(portalSurface ? [
      { source: '/login', destination: '/api/page-gate?__hhh_path=/login' },
      { source: '/reset-password', destination: '/api/page-gate?__hhh_path=/reset-password' },
      { source: '/v1/auth/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/auth/$1?__hhh_surface=auto` },
      { source: '/pharmacy/v1/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1?__hhh_surface=pharmacy` },
      { source: '/admin/v1/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1?__hhh_surface=admin` },
      { source: '/pharmacy/v2/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v2/$1?__hhh_surface=pharmacy` },
      { source: '/admin/v2/(.*)', destination: `${apiOrigin.toString().replace(/\/$/, '')}/v2/$1?__hhh_surface=admin` },
      { source: '/pharmacy', destination: '/api/page-gate?__hhh_path=/pharmacy' },
      { source: '/admin', destination: '/api/page-gate?__hhh_path=/admin' },
      { source: '/pharmacy/(.*)', destination: '/api/page-gate?__hhh_path=/pharmacy/$1' },
      { source: '/admin/(.*)', destination: '/api/page-gate?__hhh_path=/admin/$1' },
    ] : []),
    {
      source: '/v1/(.*)',
      destination: `${apiOrigin.toString().replace(/\/$/, '')}/v1/$1`,
    },
    {
      source: '/v2/(.*)',
      destination: `${apiOrigin.toString().replace(/\/$/, '')}/v2/$1`,
    },
    ...(portalSurface ? [] : [{ source: '/(.*)', destination: '/index.html' }]),
  ],
  headers: [
    { source: '/(.*)', headers: [...securityHeaders, { key: 'Cache-Control', value: 'private, no-store' }] },
    { source: '/assets/(.*)', headers: [...securityHeaders, { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ],
};
