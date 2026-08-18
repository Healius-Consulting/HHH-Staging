import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { fetchCuraleafCatalogue, fetchCuraleafQuote, fetchCuraleafActivity, curaleafApiRequest } from '../../application/integrations/curaleaf.service.js';
import {
  mergeQuoteBankIntoCatalogue,
  upsertCuraleafQuoteBankFromQuote,
} from '../../application/integrations/curaleaf-quote-bank.service.js';
import type { IntegrationName } from '../../repositories/ports/integration.port.js';
import { SqlCuraleafQuoteBankRepository } from '../../repositories/sql/curaleaf-quote-bank.sql.js';
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
  const quoteBankRepo = new SqlCuraleafQuoteBankRepository();
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

  const getCatalogue = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.query.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }
      const catalogue = await fetchCuraleafCatalogue(connection);
      const quoteBank = await quoteBankRepo.listEntries(organisationId);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).json(mergeQuoteBankIntoCatalogue(
        catalogue as { products: Array<Record<string, unknown>>; fetchedAt: string; [key: string]: unknown },
        quoteBank,
      ));
    } catch (error) { next(error); }
  };

  router.get('/portal/integrations/curaleaf/catalog', requireStaff('any'), getCatalogue);
  router.get('/portal/integrations/curaleaf/catalogue', requireStaff('any'), getCatalogue);
  router.get('/portal/integrations/curaleaf/training/catalog', requireStaff('any'), getCatalogue);

  const getQuote = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = z.object({
        organisationId: z.string().optional(),
        items: z.array(z.object({
          packId: z.string(),
          quantity: z.number().int().positive().max(100),
        })).min(1),
      }).parse(req.body);

      const organisationId = await authorisedOrganisationId(req.context, input.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }

      const quote = await fetchCuraleafQuote(connection, input.items);
      try {
        await upsertCuraleafQuoteBankFromQuote(connection, quote, 'LIVE_QUOTE', quoteBankRepo);
      } catch (error) {
        console.warn('[Curaleaf] Quote bank upsert failed after live quote:', error);
      }
      res.status(200).json(quote);
    } catch (error) { next(error); }
  };

  router.post('/portal/integrations/curaleaf/quote', requireStaff('any'), getQuote);
  router.post('/portal/integrations/curaleaf/training/quote', requireStaff('any'), getQuote);

  router.get('/portal/integrations/curaleaf/activity', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.query.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }
      const activity = await fetchCuraleafActivity(connection);
      res.status(200).json(activity);
    } catch (error) { next(error); }
  });

  router.post('/portal/integrations/curaleaf/prescriptions/manual', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.body?.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }

      const result = await curaleafApiRequest(connection, '/v1/prescriptions/', {
        method: 'POST',
        body: JSON.stringify(req.body),
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  router.post('/portal/integrations/curaleaf/prescriptions/barcode', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.body?.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }

      const result = await curaleafApiRequest(connection, '/v1/clinic-prescriptions/', {
        method: 'POST',
        body: JSON.stringify(req.body),
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  router.post('/portal/integrations/curaleaf/prescriptions/scan', requireStaff('any'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organisationId = await authorisedOrganisationId(req.context, req.body?.organisationId, organisationRepo);
      const connection = await integrationRepo.findConnection(organisationId, 'CURALEAF');
      if (!connection?.secretResourceName) {
        throw new HttpError(503, 'Curaleaf is not connected for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
      }

      const result = await curaleafApiRequest(connection, '/v1/prescription-from-image/', {
        method: 'POST',
        body: JSON.stringify(req.body),
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  });

  return router;
}
