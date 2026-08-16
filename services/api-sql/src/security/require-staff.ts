import type { NextFunction, Request, Response } from 'express';
import { auth } from '../bootstrap/firebase.js';
import { secureSessionCookies } from '../bootstrap/config.js';
import { HttpError } from '../domain/common/errors.js';
import { SqlIdentityRepository } from '../repositories/sql/identity.sql.js';
import { validatePortalAdmission } from './admission.js';
import type { PlatformScope, ProtectedSurface, RequestContext, TenantScope } from './request-context.js';
import { parseCookies, SESSION_TOUCH_INTERVAL_MS, sha256 } from './session-utils.js';

export const sessionCookieName = secureSessionCookies ? '__Host-hhh_session' : 'hhh_session';

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      requestId?: string;
    }
  }
}

const identityRepo = new SqlIdentityRepository();

export function requireStaff(expectedSurface: ProtectedSurface) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionCookie = parseCookies(request)[sessionCookieName];
      if (!sessionCookie) {
        throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
      }

      // 1. Verify session cookie against Firebase Auth
      let claims;
      try {
        claims = await auth.verifySessionCookie(sessionCookie, true);
      } catch {
        throw new HttpError(401, 'The staff session is invalid or expired.', 'UNAUTHENTICATED');
      }

      // 2. Query SQL Connect for active session and staff user
      const sessionHash = sha256(sessionCookie);
      const admission = await identityRepo.findAdmission(sessionHash, claims.uid);

      // 3. Perform pure validation
      const failure = validatePortalAdmission({
        claims,
        admission,
        sessionHash,
        surface: expectedSurface,
      });

      if (failure) {
        throw new HttpError(failure.status, 'Session admission failed.', failure.code);
      }

      const session = admission.session!;
      const staff = admission.staff!;
      const requestId = (request.headers['x-request-id'] as string) || crypto.randomUUID();
      request.requestId = requestId;

      // 4. Build immutable RequestContext
      if (staff.role === 'PHARMACY_STAFF') {
        const tenantScope: TenantScope = {
          kind: 'tenant',
          organisationId: staff.organisationId!,
          uid: staff.uid,
          email: staff.email,
          role: 'PHARMACY_STAFF',
          surface: 'pharmacy',
          sessionHash,
          requestId,
          idleExpiresAt: session.idleExpiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        };
        request.context = tenantScope;
      } else {
        const platformScope: PlatformScope = {
          kind: 'platform',
          uid: staff.uid,
          email: staff.email,
          role: 'HHH_ADMIN',
          surface: 'admin',
          sessionHash,
          requestId,
          idleExpiresAt: session.idleExpiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        };
        request.context = platformScope;
      }

      // 5. Debounced Session Touch (5 minutes debounce)
      const now = Date.now();
      const lastActivity = Date.parse(session.lastActivityAt);
      if (Number.isFinite(lastActivity) && now - lastActivity >= SESSION_TOUCH_INTERVAL_MS) {
        const lastActivityAt = new Date(now).toISOString();
        const idleExpiresAt = new Date(now + 15 * 60 * 1000).toISOString();
        void identityRepo.touchSession(sessionHash, lastActivityAt, idleExpiresAt).catch(() => undefined);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
