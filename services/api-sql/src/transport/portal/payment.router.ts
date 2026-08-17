import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { sha256 } from '../../security/session-utils.js';

const manualPaymentSchema = z.object({
  organisationId: z.string().optional(),
  amountPence: z.number().int().positive(),
  tender: z.enum(['cash', 'epos', 'bank_transfer', 'other']).default('cash'),
  reference: z.string().min(1).max(255),
  notes: z.string().max(1000).optional(),
});

const worldpaySessionSchema = z.object({
  organisationId: z.string().optional(),
});

const createPaymentSchema = z.object({
  amountPence: z.number().int().positive(),
  currency: z.string().default('GBP'),
  route: z.enum(['MANUAL', 'WORLDPAY']).default('MANUAL'),
});

const refundSchema = z.object({
  amountPence: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(8).max(128),
});

export function createPortalPaymentRouter(): Router {
  const router = Router();
  const paymentRepo = new SqlPaymentRepository();
  const orderRepo = new SqlOrderRepository();

  // POST /v1/portal/orders/:id/payments/manual - Record manual pharmacy payment
  router.post('/portal/orders/:id/payments/manual', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = manualPaymentSchema.parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      const receiptHash = sha256(`${orderId}:${input.reference}:${Date.now()}`);
      const paymentResult = await paymentRepo.createPayment({
        organisationId: scope.organisationId,
        orderId,
        patientId: order.patientId,
        status: 'PAID',
        amountPence: input.amountPence,
        currency: 'GBP',
        route: 'MANUAL',
        receiptHash,
      });

      const now = new Date().toISOString();
      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'PROCESSING',
        paymentStatus: 'PAID',
        paidAt: now,
      });

      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        fromState: 'SUBMITTED',
        toState: 'PROCESSING',
        reason: `Manual payment recorded (${input.tender}: ${input.reference})`,
        externalReference: input.reference,
        actorUid: scope.uid,
      });

      res.status(200).json({
        id: paymentResult.id,
        status: 'PAID',
        amountPence: input.amountPence,
        paidAt: now,
        tender: input.tender,
        reference: input.reference,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/payments/worldpay-session - Create Worldpay checkout session
  router.post('/portal/orders/:id/payments/worldpay-session', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      worldpaySessionSchema.parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      const worldpayOrderCode = `WP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const paymentResult = await paymentRepo.createPayment({
        organisationId: scope.organisationId,
        orderId,
        patientId: order.patientId,
        status: 'PENDING',
        amountPence: order.totalPence,
        currency: order.currency || 'GBP',
        route: 'WORLDPAY',
        worldpayOrderCode,
      });

      const checkoutUrl = `https://secure-test.worldpay.com/hosted/checkout?order=${encodeURIComponent(order.orderNumber || orderId)}&amount=${order.totalPence}`;
      res.status(200).json({
        paymentId: paymentResult.id,
        transactionReference: worldpayOrderCode,
        provider: {
          url: checkoutUrl,
          _links: {
            redirect: {
              href: checkoutUrl,
            },
          },
        },
        linkExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        reused: false,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/payment-links/resend - Resend/refresh payment link
  router.post('/portal/orders/:id/payment-links/resend', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      const worldpayOrderCode = `WP-${Date.now().toString(36).toUpperCase()}`;
      const checkoutUrl = `https://secure-test.worldpay.com/hosted/checkout?order=${encodeURIComponent(order.orderNumber || orderId)}&amount=${order.totalPence}`;
      res.status(200).json({
        paymentId: crypto.randomUUID(),
        transactionReference: worldpayOrderCode,
        provider: {
          url: checkoutUrl,
          _links: {
            redirect: {
              href: checkoutUrl,
            },
          },
        },
        linkExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/payments - Record payment or generate payment link
  router.post('/portal/orders/:id/payments', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = createPaymentSchema.parse(req.body);

      const worldpayOrderCode = input.route === 'WORLDPAY' ? `WP-${Date.now().toString(36).toUpperCase()}` : null;
      const receiptToken = input.route === 'MANUAL' ? crypto.randomUUID() : null;
      const receiptHash = receiptToken ? sha256(receiptToken) : null;
      const initialStatus = input.route === 'MANUAL' ? 'PAID' : 'PENDING';

      const paymentResult = await paymentRepo.createPayment({
        organisationId: scope.organisationId,
        orderId,
        status: initialStatus,
        amountPence: input.amountPence,
        currency: input.currency,
        route: input.route,
        worldpayOrderCode,
        receiptHash,
      });

      res.status(201).json({
        id: paymentResult.id,
        status: initialStatus,
        worldpayOrderCode,
        receiptToken,
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/payments - List tenant payments
  router.get('/portal/payments', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const payments = await paymentRepo.listTenantPayments(scope.organisationId);
      res.status(200).json(payments);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/payments/:id/refunds - Issue idempotent refund
  router.post('/portal/payments/:id/refunds', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const paymentId = String(req.params.id || '');
      const input = refundSchema.parse(req.body);
      const idempotencyKeyHash = sha256(input.idempotencyKey);

      const refundResult = await paymentRepo.createRefund({
        organisationId: scope.organisationId,
        paymentId,
        amountPence: input.amountPence,
        currency: 'GBP',
        status: 'SUCCEEDED',
        reason: input.reason,
        idempotencyKeyHash,
        issuedByUid: scope.uid,
      });

      res.status(201).json({ id: refundResult.id, status: 'refund_issued' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
