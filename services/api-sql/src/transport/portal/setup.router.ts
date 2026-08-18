import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ReferralLinkService } from '../../application/referrals/referral-link.service.js';
import { HttpError } from '../../domain/common/errors.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertPlatformScope, assertTenantScope, type RequestContext } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { toPortalOrganisation } from './pharmacy-contracts.js';

const setupDefinitions = [
  { id: 'pharmacy_profile', required: true },
  { id: 'curaleaf_account', required: true },
  { id: 'payment_route', required: true },
  { id: 'pricing', required: true },
  { id: 'notifications', required: true },
  { id: 'operational_readiness', required: true },
] as const;

const setupTaskIdSchema = z.enum(setupDefinitions.map(task => task.id) as [
  typeof setupDefinitions[number]['id'],
  ...Array<typeof setupDefinitions[number]['id']>,
]);

const setupTaskInputSchema = z.object({
  taskId: z.string().min(1).max(100),
  completed: z.boolean(),
  evidence: z.string().max(2000).nullable().optional(),
});

const preferencesInputSchema = z.object({
  theme: z.enum(['light', 'dark']),
  textScale: z.enum(['default', 'large', 'larger']),
  reduceMotion: z.boolean(),
  enhancedFocus: z.boolean(),
  underlineLinks: z.boolean(),
  overviewView: z.enum(['today', 'handover', 'operations', 'pipeline']).optional(),
}).strict();

const organisationIdSchema = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i);

const createOrganisationInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  tradingName: z.string().trim().min(2).max(160),
  gphcNumber: z.string().trim().min(3).max(40),
  superintendent: z.string().trim().min(2).max(160),
  companyNumber: z.string().trim().max(40).optional(),
  mainContactName: z.string().trim().max(160).optional(),
  mainContactPhone: z.string().trim().max(40).optional(),
  mainContactEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
  address: z.string().trim().min(5).max(500),
  primaryColour: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoText: z.string().trim().min(1).max(4).regex(/^[A-Za-z0-9]+$/),
  websiteDomains: z.array(z.string().trim().min(1).max(300)).max(10),
  status: z.literal('onboarding'),
}).strict();

function normaliseHostname(input: string) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new HttpError(400, 'A pharmacy website domain is invalid.', 'INVALID_DOMAIN');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '')) {
    throw new HttpError(400, 'Enter website hostnames without paths, credentials or ports.', 'INVALID_DOMAIN');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname.includes('.') || hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname)) {
    throw new HttpError(400, 'A pharmacy website domain is invalid.', 'INVALID_DOMAIN');
  }
  return hostname;
}

const defaultPreferences = {
  theme: 'light' as const,
  textScale: 'default' as const,
  reduceMotion: false,
  enhancedFocus: false,
  underlineLinks: false,
};

function authenticatedStaff(context: RequestContext | undefined) {
  if (!context || context.kind === 'public') {
    throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  }
  return context;
}

function setupStatus(
  organisationId: string,
  records: Awaited<ReturnType<SqlOrganisationRepository['listSetupTasks']>>,
  legacyLiveFallback: boolean,
) {
  const byCode = new Map(records.map(record => [record.taskCode, record]));
  const tasks = setupDefinitions.map(definition => {
    const record = byCode.get(definition.id);
    const completed = record?.completed === true || (legacyLiveFallback && !record);
    return {
      id: definition.id,
      completed,
      completedAt: record?.completedAt ?? null,
      completedBy: record?.completedByUid ?? null,
      evidence: record?.evidence ?? null,
    };
  });
  const completedCount = tasks.filter(task => task.completed).length;
  const updatedAt = records
    .map(record => record.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
    organisationId,
    completed: completedCount === setupDefinitions.length,
    completedCount,
    requiredCount: setupDefinitions.length,
    tasks,
    updatedAt,
  };
}

export function createPortalSetupRouter(): Router {
  const router = Router();
  const organisationRepo = new SqlOrganisationRepository();
  const identityRepo = new SqlIdentityRepository();
  const referralLinks = new ReferralLinkService(organisationRepo);

  // Legacy-compatible setup status used by the current pharmacy shell. A
  // pre-cutover LIVE organisation with no migrated task rows remains live;
  // this is a read projection only and does not manufacture compliance rows.
  router.get('/portal/setup', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const [records, organisation] = await Promise.all([
        organisationRepo.listSetupTasks(scope.organisationId),
        organisationRepo.findOrganisationById(scope.organisationId),
      ]);
      if (!organisation) throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
      const legacyLiveFallback = organisation.status === 'LIVE' && records.length === 0;
      res.status(200).json(setupStatus(scope.organisationId, records, legacyLiveFallback));
    } catch (error) {
      next(error);
    }
  });

  // Platform staff need an aggregate, read-only projection. Calling the
  // tenant-only endpoint above from admin was both incorrect and noisy.
  router.get('/portal/admin/setup-status', requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertPlatformScope(req.context!);
      const organisations = await organisationRepo.listOrganisations();
      const statuses = await Promise.all(organisations.map(async organisation => {
        const records = await organisationRepo.listSetupTasks(organisation.id);
        return setupStatus(organisation.id, records, organisation.status === 'LIVE' && records.length === 0);
      }));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ records: statuses });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/portal/setup/:taskId', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const taskId = setupTaskIdSchema.parse(req.params.taskId);
      if (taskId === 'curaleaf_account') {
        throw new HttpError(403, 'Curaleaf activation is managed only by HHH administrators.', 'FORBIDDEN');
      }
      const input = z.object({
        completed: z.boolean(),
        evidence: z.string().trim().max(1000).nullable().optional(),
      }).parse(req.body);
      await organisationRepo.upsertSetupTask({
        organisationId: scope.organisationId,
        taskCode: taskId,
        completed: input.completed,
        evidence: input.evidence,
        completedByUid: scope.uid,
      });
      const records = await organisationRepo.listSetupTasks(scope.organisationId);
      res.status(200).json(setupStatus(scope.organisationId, records, false));
    } catch (error) {
      next(error);
    }
  });

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
  router.get('/portal/preferences', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = authenticatedStaff(req.context);
      const staff = await identityRepo.findStaffUser(scope.uid);
      res.status(200).json(staff?.preferences ?? defaultPreferences);
    } catch (error) {
      next(error);
    }
  });

  // PATCH /v1/portal/preferences - Update the current staff member's UI preferences
  const updatePreferences = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = authenticatedStaff(req.context);
      const preferences = preferencesInputSchema.parse(req.body);

      await organisationRepo.updateStaffPreferences(scope.uid, preferences);
      res.status(200).json(preferences);
    } catch (error) {
      next(error);
    }
  };
  router.patch('/portal/preferences', requireCsrf, requireStaff('any'), updatePreferences);
  router.post('/portal/preferences', requireCsrf, requireStaff('any'), updatePreferences);

  // GET /v1/portal/admin/organisations - Platform-scoped pharmacy directory
  router.get('/portal/admin/organisations', requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertPlatformScope(req.context!);
      const organisations = await organisationRepo.listOrganisations();
      res.status(200).json(organisations.map(toPortalOrganisation));
    } catch (error) {
      next(error);
    }
  });

  // Only the authenticated tenant or an HHH platform administrator selecting a
  // tenant may retrieve a pharmacy's public referral link. It is never included
  // in the broad organisation directory response.
  router.get('/portal/referral-link', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = authenticatedStaff(req.context);
      const requestedOrganisationId = typeof req.query.organisationId === 'string'
        ? organisationIdSchema.parse(req.query.organisationId)
        : null;
      let organisationId: string;
      if (context.kind === 'tenant') {
        if (requestedOrganisationId && requestedOrganisationId.replaceAll('-', '').toLowerCase() !== context.organisationId.replaceAll('-', '').toLowerCase()) {
          throw new HttpError(403, 'A pharmacy may only access its own eligibility link.', 'TENANT_SCOPE_VIOLATION');
        }
        organisationId = context.organisationId;
      } else {
        assertPlatformScope(context);
        if (!requestedOrganisationId) {
          throw new HttpError(400, 'Select a pharmacy before requesting its eligibility link.', 'ORGANISATION_REQUIRED');
        }
        organisationId = requestedOrganisationId;
      }

      const url = await referralLinks.getEligibilityLink(organisationId);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      await identityRepo.appendAudit({
        organisationId,
        actorUid: context.uid,
        actorRole: context.role,
        event: 'referral_link.accessed',
        recordType: 'Organisation',
        recordId: organisationId,
        requestId: context.requestId,
        sessionHashPrefix: context.sessionHash.slice(0, 12),
        surface: context.surface,
      });
      res.status(200).json({ url });
    } catch (error) {
      next(error);
    }
  });

  router.post('/portal/admin/organisations', requireCsrf, requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertPlatformScope(req.context!);
      const input = createOrganisationInputSchema.parse(req.body);
      const websiteDomains = [...new Set(input.websiteDomains.map(normaliseHostname))];
      const id = randomUUID();
      const now = new Date().toISOString();

      await organisationRepo.createOrganisation({
        id,
        name: input.name,
        tradingName: input.tradingName,
        gphcNumber: input.gphcNumber,
        superintendentName: input.superintendent,
        mainContactName: input.mainContactName || null,
        mainContactPhone: input.mainContactPhone || null,
        mainContactEmail: input.mainContactEmail || null,
        address: input.address,
        primaryColour: input.primaryColour.toLowerCase(),
        logoText: input.logoText.toUpperCase(),
        portalName: input.name,
      });

      const referralLink = await referralLinks.ensureEligibilityLink({
        organisationId: id,
        createdByUid: scope.uid,
      });
      const rejectedDomains: string[] = [];
      for (const hostname of websiteDomains) {
        try {
          await organisationRepo.createOrganisationDomain(id, hostname);
        } catch {
          rejectedDomains.push(hostname);
        }
      }

      await identityRepo.appendAudit({
        organisationId: id,
        actorUid: scope.uid,
        actorRole: scope.role,
        event: 'organisation.created',
        recordType: 'Organisation',
        recordId: id,
        requestId: scope.requestId,
        sessionHashPrefix: scope.sessionHash.slice(0, 12),
        surface: scope.surface,
        details: { acceptedDomainCount: websiteDomains.length - rejectedDomains.length, rejectedDomains },
      });

      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.status(201).json({
        ...input,
        websiteDomains: websiteDomains.filter(hostname => !rejectedDomains.includes(hostname)),
        id,
        referralToken: referralLink.token,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
