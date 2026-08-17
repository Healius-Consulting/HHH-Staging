import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { SessionService } from '../../application/identity/session.service.js';
import { HttpError } from '../../domain/common/errors.js';
import { cookieOptions, csrfCookieName, issueCsrf, requireCsrf } from '../../security/csrf.js';
import type { ProtectedSurface } from '../../security/request-context.js';
import { requireStaff, sessionCookieName } from '../../security/require-staff.js';
import { assertTenantScope } from '../../security/request-context.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { toPortalOrganisation } from '../portal/pharmacy-contracts.js';

const sessionInputSchema = z.object({
  idToken: z.string().min(100).max(20_000),
});

export function createAuthRouter(): Router {
  const router = Router();
  const sessionService = new SessionService();
  const identityRepo = new SqlIdentityRepository();
  const organisationRepo = new SqlOrganisationRepository();

  // GET /v1/auth/csrf - Issue or refresh CSRF token
  router.get('/auth/csrf', (req: Request, res: Response) => {
    const csrfToken = issueCsrf(req, res);
    res.json({ csrfToken });
  });

  // POST /v1/auth/session - Exchange ID token for session cookie
  router.post('/auth/session', requireCsrf, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { idToken } = sessionInputSchema.parse(req.body);
      const requestedSurface = (req.query.__hhh_surface as ProtectedSurface | 'auto') || 'auto';
      const userAgent = req.get('user-agent') || 'unknown';

      const result = await sessionService.createSession({
        idToken,
        requestedSurface,
        userAgent,
      });

      // Set secure HTTP-only session cookie
      res.cookie(sessionCookieName, result.sessionCookie, cookieOptions(true));
      const csrfToken = issueCsrf(req, res);

      res.status(200).json({
        uid: result.uid,
        email: result.email,
        displayName: result.displayName,
        role: result.role.toLowerCase(),
        organisationId: result.organisationId,
        surface: result.surface,
        idleExpiresAt: result.idleExpiresAt,
        absoluteExpiresAt: result.absoluteExpiresAt,
        csrfToken,
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/auth/session - Get current authentication session.
  const getSessionHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.context || req.context.kind === 'public') {
        throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
      }
      const payload = await sessionService.getSessionPayload(req.context);
      const csrfToken = issueCsrf(req, res);
      res.json({ ...payload, csrfToken });
    } catch (error) {
      next(error);
    }
  };

  router.get('/auth/session', requireStaff('any'), getSessionHandler);

  // GET /v1/portal/session - Return the tenant profile contract consumed by
  // the pharmacy shell. The organisation is resolved from the admitted SQL
  // tenant scope, never from a caller-supplied identifier.
  router.get('/portal/session', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const [payload, staff, organisation] = await Promise.all([
        sessionService.getSessionPayload(scope),
        identityRepo.findStaffUser(scope.uid),
        organisationRepo.findOrganisationById(scope.organisationId),
      ]);
      if (!staff || !organisation) {
        throw new HttpError(403, 'The pharmacy account is not fully provisioned.', 'TENANT_REQUIRED');
      }
      const csrfToken = issueCsrf(req, res);
      res.status(200).json({
        ...payload,
        csrfToken,
        pharmacyId: scope.organisationId,
        profile: {
          uid: staff.uid,
          organisationId: staff.organisationId,
          email: staff.email,
          displayName: staff.displayName,
          role: staff.role.toLowerCase(),
          status: staff.status.toLowerCase(),
          disabled: staff.disabled,
        },
        organisation: toPortalOrganisation(organisation),
      });
    } catch (error) {
      next(error);
    }
  });


  // DELETE /v1/auth/session - Log out and revoke session
  router.delete('/auth/session', requireCsrf, requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.context && req.context.kind !== 'public') {
        await sessionService.revokeSession(req.context.sessionHash, 'logout');
      }
      res.clearCookie(sessionCookieName, cookieOptions(true, 0));
      res.clearCookie(csrfCookieName, cookieOptions(false, 0));
      res.status(200).json({ status: 'logged_out' });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/auth/activity - Touch and return the complete refreshed session
  router.post('/auth/activity', requireCsrf, requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.context || req.context.kind === 'public') {
        throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
      }
      const payload = await sessionService.getSessionPayload(req.context);
      const csrfToken = issueCsrf(req, res);
      res.status(200).json({ ...payload, csrfToken });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
