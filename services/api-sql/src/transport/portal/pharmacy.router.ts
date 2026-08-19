import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { buildOrganisationProfileUpdate, syncDirectoryProfileFromOrganisation } from '../../application/organisation/profile-sync.js';
import { HttpError } from '../../domain/common/errors.js';
import { pharmacyOperationalAccess } from '../../domain/organisation/access.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { SqlDirectoryRepository } from '../../repositories/sql/directory.sql.js';
import { SqlPatientRepository } from '../../repositories/sql/patient.sql.js';
import { SqlIntakeRepository } from '../../repositories/sql/intake.sql.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlIntegrationRepository } from '../../repositories/sql/integration.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { buildPharmacyPatientDirectory, buildSqlPharmacyOverview, toPortalOrganisation, toPortalPatient, toPortalPendingEnquiry } from './pharmacy-contracts.js';

const pharmacyProfileInputSchema = z.object({
  tradingName: z.string().trim().min(2).max(160).optional(),
  name: z.string().trim().min(2).max(160).optional(),
  gphcNumber: z.string().trim().min(3).max(40).optional(),
  superintendent: z.string().trim().min(2).max(160).optional(),
  addressLine1: z.string().trim().min(1).max(250).optional(),
  addressLine2: z.string().trim().max(250).optional(),
  locality: z.string().trim().min(1).max(120).optional(),
  county: z.string().trim().max(120).optional(),
  postcode: z.string().trim().min(2).max(16).optional(),
  mainContactName: z.string().trim().max(160).optional(),
  mainContactPhone: z.string().trim().max(40).optional(),
  mainContactEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'At least one pharmacy detail must be supplied.' });

export function createPortalPharmacyRouter(): Router {
  const router = Router();
  const patientRepo = new SqlPatientRepository();
  const orderRepo = new SqlOrderRepository();
  const organisationRepo = new SqlOrganisationRepository();
  const directoryRepo = new SqlDirectoryRepository();
  const intakeRepo = new SqlIntakeRepository();
  const identityRepo = new SqlIdentityRepository();
  const integrationRepo = new SqlIntegrationRepository();

  async function operationalRecords(organisationId: string) {
    const organisation = await organisationRepo.findOrganisationById(organisationId);
    if (!organisation) {
      throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
    }
    if (!pharmacyOperationalAccess(organisation)) {
      return { organisation, patients: [], orders: [], pendingEnquiries: [] };
    }
    const [patients, orders, pendingEnquiries] = await Promise.all([
      patientRepo.listTenantPatients(organisationId),
      orderRepo.listTenantOrders(organisationId),
      intakeRepo.listTenantPendingEnquiries(organisationId),
    ]);
    return { organisation, patients, orders, pendingEnquiries };
  }

  router.get('/portal/patient-directory', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const { patients, pendingEnquiries } = await operationalRecords(scope.organisationId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(buildPharmacyPatientDirectory({ patients, pendingEnquiries }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/patients', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const { patients } = await operationalRecords(scope.organisationId);
      res.status(200).json(patients.map(toPortalPatient));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/enquiries', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const { pendingEnquiries } = await operationalRecords(scope.organisationId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(pendingEnquiries.map(toPortalPendingEnquiry));
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/overview', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const [{ organisation, patients, orders, pendingEnquiries }, curaleaf, worldpay] = await Promise.all([
        operationalRecords(scope.organisationId),
        integrationRepo.findConnection(scope.organisationId, 'CURALEAF'),
        integrationRepo.findConnection(scope.organisationId, 'WORLDPAY'),
      ]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(buildSqlPharmacyOverview({
        organisation,
        patients,
        orders,
        pendingEnquiries,
        connections: [curaleaf, worldpay].filter((connection): connection is NonNullable<typeof connection> => Boolean(connection)),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/portal/organisation/profile', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = pharmacyProfileInputSchema.parse(req.body);
      const current = await organisationRepo.findOrganisationById(scope.organisationId);
      if (!current) {
        throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
      }
      const profileUpdate = await buildOrganisationProfileUpdate(current, input);
      await organisationRepo.updateOrganisationProfile(scope.organisationId, profileUpdate);
      await syncDirectoryProfileFromOrganisation(directoryRepo, scope.organisationId, profileUpdate);
      const updated = await organisationRepo.findOrganisationById(scope.organisationId);
      if (!updated) {
        throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
      }
      await identityRepo.appendAudit({
        organisationId: scope.organisationId,
        actorUid: scope.uid,
        actorRole: scope.role,
        event: 'organisation.profile_updated',
        recordType: 'Organisation',
        recordId: scope.organisationId,
        requestId: scope.requestId,
        sessionHashPrefix: scope.sessionHash.slice(0, 12),
        surface: scope.surface,
        details: { changedFields: Object.keys(input) },
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(toPortalOrganisation(updated));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
