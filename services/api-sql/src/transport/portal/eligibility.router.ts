import { Router, type Request, type Response, type NextFunction } from 'express';
import { SqlIntakeRepository } from '../../repositories/sql/intake.sql.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

export function createPortalEligibilityRouter(): Router {
  const router = Router();
  const intakeRepo = new SqlIntakeRepository();

  // GET /v1/portal/eligibility-submissions - Tenant-scoped queue
  router.get('/portal/eligibility-submissions', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const items = await intakeRepo.listTenantQueue(scope.organisationId);

      const formatted = items.map(item => ({
        id: item.id,
        caseReference: item.id.slice(0, 8).toUpperCase(),
        patientDisplayName: `${item.firstName} ${item.surname}`,
        submittedAt: item.submittedAt,
        displayStatus: item.pharmacyReviewStatus,
        assignmentStatus: item.assignmentStatus,
        pharmacyReviewStatus: item.pharmacyReviewStatus,
        outcomeStatus: item.outcomeStatus,
        followUpStatus: item.followUpStatus,
        firstName: item.firstName,
        surname: item.surname,
        mobile: item.mobile,
        email: item.email,
        postcode: item.postcode,
      }));

      res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
