import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlIntakeRepository } from '../../repositories/sql/intake.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { SqlPatientRepository } from '../../repositories/sql/patient.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertPlatformScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { buildPatientRegister, type PatientRegisterFilters } from './patient-register.js';

const organisationIdSchema = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
const filtersSchema = z.object({
  query: z.string().max(300).default(''),
  organisationId: z.union([organisationIdSchema, z.literal('all')]).default('all'),
  status: z.string().max(100).default('all'),
  from: z.iso.date().nullable().default(null),
  to: z.iso.date().nullable().default(null),
}).strict();

export function createAdminPatientRouter(): Router {
  const router = Router();
  const patientRepo = new SqlPatientRepository();
  const intakeRepo = new SqlIntakeRepository();
  const organisationRepo = new SqlOrganisationRepository();
  const identityRepo = new SqlIdentityRepository();

  async function load(filters: PatientRegisterFilters) {
    const [patients, submissions, organisations] = await Promise.all([
      patientRepo.listPlatformPatients(),
      intakeRepo.listPlatformSubmissions(20_001),
      organisationRepo.listOrganisations(),
    ]);
    if (patients.length > 20_000 || submissions.length > 20_000) {
      throw new HttpError(413, 'The patient register is too large for a single export. Narrow the filters and try again.', 'EXPORT_SCOPE_TOO_LARGE');
    }
    return buildPatientRegister(patients, submissions, organisations, filters);
  }

  router.get('/portal/admin/patient-register', requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertPlatformScope(req.context!);
      const filters = filtersSchema.parse({
        query: req.query.query,
        organisationId: req.query.organisationId,
        status: req.query.status,
        from: req.query.from ?? null,
        to: req.query.to ?? null,
      });
      const result = await load(filters);
      await identityRepo.appendAudit({
        actorUid: scope.uid, actorRole: scope.role, event: 'patient_register.viewed',
        requestId: scope.requestId, sessionHashPrefix: scope.sessionHash.slice(0, 12), surface: 'admin',
        details: { organisationId: filters.organisationId, resultCount: result.resultCount },
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  router.post('/portal/admin/patient-exports', requireCsrf, requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertPlatformScope(req.context!);
      const input = filtersSchema.extend({ expectedScopeHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
      const { expectedScopeHash, ...filters } = input;
      const result = await load(filters);
      if (result.recordScopeHash !== expectedScopeHash) {
        throw new HttpError(409, 'The patient register changed after it was displayed. Refresh before exporting.', 'EXPORT_SCOPE_CHANGED');
      }
      await identityRepo.appendAudit({
        actorUid: scope.uid, actorRole: scope.role, event: 'patient_register.exported',
        requestId: scope.requestId, sessionHashPrefix: scope.sessionHash.slice(0, 12), surface: 'admin',
        details: { organisationId: filters.organisationId, resultCount: result.resultCount, recordScopeHash: result.recordScopeHash },
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  return router;
}
