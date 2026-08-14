import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { authMode, config } from './config.js';
import { appCheck, auth } from './firebase.js';
import { HttpError } from './http.js';
import { authenticateSession, clearSessionCookies, registerActivityOnSuccess, securityEvent, sessionCookieName } from './session-auth.js';
import { parseCookies } from './session-utils.js';
import type { RequestIdentity, StaffRole } from './types.js';

const roleSchema = z.enum(['hhh_admin', 'pharmacy_staff']);
const organisationIdSchema = z.string().min(1).max(128);

function bearer(request: Request) {
  const match = request.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  return match[1];
}

export async function requireStaff(request: Request, response: Response, next: NextFunction) {
  try {
    if (config.REQUIRE_APP_CHECK === 'true') {
      const appCheckToken = request.get('x-firebase-appcheck');
      if (!appCheckToken) throw new HttpError(401, 'App attestation is required.', 'APP_CHECK_REQUIRED');
      await appCheck.verifyToken(appCheckToken);
    }

    const hasSessionCookie = Boolean(parseCookies(request)[sessionCookieName]);
    if (authMode === 'cookie-enforced' || authMode === 'cookie-dual' && hasSessionCookie) {
      await authenticateSession(request);
      registerActivityOnSuccess(request, response);
      next();
      return;
    }

    const decoded = await auth.verifyIdToken(bearer(request), true);
    if (!decoded.email_verified) throw new HttpError(403, 'Verify your email before using the staff portal.', 'EMAIL_NOT_VERIFIED');
    const role = roleSchema.safeParse(decoded.role);
    if (!role.success) throw new HttpError(403, 'The account has no permitted staff role.', 'ROLE_REQUIRED');
    const pharmacyId = typeof decoded.pharmacyId === 'string' ? decoded.pharmacyId : (typeof decoded.organisationId === 'string' ? decoded.organisationId : null);
    const organisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : pharmacyId;
    if (role.data === 'pharmacy_staff' && !pharmacyId) throw new HttpError(403, 'The account is not assigned to a pharmacy.', 'TENANT_REQUIRED');

    const secondFactor = (decoded.firebase as Record<string, unknown> | undefined)?.sign_in_second_factor;
    if (config.REQUIRE_MFA === 'true' && !secondFactor) throw new HttpError(403, 'Multi-factor authentication is required.', 'MFA_REQUIRED');
    if (decoded.auth_time * 1000 < Date.now() - 8 * 60 * 60 * 1000) throw new HttpError(401, 'Your staff session has expired. Sign in again.', 'SESSION_EXPIRED');

    request.identity = { uid: decoded.uid, email: decoded.email ?? null, role: role.data, pharmacyId, organisationId, token: decoded };
    request.authMethod = 'bearer';
    next();
  } catch (error) {
    const failure = error instanceof HttpError ? error : new HttpError(401, 'The staff session is invalid or expired.', 'UNAUTHENTICATED');
    if (failure.status === 401 && failure.code !== 'APP_CHECK_REQUIRED') clearSessionCookies(response);
    const event = failure.code === 'APP_CHECK_REQUIRED' ? 'auth.app_check_denied'
      : failure.code === 'TENANT_MISMATCH' || failure.code === 'TENANT_REQUIRED' ? 'auth.tenant_mismatch'
        : failure.code === 'FORBIDDEN' || failure.code === 'ROLE_REQUIRED' ? 'auth.role_denied'
          : failure.code === 'SESSION_IDLE_EXPIRED' ? 'auth.session_expired_idle'
            : failure.code === 'SESSION_EXPIRED' ? 'auth.session_expired_absolute'
              : 'auth.session_rejected';
    void securityEvent(request, event, { code: failure.code });
    next(failure);
  }
}

export function requireRole(...roles: StaffRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.identity || !roles.includes(request.identity.role)) {
      void securityEvent(request, 'auth.role_denied', { requiredRoles: roles });
      return next(new HttpError(403, 'You do not have access to this action.', 'FORBIDDEN'));
    }
    next();
  };
}

export function identity(request: Request): RequestIdentity {
  if (!request.identity) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  return request.identity;
}

export function tenantFor(request: Request, requested?: unknown): string {
  const actor = identity(request);
  const activePharmacyId = actor.pharmacyId ?? actor.organisationId;
  if (actor.role === 'pharmacy_staff') {
    if (requested !== undefined && requested !== activePharmacyId) {
      Object.assign(request, { securityDenial: 'tenant_mismatch' });
      throw new HttpError(404, 'The requested record was not found.', 'NOT_FOUND');
    }
    return activePharmacyId!;
  }
  const parsed = organisationIdSchema.safeParse(requested);
  if (!parsed.success) throw new HttpError(400, 'pharmacyId is required for this action.', 'TENANT_REQUIRED');
  return parsed.data;
}
