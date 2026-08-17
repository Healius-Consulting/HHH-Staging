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

  // POST /v1/portal/orders/:id/prescriptions/:prescriptionId/place - Place prescription manually
  router.post('/portal/orders/:id/prescriptions/:prescriptionId/place', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const prescriptionId = String(req.params.prescriptionId || '');

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'PROCESSING',
        fulfilmentStatus: 'SUPPLIER_PROCESSING',
      });

      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        orderLineId: prescriptionId,
        fromState: 'SUPPLIER_PENDING',
        toState: 'SUPPLIER_PROCESSING',
        reason: 'Prescription placed manually with Curaleaf / pharmacy dispensing',
        actorUid: scope.uid,
      });

      res.status(200).json({ success: true, status: 'placed_manually' });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/curaleaf-cancellation - Record Curaleaf order cancellation
  router.post('/portal/orders/:id/curaleaf-cancellation', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        reason: z.string().min(1).max(255),
        note: z.string().max(1000).optional(),
      }).parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      const now = new Date().toISOString();
      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'CANCELLED',
        cancelledAt: now,
      });

      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        fromState: order.status,
        toState: 'CANCELLED',
        reason: `Cancelled: ${input.reason}${input.note ? ` (${input.note})` : ''}`,
        actorUid: scope.uid,
      });

      res.status(200).json({ id: orderId, status: 'CANCELLED', cancelledAt: now });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/curaleaf-rejections - Record Curaleaf rejection and support case
  router.post('/portal/orders/:id/curaleaf-rejections', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        prescriptionId: z.string(),
        reason: z.string(),
        rejectedAt: z.string().optional(),
        supportCaseId: z.string().optional(),
      }).parse(req.body);

      const supportCaseId = input.supportCaseId || `case-${Date.now().toString(36)}`;
      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        orderLineId: input.prescriptionId,
        fromState: 'SUPPLIER_PROCESSING',
        toState: 'EXCEPTION',
        reason: `Curaleaf rejected: ${input.reason} [Support case: ${supportCaseId}]`,
        actorUid: scope.uid,
      });

      res.status(200).json({ id: crypto.randomUUID(), supportCaseId });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/curaleaf/support-cases
  router.get('/portal/curaleaf/support-cases', requireStaff('pharmacy'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json([]);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/curaleaf/support-cases
  router.post('/portal/curaleaf/support-cases', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = req.body;
      res.status(201).json({
        id: `case-${Date.now().toString(36)}`,
        status: 'open',
        ...input,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
