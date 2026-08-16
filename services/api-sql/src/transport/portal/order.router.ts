import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const draftInputSchema = z.object({
  patientId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
});

const createOrderInputSchema = z.object({
  patientId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  orderNumber: z.string().optional(),
  medicineTotalPence: z.number().int().nonnegative(),
  dispensingFeePence: z.number().int().nonnegative(),
  deliveryPence: z.number().int().nonnegative(),
  taxPence: z.number().int().nonnegative(),
  totalPence: z.number().int().positive(),
  paymentRoute: z.enum(['MANUAL', 'WORLDPAY']).default('MANUAL'),
  currency: z.string().default('GBP'),
  quoteSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export function createPortalOrderRouter(): Router {
  const router = Router();
  const orderRepo = new SqlOrderRepository();

  // POST /v1/portal/order-drafts - Create or save order draft
  router.post('/portal/order-drafts', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = draftInputSchema.parse(req.body);

      const result = await orderRepo.createDraft({
        organisationId: scope.organisationId,
        patientId: input.patientId,
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

      res.status(200).json(draft);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders - Promote draft to order
  router.post('/portal/orders', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = createOrderInputSchema.parse(req.body);

      // Verify integer pence math integrity: medicine + dispensing + delivery + tax == total
      const expectedTotal = input.medicineTotalPence + input.dispensingFeePence + input.deliveryPence + input.taxPence;
      if (input.totalPence !== expectedTotal) {
        throw new HttpError(400, `Total pence mismatch. Expected ${expectedTotal}, received ${input.totalPence}`, 'CALCULATION_MISMATCH');
      }

      const result = await orderRepo.createOrder({
        organisationId: scope.organisationId,
        patientId: input.patientId,
        draftId: input.draftId,
        orderNumber: input.orderNumber || `ORD-${Date.now().toString(36).toUpperCase()}`,
        status: 'SUBMITTED',
        paymentStatus: 'PENDING',
        fulfilmentStatus: 'SUPPLIER_PENDING',
        paymentRoute: input.paymentRoute,
        currency: input.currency,
        medicineTotalPence: input.medicineTotalPence,
        dispensingFeePence: input.dispensingFeePence,
        deliveryPence: input.deliveryPence,
        taxPence: input.taxPence,
        totalPence: input.totalPence,
        quoteSnapshot: input.quoteSnapshot,
        createdByUid: scope.uid,
      });

      res.status(201).json({ id: result.id, status: 'order_submitted' });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/orders - List tenant orders
  router.get('/portal/orders', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orders = await orderRepo.listTenantOrders(scope.organisationId);
      res.status(200).json(orders);
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

      res.status(200).json(order);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
