import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { toPortalOrder, toPortalOrderDraft } from './pharmacy-contracts.js';

const uuidLikeSchema = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);

const draftInputSchema = z.object({
  organisationId: z.string().optional(),
  patientId: z.union([uuidLikeSchema, z.literal(''), z.null()]).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const createOrderInputSchema = z.object({
  organisationId: z.string().optional(),
  patientId: uuidLikeSchema,
  draftId: z.union([uuidLikeSchema, z.literal(''), z.null()]).optional(),
  orderNumber: z.string().optional(),
  lineItems: z.array(z.object({
    packId: z.string(),
    quantity: z.number().int().positive(),
  })).default([]),
  prescriptions: z.array(z.object({
    id: z.string().optional(),
    fileId: z.string().optional(),
    clinicScanId: z.string().optional(),
    curaleafPrescriptionId: z.string().optional(),
    serialNumber: z.string().optional(),
    issueDate: z.string().optional(),
    expiryDate: z.string().optional(),
    patient: z.object({
      name: z.string(),
      dob: z.string(),
    }).optional(),
    prescriber: z.object({
      id: z.string().optional(),
      pin: z.string().optional(),
      gmcNumber: z.number().nullable().optional(),
      gphcNumber: z.string().nullable().optional(),
      name: z.string().optional(),
      initials: z.string().optional(),
    }).optional(),
    items: z.array(z.object({
      formulaId: z.string().optional(),
      unitsNeededCount: z.number().optional(),
      packId: z.string().optional(),
      quantity: z.number().int().positive().optional(),
    })).default([]),
  })).default([]),
  dispensingFeePence: z.number().int().nonnegative().default(0),
  medicineTotalPence: z.number().int().nonnegative().optional(),
  deliveryPence: z.number().int().nonnegative().optional(),
  taxPence: z.number().int().nonnegative().optional(),
  totalPence: z.number().int().positive().optional(),
  paymentRoute: z.enum(['manual', 'worldpay', 'MANUAL', 'WORLDPAY']).default('manual'),
  currency: z.string().default('GBP'),
  quoteSnapshot: z.record(z.string(), z.unknown()).optional(),
  redoContext: z.record(z.string(), z.unknown()).nullable().optional(),
});

export function createPortalOrderRouter(): Router {
  const router = Router();
  const orderRepo = new SqlOrderRepository();

  // GET /v1/portal/order-drafts - List active tenant drafts
  router.get('/portal/order-drafts', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const drafts = await orderRepo.listTenantDrafts(scope.organisationId);
      res.status(200).json(drafts.map(toPortalOrderDraft));
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/order-drafts - Create or save order draft
  router.post('/portal/order-drafts', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = draftInputSchema.parse(req.body);

      const result = await orderRepo.createDraft({
        organisationId: scope.organisationId,
        patientId: input.patientId || null,
        payload: input.payload,
        createdByUid: scope.uid,
      });

      res.status(201).json({ id: result.id, status: 'draft_created' });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/order-drafts/:id - Get order draft
  router.get('/portal/order-drafts/:id', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const draftId = String(req.params.id || '');
      const draft = await orderRepo.findDraftById(draftId, scope.organisationId);

      if (!draft) {
        throw new HttpError(404, 'Order draft not found.', 'NOT_FOUND');
      }

      res.status(200).json(toPortalOrderDraft(draft));
    } catch (error) {
      next(error);
    }
  });

  // PATCH /v1/portal/order-drafts/:id - Update existing order draft
  router.patch('/portal/order-drafts/:id', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const draftId = String(req.params.id || '');
      const input = draftInputSchema.parse(req.body);

      const updated = await orderRepo.updateDraft({
        id: draftId,
        organisationId: scope.organisationId,
        patientId: input.patientId || null,
        payload: input.payload,
      });

      if (!updated) {
        throw new HttpError(404, 'Order draft not found.', 'NOT_FOUND');
      }

      res.status(200).json({ id: draftId, status: 'draft_updated' });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /v1/portal/order-drafts/:id - Delete order draft
  router.delete('/portal/order-drafts/:id', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const draftId = String(req.params.id || '');
      const deleted = await orderRepo.deleteDraft(draftId, scope.organisationId);

      if (!deleted) {
        throw new HttpError(404, 'Order draft not found.', 'NOT_FOUND');
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders - Promote draft or submit order
  router.post('/portal/orders', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = createOrderInputSchema.parse(req.body);

      const medicineTotalPence = input.medicineTotalPence ?? 0;
      const dispensingFeePence = input.dispensingFeePence ?? 0;
      const deliveryPence = input.deliveryPence ?? 0;
      const taxPence = input.taxPence ?? 0;
      const totalPence = input.totalPence ?? (medicineTotalPence + dispensingFeePence + deliveryPence + taxPence);
      const paymentRoute = input.paymentRoute.toUpperCase() === 'WORLDPAY' ? 'WORLDPAY' as const : 'MANUAL' as const;
      const orderNumber = input.orderNumber || `ORD-${Date.now().toString(36).toUpperCase()}`;

      const result = await orderRepo.createOrder({
        organisationId: scope.organisationId,
        patientId: input.patientId,
        draftId: input.draftId || null,
        orderNumber,
        status: 'SUBMITTED',
        paymentStatus: 'PENDING',
        fulfilmentStatus: 'SUPPLIER_PENDING',
        paymentRoute,
        currency: input.currency,
        medicineTotalPence,
        dispensingFeePence,
        deliveryPence,
        taxPence,
        totalPence: totalPence > 0 ? totalPence : 1,
        quoteSnapshot: input.quoteSnapshot ?? { prescriptions: input.prescriptions, lineItems: input.lineItems },
        createdByUid: scope.uid,
      });

      if (input.draftId) {
        await orderRepo.deleteDraft(input.draftId, scope.organisationId).catch(() => undefined);
      }

      res.status(201).json({ id: result.id, orderNumber, status: 'order_submitted' });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/orders - List tenant orders
  router.get('/portal/orders', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orders = await orderRepo.listTenantOrders(scope.organisationId);
      res.status(200).json(orders.map(toPortalOrder));
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/orders/:id - Get tenant order details
  router.get('/portal/orders/:id', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);

      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      res.status(200).json(toPortalOrder(order));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
