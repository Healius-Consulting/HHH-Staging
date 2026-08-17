import { Router, type NextFunction, type Request, type Response } from 'express';
import { HttpError } from '../../domain/common/errors.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { SqlPatientRepository } from '../../repositories/sql/patient.sql.js';
import { SqlIntakeRepository } from '../../repositories/sql/intake.sql.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { buildPharmacyPatientDirectory, buildSqlPharmacyOverview, toPortalPatient, toPortalPendingEnquiry } from './pharmacy-contracts.js';

export function createPortalPharmacyRouter(): Router {
  const router = Router();
  const patientRepo = new SqlPatientRepository();
  const orderRepo = new SqlOrderRepository();
  const organisationRepo = new SqlOrganisationRepository();
  const intakeRepo = new SqlIntakeRepository();

  router.get('/portal/patient-directory', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const [patients, pendingEnquiries] = await Promise.all([
        patientRepo.listTenantPatients(scope.organisationId),
        intakeRepo.listTenantPendingEnquiries(scope.organisationId),
      ]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(buildPharmacyPatientDirectory({ patients, pendingEnquiries }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/patients', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const patients = await patientRepo.listTenantPatients(scope.organisationId);
      res.status(200).json(patients.map(toPortalPatient));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/enquiries', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const pendingEnquiries = await intakeRepo.listTenantPendingEnquiries(scope.organisationId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(pendingEnquiries.map(toPortalPendingEnquiry));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/overview', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const [organisation, patients, orders, pendingEnquiries] = await Promise.all([
        organisationRepo.findOrganisationById(scope.organisationId),
        patientRepo.listTenantPatients(scope.organisationId),
        orderRepo.listTenantOrders(scope.organisationId),
        intakeRepo.listTenantPendingEnquiries(scope.organisationId),
      ]);
      if (!organisation) {
        throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(buildSqlPharmacyOverview({ organisation, patients, orders, pendingEnquiries }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
