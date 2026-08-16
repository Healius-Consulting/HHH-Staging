import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const setupTaskInputSchema = z.object({
  taskId: z.string().min(1).max(100),
  completed: z.boolean(),
  evidence: z.string().max(2000).nullable().optional(),
});

const preferencesInputSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  notifications: z.record(z.string(), z.boolean()).optional(),
}).passthrough();

export function createPortalSetupRouter(): Router {
  const router = Router();
  const organisationRepo = new SqlOrganisationRepository();
  const identityRepo = new SqlIdentityRepository();

  // GET /v1/portal/setup/tasks - List setup checklist tasks for tenant
  router.get('/portal/setup/tasks', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const tasks = await organisationRepo.listSetupTasks(scope.organisationId);
      res.status(200).json({ tasks });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/setup/tasks - Update task completion status
  router.post('/portal/setup/tasks', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = setupTaskInputSchema.parse(req.body);

      await organisationRepo.upsertSetupTask({
        organisationId: scope.organisationId,
        taskCode: input.taskId,
        completed: input.completed,
        evidence: input.evidence,
        completedByUid: scope.uid,
      });

      res.status(200).json({ status: 'ok', taskId: input.taskId, completed: input.completed });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/preferences - Get user UI preferences
  router.get('/portal/preferences', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const staff = await identityRepo.findStaffUser(scope.uid);
      res.status(200).json(staff?.preferences ?? { theme: 'light' });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/preferences - Update user UI preferences
  router.post('/portal/preferences', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const preferences = preferencesInputSchema.parse(req.body);

      await organisationRepo.updateStaffPreferences(scope.uid, preferences);
      res.status(200).json(preferences);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
