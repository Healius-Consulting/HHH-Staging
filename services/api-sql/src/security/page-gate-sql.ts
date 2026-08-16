import { auth } from '../bootstrap/firebase.js';
import { SqlIdentityRepository } from '../repositories/sql/identity.sql.js';
import { validatePortalAdmission } from './admission.js';
import type { ProtectedSurface } from './request-context.js';
import { SESSION_IDLE_MS, SESSION_TOUCH_INTERVAL_MS, sha256 } from './session-utils.js';

export interface GateAdmissionDecision {
  allowed: boolean;
  status: number;
  code?: string;
  errorMessage?: string;
  actorUid?: string;
  organisationId?: string | null;
}

const identityRepo = new SqlIdentityRepository();

export async function evaluateGateAdmission(
  sessionCookie: string | undefined,
  surface: ProtectedSurface
): Promise<GateAdmissionDecision> {
  if (!sessionCookie) {
    return { allowed: false, status: 401, code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Verify session cookie with Firebase Auth
    const claims = await auth.verifySessionCookie(sessionCookie, true);
    const sessionHash = sha256(sessionCookie);

    // 2. Query SQL Connect for session + staff record
    const admission = await identityRepo.findAdmission(sessionHash, claims.uid);

    // 3. Pure security validation
    const failure = validatePortalAdmission({
      claims,
      admission,
      sessionHash,
      surface,
    });

    if (failure) {
      // If idle expired, asynchronously mark session revoked in SQL
      if (failure.code === 'SESSION_IDLE_EXPIRED') {
        const revokedAt = new Date().toISOString();
        void identityRepo.revokeSession(sessionHash, revokedAt, 'idle_timeout').catch(() => undefined);
      }

      return {
        allowed: false,
        status: failure.status,
        code: failure.code,
        actorUid: claims.uid,
        organisationId: typeof claims.organisationId === 'string' ? claims.organisationId : null,
      };
    }

    const session = admission.session!;
    const staff = admission.staff!;
    const now = Date.now();

    // 4. Debounced Session Touch (5 minutes debounce to avoid database write storms)
    const lastActivity = Date.parse(session.lastActivityAt);
    if (Number.isFinite(lastActivity) && now - lastActivity >= SESSION_TOUCH_INTERVAL_MS) {
      const lastActivityAt = new Date(now).toISOString();
      const idleExpiresAt = new Date(now + SESSION_IDLE_MS).toISOString();
      void identityRepo.touchSession(sessionHash, lastActivityAt, idleExpiresAt).catch(() => undefined);
    }

    return {
      allowed: true,
      status: 200,
      actorUid: staff.uid,
      organisationId: staff.organisationId,
    };
  } catch {
    return { allowed: false, status: 401, code: 'INVALID_OR_EXPIRED' };
  }
}
