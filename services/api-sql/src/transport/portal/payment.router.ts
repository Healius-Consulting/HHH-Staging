import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { sha256 } from '../../security/session-utils.js';

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
