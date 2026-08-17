import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { fetchCuraleafCatalogue } from '../../application/integrations/curaleaf.service.js';
import type { IntegrationName } from '../../repositories/ports/integration.port.js';
import { SqlIntegrationRepository } from '../../repositories/sql/integration.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { requireStaff } from '../../security/require-staff.js';
import type { RequestContext } from '../../security/request-context.js';

const organisationIdSchema = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);

function compact(value: string) {
  return value.toLowerCase().replaceAll('-', '');
}

export async function authorisedOrganisationId(
  context: RequestContext | undefined,
  requested: unknown,
  organisationRepo: SqlOrganisationRepository,
) {
  if (!context || context.kind === 'public') throw new HttpError(401, 'A valid staff session is required.', 'UNAUTHENTICATED');
  if (context.kind === 'tenant') {
    if (requested && compact(String(requested)) !== compact(context.organisationId)) {
      throw new HttpError(403, 'Cross-pharmacy access is not permitted.', 'TENANT_SCOPE_VIOLATION');
    }
    return context.organisationId;
  }
  const organisationId = organisationIdSchema.parse(requested);
  if (!await organisationRepo.findOrganisationById(organisationId)) {
    throw new HttpError(404, 'Pharmacy record not found.', 'NOT_FOUND');
  }
  return organisationId;
}

export function createPortalIntegrationRouter(): Router {
  const router = Router();
  const integrationRepo = new SqlIntegrationRepository();
  const organisationRepo = new SqlOrganisationRepository();

  const status = (integration: IntegrationName) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.query.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, integration);
      res.setHeader('Cache-Control', 'no-store');
      if (integration === 'CURALEAF') {
        const configured = Boolean(connection?.secretResourceName);
        const connected = connection?.status === 'ACTIVE';
        res.status(200).json({
          configured,
          connected,
          writeConfigured: configured,
          approved: connected,
          status: !configured ? 'not_configured' : connected ? 'connected' : connection?.status === 'PENDING_VALIDATION' ? 'validated' : 'attention',
          environment: connection?.environment === 'PRODUCTION' ? 'production' : 'test',
          checkedAt: new Date().toISOString(),
          message: !configured
            ? 'Curaleaf is not connected for this pharmacy.'
            : connected
              ? 'The existing Curaleaf credential is securely linked.'
              : 'The existing Curaleaf credential is securely linked and awaiting re-validation.',
          activated: connected,
          maskedIdentifier: connection?.maskedCredential ?? undefined,
          // This identifier is operational metadata, not a credential. It is
          // returned only after the tenant/admin scope check above.
          customerId: connection?.externalCustomerId ?? undefined,
        });
        return;
      }
      const configured = Boolean(connection?.secretResourceName);
      const connected = connection?.status === 'ACTIVE';
      res.status(200).json({
        configured,
        connected,
        status: !configured ? 'verification_required' : connected ? 'connected' : 'attention',
        maskedIdentifier: connection?.maskedCredential ?? undefined,
        updatedAt: connection?.updatedAt,
        validation: connected && connection?.externalCustomerId ? {
          passed: true,
          checkedAt: connection.updatedAt,
          environment: connection.environment === 'PRODUCTION' ? 'live' : 'try',
          // Preserve the legacy response shape without returning the merchant
          // entity identifier after it has been securely stored.
          entityId: connection.maskedCredential ?? '',
        } : null,
      });
    } catch (error) { next(error); }
  };

  router.get('/portal/integrations/curaleaf/status', requireStaff('any'), status('CURALEAF'));
  router.get('/portal/integrations/worldpay/status', requireStaff('any'), status('WORLDPAY'));
  router.get('/portal/integrations/curaleaf/catalog', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.query.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }
      const catalogue = await fetchCuraleafCatalogue(connection);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).json(catalogue);
    } catch (error) { next(error); }
  });
  return router;
}
