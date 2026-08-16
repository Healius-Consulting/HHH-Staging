import { Router, type Request, type Response, type NextFunction } from 'express';
import { HttpError } from '../../domain/common/errors.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
import { sha256 } from '../../security/session-utils.js';

export function createPublicPaymentRouter(): Router {
  const router = Router();
  const paymentRepo = new SqlPaymentRepository();

  // GET /v1/public/receipts/:receiptHash - Look up public receipt token
  router.get('/public/receipts/:receiptHash', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const receiptHash = req.params.receiptHash;
      if (!receiptHash || typeof receiptHash !== 'string' || receiptHash.length !== 64) {
        throw new HttpError(404, 'Receipt not found.', 'NOT_FOUND');
      }

      const payment = await paymentRepo.findPaymentByReceiptHash(receiptHash);
      if (!payment) {
        throw new HttpError(404, 'Receipt not found.', 'NOT_FOUND');
      }

      res.status(200).json({
        id: payment.id,
        amountPence: payment.amountPence,
        currency: payment.currency,
        status: payment.status,
        createdAt: payment.createdAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/public/payments/worldpay/webhook - Worldpay async payment notification
  router.post('/public/payments/worldpay/webhook', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderCode, paymentStatus } = req.body;
      if (!orderCode || typeof orderCode !== 'string') {
        throw new HttpError(400, 'Invalid Worldpay payload.', 'INVALID_PAYLOAD');
      }

      const payment = await paymentRepo.findPaymentByWorldpayCode(orderCode);
      if (!payment) {
        // Return 200 to Worldpay even if unmatched to avoid webhook retry loops, but log warning
        console.warn(`[Worldpay Webhook] Received webhook for unknown orderCode: ${orderCode}`);
        res.status(200).send('<xml status="OK"/>');
        return;
      }

      if (paymentStatus === 'AUTHORISED' || paymentStatus === 'CAPTURED') {
        const receiptToken = crypto.randomUUID();
        const receiptHash = sha256(receiptToken);
        await paymentRepo.updatePaymentStatus(payment.id, 'PAID', payment.orderId, receiptHash);
      } else if (paymentStatus === 'REFUSED' || paymentStatus === 'CANCELLED') {
        await paymentRepo.updatePaymentStatus(payment.id, 'FAILED', payment.orderId);
      }

      res.status(200).send('<xml status="OK"/>');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
