import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { applicationDefault, getApps, initializeApp, type Credential } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDataConnect } from 'firebase-admin/data-connect';
import { ExternalAccountClient } from 'google-auth-library';
import {
  allowedHosts,
  parseCookieHeader,
  requestHost,
  safeReturnTo,
} from '../platform/vercel/page-gate-utils.js';
import { CONTENT_SECURITY_POLICY } from '../platform/vercel/security-headers.js';
import { isSupportedPortalRelativePath } from '@hhh/domain/portal-route';
import { validatePortalAdmission } from '../services/api-sql/src/security/admission.js';
import type { PortalAdmissionResult, StaffSessionRecord, StaffUserRecord } from '../services/api-sql/src/repositories/ports/identity.port.js';

type ProtectedSurface = 'pharmacy' | 'admin';

const deploymentSurface = process.env.HHH_SURFACE || 'portal';
const portalDeployment = deploymentSurface === 'portal';
const sessionCookieName = '__Host-hhh_session';
const csrfCookieName = '__Host-hhh_csrf';


let activeVercelOidcToken: string | null = null;
type ExternalAccessTokenClient = { getAccessToken(): Promise<{ token?: string | null }> };

const APPEND_GATE_AUDIT_LOG_GQL = `
  mutation AppendGateAuditLog(
    $event: String!
    $requestId: String
    $ipHash: String
    $surface: String
    $details: Any
  ) {
    auditLog_insert(data: {
      event: $event
      recordType: "page-gate"
      requestId: $requestId
      ipHash: $ipHash
      surface: $surface
      details: $details
    })
  }
`;

const GET_PORTAL_ADMISSION_GQL = `
  query GetPortalAdmission($sessionHash: String!, $staffUid: String!) {
    staffSession(key: { sessionHash: $sessionHash }) {
      sessionHash
      staffUid
      organisationId
      surface
      role
      userAgentHash
      createdAt
      lastActivityAt
      idleExpiresAt
      absoluteExpiresAt
      revokedAt
      revokeReason
    }
    staffUser(key: { uid: $staffUid }) {
      uid
      organisationId
      email
      displayName
      role
      status
      disabled
      version
    }
  }
`;

function wifCredential(request: Request): Credential {
  const oidcToken = request.headers.get('x-vercel-oidc-token');
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!oidcToken) throw new Error('VERCEL_OIDC_TOKEN_MISSING');
  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) throw new Error('GCP_WIF_CONFIGURATION_MISSING');
  activeVercelOidcToken = oidcToken;
  let authClient: ExternalAccessTokenClient | null;
  try {
    authClient = ExternalAccountClient.fromJSON({
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
  } catch {
    throw new Error('GCP_WIF_CLIENT_INITIALIZATION_FAILED');
  }
  if (!authClient) throw new Error('GCP_WIF_CLIENT_INITIALIZATION_FAILED');
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
  const projectId = process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const credential = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID
    ? wifCredential(request)
    : applicationDefault();
  try {
    return initializeApp({ credential, projectId });
  } catch {
    throw new Error('FIREBASE_APP_INITIALIZATION_FAILED');
  }
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
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
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
  if (!portalDeployment) return null;
  const requestedPath = requestPath(request);
  if (requestedPath === '/login' || requestedPath === '/reset-password') return 'pharmacy';
  if (requestedPath === '/pharmacy' || requestedPath?.startsWith('/pharmacy/')) return 'pharmacy';
  if (requestedPath === '/admin' || requestedPath?.startsWith('/admin/')) return 'admin';
  return null;
}

function logicalPath(pathName: string, surface: ProtectedSurface) {
  const prefix = `/${surface}`;
  if (pathName === '/login') return '/login';
  if (pathName === '/reset-password') return '/reset-password';
  if (pathName === prefix) return '/';
  return pathName.startsWith(`${prefix}/`) ? pathName.slice(prefix.length) : null;
}

function redirectToLogin(surface: ProtectedSurface, returnTo: string, requestId: string, clear = false) {
  const headers = new Headers(responseHeaders(requestId));
  const loginPath = '/login';
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
    const app = firebaseApp(request);
    const dataConnect = getDataConnect({
      serviceId: process.env.DATA_CONNECT_SERVICE_ID ?? 'hhh-platform-service',
      location: process.env.DATA_CONNECT_LOCATION ?? 'europe-west2',
    }, app);
    await dataConnect.executeGraphql(APPEND_GATE_AUDIT_LOG_GQL, {
      variables: {
        event,
        requestId: typeof requestId === 'string' ? requestId : null,
        ipHash: payload.ipHash,
        surface: payload.surface,
        details: { schemaVersion: 1, ...details },
      },
    });
  } catch (error) {
    const failure = error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 500) }
      : { name: 'UnknownError', message: 'Audit persistence failed without an Error object.' };
    console.error(JSON.stringify({ event: 'security.audit_write_failed', requestId, originalEvent: event, failure }));
  }
}

async function protectedHtml(surface: ProtectedSurface) {
  const file = path.join(process.cwd(), '.vercel-private', surface, 'index.html');
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
    await securityEvent(request, 'auth.origin_denied', { requestId, code: 'HOST_DENIED' });
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

  if (!isSupportedPortalRelativePath(protectedSurface, pathName)) {
    return new Response('Not found', { status: 404, headers: responseHeaders(requestId) });
  }

  const sessionCookie = parseCookieHeader(request.headers.get('cookie'))[sessionCookieName];
  if (!sessionCookie) {
    await securityEvent(request, 'auth.session_rejected', { requestId, code: 'UNAUTHENTICATED' });
    return redirectToLogin(protectedSurface, requestedPath, requestId);
  }

  try {
    const firebase = firebaseApp(request);
    const claims = await getAuth(firebase).verifySessionCookie(sessionCookie, true);
    const sessionHash = createHash('sha256').update(sessionCookie).digest('hex');
    const dataConnect = getDataConnect({
      serviceId: process.env.DATA_CONNECT_SERVICE_ID ?? 'hhh-platform-service',
      location: process.env.DATA_CONNECT_LOCATION ?? 'europe-west2',
    }, firebase);
    const admissionResult = await dataConnect.executeGraphql<{
      staffSession: StaffSessionRecord | null;
      staffUser: StaffUserRecord | null;
    }, { sessionHash: string; staffUid: string }>(GET_PORTAL_ADMISSION_GQL, {
      variables: { sessionHash, staffUid: claims.uid },
    });
    const admission: PortalAdmissionResult = {
      session: admissionResult.data.staffSession ?? null,
      staff: admissionResult.data.staffUser ?? null,
    };
    const failure = validatePortalAdmission({
      claims,
      admission,
      sessionHash,
      surface: protectedSurface,
    });
    if (failure) {
      await securityEvent(request, failure.event, { requestId, code: failure.code });
      return redirectToLogin(protectedSurface, requestedPath, requestId, failure.status === 401);
    }
  } catch {
    await securityEvent(request, 'auth.session_rejected', { requestId, code: 'INVALID_OR_EXPIRED' });
    return redirectToLogin(protectedSurface, requestedPath, requestId, true);
  }

  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: responseHeaders(requestId, 'text/html; charset=utf-8') });
}

export default { fetch: gate };
