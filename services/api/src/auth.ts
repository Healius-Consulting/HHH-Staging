import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { appCheck, auth } from './firebase.js';
import { HttpError } from './http.js';
import type { RequestIdentity, StaffRole } from './types.js';

const roleSchema = z.enum(['hhh_admin', 'pharmacy_staff']);
const organisationIdSchema = z.string().min(1).max(128);

function bearer(request: Request) {
  const match = request.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  return match[1];
}

export async function requireStaff(request: Request, _response: Response, next: NextFunction) {
  try {
    if (config.REQUIRE_APP_CHECK === 'true') {
      const appCheckToken = request.get('x-firebase-appcheck');
      if (!appCheckToken) throw new HttpError(401, 'App attestation is required.', 'APP_CHECK_REQUIRED');
      await appCheck.verifyToken(appCheckToken);
    }

    const decoded = await auth.verifyIdToken(bearer(request), true);
    if (!decoded.email_verified) throw new HttpError(403, 'Verify your email before using the staff portal.', 'EMAIL_NOT_VERIFIED');
    const role = roleSchema.safeParse(decoded.role);
    if (!role.success) throw new HttpError(403, 'The account has no permitted staff role.', 'ROLE_REQUIRED');
    const organisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : null;
    if (role.data === 'pharmacy_staff' && !organisationId) throw new HttpError(403, 'The account is not assigned to a pharmacy.', 'TENANT_REQUIRED');

    const secondFactor = (decoded.firebase as Record<string, unknown> | undefined)?.sign_in_second_factor;
    if (config.REQUIRE_MFA === 'true' && !secondFactor) throw new HttpError(403, 'Multi-factor authentication is required.', 'MFA_REQUIRED');
    if (decoded.auth_time * 1000 < Date.now() - 8 * 60 * 60 * 1000) throw new HttpError(401, 'Your staff session has expired. Sign in again.', 'SESSION_EXPIRED');

    request.identity = { uid: decoded.uid, email: decoded.email ?? null, role: role.data, organisationId, token: decoded };
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'The staff session is invalid or expired.', 'UNAUTHENTICATED'));
  }
}

export function requireRole(...roles: StaffRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.identity || !roles.includes(request.identity.role)) return next(new HttpError(403, 'You do not have access to this action.', 'FORBIDDEN'));
    next();
  };
}

export function identity(request: Request): RequestIdentity {
  if (!request.identity) throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  return request.identity;
}

export function tenantFor(request: Request, requested?: unknown): string {
  const actor = identity(request);
  if (actor.role === 'pharmacy_staff') {
    if (requested !== undefined && requested !== actor.organisationId) throw new HttpError(403, 'Cross-pharmacy access is not permitted.', 'TENANT_MISMATCH');
    return actor.organisationId!;
  }
  const parsed = organisationIdSchema.safeParse(requested);
  if (!parsed.success) throw new HttpError(400, 'organisationId is required for this action.', 'TENANT_REQUIRED');
  return parsed.data;
}
