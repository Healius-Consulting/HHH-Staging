import { createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { z } from 'zod';
import { config, secureSessionCookies } from './config.js';
import { auth, firestore } from './firebase.js';
import { HttpError, nowIso } from './http.js';
import {
  constantTimeEqual,
  parseCookies,
  randomToken,
  requestHostname,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sha256,
  surfaceFromPortalApiPath,
} from './session-utils.js';
import type { ProtectedSurface, RequestIdentity, StaffRole, StaffSessionRecord } from './types.js';

const sessionInputSchema = z.object({ idToken: z.string().min(100).max(20_000) });
const allowedRoles = new Set<StaffRole>(['hhh_admin', 'pharmacy_staff']);
type RequestedSurface = ProtectedSurface | 'auto';

export const sessionCookieName = secureSessionCookies ? '__Host-hhh_session' : 'hhh_session';
export const csrfCookieName = secureSessionCookies ? '__Host-hhh_csrf' : 'hhh_csrf';

export function cookieOptions(httpOnly: boolean, maxAge = SESSION_ABSOLUTE_MS) {
  return { httpOnly, secure: secureSessionCookies, sameSite: 'strict' as const, path: '/', maxAge };
}

function expectedOrigin() {
  return config.PORTAL_APP_ORIGIN;
}

export function protectedSurface(request: Request) {
  const host = requestHostname(request);
  const portalHost = new URL(config.PORTAL_APP_ORIGIN).hostname;
  if (host === portalHost) {
    const pathSurface = surfaceFromPortalApiPath(request.originalUrl);
    if (pathSurface) return pathSurface;
    const requested = request.query.__hhh_surface;
    return requested === 'pharmacy' || requested === 'admin' || requested === 'auto' ? requested : null;
  }
  if (config.NODE_ENV !== 'production') {
    const requested = request.get('x-hhh-surface');
    return requested === 'pharmacy' || requested === 'admin' ? requested : null;
  }
  return null;
}

function secondFactor(decoded: DecodedIdToken) {
  return (decoded.firebase as Record<string, unknown> | undefined)?.sign_in_second_factor;
}

function ipHash(request: Request) {
  const address = request.ip || request.socket.remoteAddress || 'unknown';
  const secret = config.IP_HASH_SECRET ?? `${config.FIREBASE_PROJECT_ID ?? 'hhh'}:development-only-ip-hash`;
  return createHmac('sha256', secret).update(address).digest('hex');
}

export async function securityEvent(request: Request, event: string, details: Record<string, unknown> = {}) {
  const actor = request.identity;
  const payload = {
    schemaVersion: 1,
    event,
    actorUid: actor?.uid ?? null,
    actorEmail: null,
    actorRole: actor?.role ?? 'public',
    organisationId: actor?.organisationId ?? null,
    surface: actor?.surface ?? protectedSurface(request),
    sessionHashPrefix: actor?.sessionHash?.slice(0, 12) ?? null,
    requestId: request.get('x-request-id') ?? null,
    ipHash: ipHash(request),
    occurredAt: nowIso(),
    ...details,
  };
  console.warn(JSON.stringify(payload));
  await firestore.collection('auditLogs').add(payload).catch(error => {
    console.error(JSON.stringify({
      event: 'security.audit_write_failed',
      requestId: payload.requestId,
      originalEvent: event,
      error: error instanceof Error ? error.name : 'UnknownError',
    }));
  });
}

export function issueCsrf(request: Request, response: Response) {
  const surface = protectedSurface(request);
  if (!surface) throw new HttpError(403, 'The requested application surface is not permitted.', 'SURFACE_DENIED');
  const existing = parseCookies(request)[csrfCookieName];
  const token = existing ?? randomToken();
  if (!existing) response.cookie(csrfCookieName, token, cookieOptions(false));
  response.setHeader('Cache-Control', 'no-store');
  return token;
}

function requestOriginAllowed(request: Request) {
  const fetchSite = request.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const source = request.get('origin') ?? request.get('referer');
  if (!source) return config.NODE_ENV !== 'production';
  try {
    const origin = new URL(source).origin;
    if (origin === expectedOrigin()) return true;
    if (config.NODE_ENV !== 'production' && ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)) return true;
    return false;
  } catch { return false; }
}

export async function requireCsrf(request: Request, _response: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  if (request.authMethod === 'bearer') return next();
  const surface = protectedSurface(request);
  const cookie = parseCookies(request)[csrfCookieName];
  const header = request.get('x-csrf-token');
  if (!surface || !requestOriginAllowed(request) || !cookie || !header || !constantTimeEqual(cookie, header)) {
    void securityEvent(request, !surface || !requestOriginAllowed(request) ? 'auth.origin_denied' : 'auth.csrf_denied');
    return next(new HttpError(403, 'The request origin could not be verified.', 'REQUEST_ORIGIN_DENIED'));
  }
  next();
}

function identityFromDecoded(decoded: DecodedIdToken, surface: ProtectedSurface, sessionHash: string, record: StaffSessionRecord): RequestIdentity {
  const role = decoded.role as StaffRole;
  const pharmacyId = typeof decoded.pharmacyId === 'string'
    ? decoded.pharmacyId
    : typeof decoded.organisationId === 'string'
      ? decoded.organisationId
      : null;
  const organisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : pharmacyId;
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    role,
    pharmacyId,
    organisationId,
    token: decoded,
    surface,
    sessionHash,
    idleExpiresAt: record.idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
  };
}

function validateRole(decoded: DecodedIdToken, surface: ProtectedSurface) {
  const role = decoded.role;
  if (typeof role !== 'string' || !allowedRoles.has(role as StaffRole)) throw new HttpError(403, 'The account has no permitted staff role.', 'ROLE_REQUIRED');
  if (surface === 'admin' && role !== 'hhh_admin') throw new HttpError(403, 'This account cannot access HHH administration.', 'FORBIDDEN');
  if (surface === 'pharmacy' && role !== 'pharmacy_staff') throw new HttpError(403, 'This account cannot access the pharmacy workspace.', 'FORBIDDEN');
  const organisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : decoded.pharmacyId;
  if (role === 'pharmacy_staff' && typeof organisationId !== 'string') throw new HttpError(403, 'The account is not assigned to a pharmacy.', 'TENANT_REQUIRED');
  return role as StaffRole;
}

function resolveSurface(decoded: DecodedIdToken, requested: RequestedSurface): ProtectedSurface {
  if (requested !== 'auto') return requested;
  if (decoded.role === 'hhh_admin') return 'admin';
  if (decoded.role === 'pharmacy_staff') return 'pharmacy';
  throw new HttpError(403, 'The account has no permitted staff role.', 'ROLE_REQUIRED');
}

async function activeStaff(decoded: DecodedIdToken, activateInvitation = false) {
  const profile = await firestore.collection('staffUsers').doc(decoded.uid).get();
  const data = profile.data();
  if (!data || data.disabled === true || ['disabled', 'removed'].includes(String(data.status))) throw new HttpError(403, 'This staff account has been disabled.', 'ACCOUNT_DISABLED');
  const claimOrganisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : typeof decoded.pharmacyId === 'string' ? decoded.pharmacyId : null;
  const profileOrganisationId = typeof data.organisationId === 'string' ? data.organisationId : typeof data.pharmacyId === 'string' ? data.pharmacyId : null;
  if (data.role !== decoded.role || profileOrganisationId !== claimOrganisationId) throw new HttpError(403, 'The staff account scope is invalid.', 'STAFF_SCOPE_INVALID');
  if (data.status === 'invited' && activateInvitation) {
    const activatedAt = nowIso();
    await profile.ref.set({ status: 'active', activatedAt, updatedAt: activatedAt }, { merge: true });
    return { ...data, status: 'active', activatedAt };
  }
  if (data.status !== 'active') throw new HttpError(403, 'This staff account is not active.', 'ACCOUNT_INACTIVE');
  return data;
}

export async function createStaffSession(request: Request, response: Response) {
  const requestedSurface = protectedSurface(request);
  if (!requestedSurface) throw new HttpError(403, 'The requested application surface is not permitted.', 'SURFACE_DENIED');
  if (!requestOriginAllowed(request)) throw new HttpError(403, 'The request origin could not be verified.', 'REQUEST_ORIGIN_DENIED');
  const cookieCsrf = parseCookies(request)[csrfCookieName];
  const headerCsrf = request.get('x-csrf-token');
  if (!cookieCsrf || !headerCsrf || !constantTimeEqual(cookieCsrf, headerCsrf)) throw new HttpError(403, 'The request origin could not be verified.', 'REQUEST_ORIGIN_DENIED');

  const { idToken } = sessionInputSchema.parse(request.body);
  const decoded = await auth.verifyIdToken(idToken, true);
  const authAgeMs = Date.now() - decoded.auth_time * 1000;
  if (authAgeMs < 0 || authAgeMs > 5 * 60 * 1000) throw new HttpError(401, 'Sign in again before starting a staff session.', 'RECENT_LOGIN_REQUIRED');
  if (!decoded.email_verified) throw new HttpError(403, 'Verify your email before using the staff portal.', 'EMAIL_NOT_VERIFIED');
  if (secondFactor(decoded) !== 'totp') throw new HttpError(403, 'A TOTP second-factor sign-in is required.', 'MFA_TOTP_REQUIRED');
  const surface = resolveSurface(decoded, requestedSurface);
  const role = validateRole(decoded, surface);
  const profile = await activeStaff(decoded, true);

  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_ABSOLUTE_MS });
  const sessionHash = sha256(sessionCookie);
  const now = Date.now();
  const organisationId = typeof decoded.organisationId === 'string'
    ? decoded.organisationId
    : typeof decoded.pharmacyId === 'string'
      ? decoded.pharmacyId
      : null;
  const record: StaffSessionRecord = {
    sessionHash,
    uid: decoded.uid,
    surface,
    role,
    organisationId,
    createdAt: new Date(now).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    idleExpiresAt: new Date(now + SESSION_IDLE_MS).toISOString(),
    absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    revokedAt: null,
    userAgentHash: sha256(request.get('user-agent') ?? 'unknown'),
    expiresAt: new Date(now + SESSION_ABSOLUTE_MS),
  };
  await firestore.collection('staffSessions').doc(sessionHash).create(record);
  response.cookie(sessionCookieName, sessionCookie, cookieOptions(true));
  const csrfToken = issueCsrf(request, response);
  request.identity = identityFromDecoded(decoded, surface, sessionHash, record);
  request.authMethod = 'session';
  await securityEvent(request, 'auth.session_created');
  return {
    uid: decoded.uid,
    email: decoded.email ?? '',
    displayName: typeof decoded.name === 'string' ? decoded.name : typeof profile?.displayName === 'string' ? profile.displayName : decoded.email ?? 'Staff user',
    role,
    organisationId,
    surface,
    idleExpiresAt: record.idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
    csrfToken,
  };
}

export async function authenticateSession(request: Request) {
  const requestedSurface = protectedSurface(request);
  if (!requestedSurface) throw new HttpError(403, 'The requested application surface is not permitted.', 'SURFACE_DENIED');
  const sessionCookie = parseCookies(request)[sessionCookieName];
  if (!sessionCookie) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  let decoded: DecodedIdToken;
  try { decoded = await auth.verifySessionCookie(sessionCookie, true); }
  catch { throw new HttpError(401, 'The staff session is invalid or expired.', 'UNAUTHENTICATED'); }
  const surface = resolveSurface(decoded, requestedSurface);
  validateRole(decoded, surface);
  await activeStaff(decoded);
  const sessionHash = sha256(sessionCookie);
  const reference = firestore.collection('staffSessions').doc(sessionHash);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new HttpError(401, 'The staff session is invalid or expired.', 'UNAUTHENTICATED');
  const record = snapshot.data() as StaffSessionRecord;
  const now = Date.now();
  if (record.revokedAt) throw new HttpError(401, 'The staff session has been revoked.', 'SESSION_REVOKED');
  if (record.surface !== surface || record.uid !== decoded.uid) throw new HttpError(403, 'The session cannot access this application.', 'FORBIDDEN');
  if (Date.parse(record.absoluteExpiresAt) <= now) throw new HttpError(401, 'The staff session has expired.', 'SESSION_EXPIRED');
  if (Date.parse(record.idleExpiresAt) <= now) {
    await reference.set({ revokedAt: nowIso(), revokeReason: 'idle_timeout', updatedAt: nowIso() }, { merge: true });
    throw new HttpError(401, 'The staff session ended after inactivity.', 'SESSION_IDLE_EXPIRED');
  }
  request.identity = identityFromDecoded(decoded, surface, sessionHash, record);
  request.authMethod = 'session';
  return request.identity;
}

export async function touchCurrentSession(request: Request) {
  const actor = request.identity;
  if (!actor?.sessionHash) return;
  const reference = firestore.collection('staffSessions').doc(actor.sessionHash);
  const snapshot = await reference.get();
  const record = snapshot.data() as StaffSessionRecord | undefined;
  const now = Date.now();
  if (!record || record.revokedAt || Date.parse(record.absoluteExpiresAt) <= now || Date.parse(record.idleExpiresAt) <= now) return;
  if (now - Date.parse(record.lastActivityAt) < SESSION_TOUCH_INTERVAL_MS) return;
  const lastActivityAt = new Date(now).toISOString();
  const idleExpiresAt = new Date(now + SESSION_IDLE_MS).toISOString();
  await reference.set({ lastActivityAt, idleExpiresAt, updatedAt: lastActivityAt }, { merge: true });
  actor.idleExpiresAt = idleExpiresAt;
}

export function registerActivityOnSuccess(request: Request, response: Response) {
  response.once('finish', () => {
    if (response.statusCode < 400) void touchCurrentSession(request).catch(() => undefined);
  });
}

export async function sessionPayload(request: Request, response: Response) {
  const actor = request.identity;
  if (!actor?.surface || !actor.idleExpiresAt || !actor.absoluteExpiresAt) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  const profile = await firestore.collection('staffUsers').doc(actor.uid).get();
  const csrfToken = issueCsrf(request, response);
  return {
    uid: actor.uid,
    email: actor.email ?? '',
    displayName: typeof profile.data()?.displayName === 'string' ? profile.data()!.displayName : actor.token.name ?? actor.email ?? 'Staff user',
    role: actor.role,
    organisationId: actor.organisationId,
    surface: actor.surface,
    idleExpiresAt: actor.idleExpiresAt,
    absoluteExpiresAt: actor.absoluteExpiresAt,
    csrfToken,
  };
}

export async function revokeCurrentSession(request: Request, response: Response, reason = 'logout') {
  const sessionHash = request.identity?.sessionHash;
  if (sessionHash) await firestore.collection('staffSessions').doc(sessionHash).set({ revokedAt: nowIso(), revokeReason: reason, updatedAt: nowIso() }, { merge: true });
  response.clearCookie(sessionCookieName, cookieOptions(true, 0));
  response.clearCookie(csrfCookieName, cookieOptions(false, 0));
  await securityEvent(request, reason === 'logout' ? 'auth.logout' : 'auth.session_revoked', { reason });
}

export async function revokeUserSessions(uid: string, reason: string) {
  const sessions = await firestore.collection('staffSessions').where('uid', '==', uid).where('revokedAt', '==', null).get();
  if (sessions.empty) return;
  const batch = firestore.batch();
  const revokedAt = nowIso();
  for (const document of sessions.docs) batch.set(document.ref, { revokedAt, revokeReason: reason, updatedAt: revokedAt }, { merge: true });
  await batch.commit();
}

export function clearSessionCookies(response: Response) {
  response.clearCookie(sessionCookieName, cookieOptions(true, 0));
  response.clearCookie(csrfCookieName, cookieOptions(false, 0));
}

export function requestSurfaceHost(request: Request) {
  return requestHostname(request);
}
