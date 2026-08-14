import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { applicationDefault, cert, getApps, initializeApp, type Credential } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ExternalAccountClient } from 'google-auth-library';
import {
  allowedHosts,
  parseCookieHeader,
  requestHost,
  safeReturnTo,
  SESSION_IDLE_MS,
  shouldTouchSession,
  validateGateSession,
  type SessionRecord,
  type StaffRecord,
} from '../platform/vercel/page-gate-utils.js';

type ProtectedSurface = 'pharmacy' | 'admin';

const deploymentSurface = process.env.HHH_SURFACE;
const configuredSurface = deploymentSurface === 'pharmacy' || deploymentSurface === 'admin' ? deploymentSurface : null;
const portalDeployment = deploymentSurface === 'portal';
const sessionCookieName = '__Host-hhh_session';
const csrfCookieName = '__Host-hhh_csrf';

let activeVercelOidcToken: string | null = null;

function wifCredential(request: Request): Credential {
  const oidcToken = request.headers.get('x-vercel-oidc-token');
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!oidcToken || !projectNumber || !poolId || !providerId || !serviceAccountEmail) {
    throw new Error('Keyless Google authentication is not fully configured.');
  }
  activeVercelOidcToken = oidcToken;
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: async () => {
        if (!activeVercelOidcToken) throw new Error('Vercel OIDC token is unavailable.');
        return activeVercelOidcToken;
      },
    },
  });
  if (!authClient) throw new Error('Could not create the Google workload identity client.');
  return {
    async getAccessToken() {
      const accessToken = await authClient.getAccessToken();
      if (!accessToken.token) throw new Error('Google workload identity did not issue an access token.');
      return { access_token: accessToken.token, expires_in: 3_600 };
    },
  };
}

function firebaseApp(request: Request) {
  // Vercel issues a short-lived OIDC token on each Function invocation. Keep the
  // supplier current so a warm instance never attempts to exchange an old token.
  const oidcToken = request.headers.get('x-vercel-oidc-token');
  if (oidcToken) activeVercelOidcToken = oidcToken;
  if (getApps().length) return getApps()[0]!;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const credential = serviceAccount
    ? cert(JSON.parse(serviceAccount))
    : process.env.GCP_WORKLOAD_IDENTITY_POOL_ID
      ? wifCredential(request)
      : applicationDefault();
  return initializeApp({
    credential,
    projectId,
  });
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requestPath(request: Request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get('__hhh_path');
  if (rewrittenPath === null) return null;
  const pathOnly = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
  return safeReturnTo(pathOnly);
}

function responseHeaders(requestId: string, contentType = 'text/plain; charset=utf-8') {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://storage.googleapis.com; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseappcheck.googleapis.com https://recaptchaenterprise.googleapis.com; frame-src https://www.google.com; worker-src 'self'; upgrade-insecure-requests",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Request-Id': requestId,
  };
}

function clearCookies(headers: Headers) {
  headers.append('Set-Cookie', `${sessionCookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  headers.append('Set-Cookie', `${csrfCookieName}=; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

function surfaceForRequest(request: Request): ProtectedSurface | null {
  if (configuredSurface) return configuredSurface;
  if (!portalDeployment) return null;
  const requested = new URL(request.url).searchParams.get('__hhh_surface');
  return requested === 'pharmacy' || requested === 'admin' ? requested : null;
}

function logicalPath(pathName: string, surface: ProtectedSurface) {
  const prefix = `/${surface}`;
  if (!portalDeployment) return pathName;
  if (pathName === '/login') return '/login';
  if (pathName === prefix) return '/';
  return pathName.startsWith(`${prefix}/`) ? pathName.slice(prefix.length) : null;
}

function redirectToLogin(surface: ProtectedSurface, returnTo: string, requestId: string, clear = false) {
  const headers = new Headers(responseHeaders(requestId));
  const loginPath = portalDeployment ? `/${surface}/login` : '/login';
  headers.set('Location', `${loginPath}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
  if (clear) clearCookies(headers);
  return new Response(null, { status: 303, headers });
}

async function securityEvent(request: Request, event: string, details: Record<string, unknown>) {
  const requestId = details.requestId;
  const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const secret = process.env.IP_HASH_SECRET ?? `${process.env.FIREBASE_PROJECT_ID ?? 'hhh'}:missing-runtime-ip-secret`;
  const payload = {
    schemaVersion: 1,
    event,
    surface: surfaceForRequest(request),
    requestId,
    ipHash: createHmac('sha256', secret).update(forwardedAddress).digest('hex'),
    occurredAt: new Date().toISOString(),
    ...details,
  };
  console.warn(JSON.stringify(payload));
  try {
    await getFirestore(firebaseApp(request)).collection('auditLogs').add(payload);
  } catch {
    console.error(JSON.stringify({ event: 'security.audit_write_failed', requestId, originalEvent: event }));
  }
}

async function protectedHtml(surface: ProtectedSurface) {
  const file = portalDeployment
    ? path.join(process.cwd(), '.vercel-private', surface, 'index.html')
    : path.join(process.cwd(), '.vercel-private', 'index.html');
  return readFile(file, 'utf8');
}

async function gate(request: Request) {
  const requestIdHeader = request.headers.get('x-request-id');
  const requestId = requestIdHeader && /^[A-Za-z0-9_-]{8,80}$/.test(requestIdHeader) ? requestIdHeader : randomUUID();
  const protectedSurface = surfaceForRequest(request);
  if (!protectedSurface) return new Response('Not found', { status: 404, headers: responseHeaders(requestId) });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...responseHeaders(requestId), Allow: 'GET, HEAD' } });
  }

  const permittedHosts = allowedHosts(process.env);
  if (!permittedHosts.size || !permittedHosts.has(requestHost(request))) {
    void securityEvent(request, 'auth.origin_denied', { requestId, code: 'HOST_DENIED' });
    return new Response('Misdirected request', { status: 421, headers: responseHeaders(requestId) });
  }

  const requestedPath = requestPath(request);
  if (requestedPath === null) return new Response('Not found', { status: 404, headers: responseHeaders(requestId) });
  const pathName = logicalPath(requestedPath, protectedSurface);
  if (pathName === null) return new Response('Not found', { status: 404, headers: responseHeaders(requestId) });

  let html: string;
  try {
    html = await protectedHtml(protectedSurface);
  } catch {
    return new Response('The service is temporarily unavailable.', { status: 503, headers: responseHeaders(requestId) });
  }

  if (pathName === '/login' || pathName === '/reset-password') {
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: responseHeaders(requestId, 'text/html; charset=utf-8') });
  }

  const sessionCookie = parseCookieHeader(request.headers.get('cookie'))[sessionCookieName];
  if (!sessionCookie) {
    void securityEvent(request, 'auth.session_rejected', { requestId, code: 'UNAUTHENTICATED' });
    return redirectToLogin(protectedSurface, requestedPath, requestId);
  }

  const sessionHash = hash(sessionCookie);
  try {
    const app = firebaseApp(request);
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const claims = await auth.verifySessionCookie(sessionCookie, true) as DecodedIdToken;
    const [sessionSnapshot, staffSnapshot] = await Promise.all([
      firestore.collection('staffSessions').doc(sessionHash).get(),
      firestore.collection('staffUsers').doc(claims.uid).get(),
    ]);
    const record = sessionSnapshot.exists ? sessionSnapshot.data() as SessionRecord : null;
    const staff = staffSnapshot.exists ? staffSnapshot.data() as StaffRecord : null;
    const now = Date.now();
    const failure = validateGateSession({ claims, record, staff, sessionHash, surface: protectedSurface, now });
    if (failure) {
      if (failure.code === 'SESSION_IDLE_EXPIRED') {
        const revokedAt = new Date(now).toISOString();
        await sessionSnapshot.ref.set({ revokedAt, revokeReason: 'idle_timeout', updatedAt: revokedAt }, { merge: true });
      }
      await securityEvent(request, failure.event, {
        requestId,
        code: failure.code,
        actorUid: claims.uid,
        actorRole: typeof claims.role === 'string' ? claims.role : null,
        organisationId: typeof claims.organisationId === 'string' ? claims.organisationId : null,
        sessionHashPrefix: sessionHash.slice(0, 12),
      });
      if (failure.status === 403) {
        return new Response('This account cannot access this workspace.', { status: 403, headers: responseHeaders(requestId) });
      }
      return redirectToLogin(protectedSurface, requestedPath, requestId, true);
    }

    if (record && shouldTouchSession(record.lastActivityAt, now)) {
      const lastActivityAt = new Date(now).toISOString();
      await sessionSnapshot.ref.set({
        lastActivityAt,
        idleExpiresAt: new Date(now + SESSION_IDLE_MS).toISOString(),
        updatedAt: lastActivityAt,
      }, { merge: true });
    }
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: responseHeaders(requestId, 'text/html; charset=utf-8') });
  } catch {
    await securityEvent(request, 'auth.session_rejected', {
      requestId,
      code: 'INVALID_OR_EXPIRED',
      sessionHashPrefix: sessionHash.slice(0, 12),
    });
    return redirectToLogin(protectedSurface, requestedPath, requestId, true);
  }
}

export default { fetch: gate };
