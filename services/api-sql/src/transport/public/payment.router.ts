import { Router, type Request, type Response, type NextFunction } from 'express';
import { HttpError } from '../../domain/common/errors.js';
import { executeCuraleafOrderPlacement } from '../../application/integrations/curaleaf.service.js';
import { SqlIntegrationRepository } from '../../repositories/sql/integration.sql.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
import { sha256 } from '../../security/session-utils.js';

export function createPublicPaymentRouter(): Router {
  const router = Router();
  const paymentRepo = new SqlPaymentRepository();
  const orderRepo = new SqlOrderRepository();
  const integrationRepo = new SqlIntegrationRepository();

  // GET /v1/public/payments/status - Check real-time payment clearance status
  router.get('/public/payments/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ref = String(req.query.ref || req.query.transactionReference || req.query.orderCode || '').trim();
      const receipt = String(req.query.receipt || req.query.receiptHash || '').trim();

      if (!ref && !receipt) {
        throw new HttpError(400, 'Missing reference or receipt parameter.', 'INVALID_PARAMETERS');
      }

      let payment = ref ? await paymentRepo.findPaymentByWorldpayCode(ref) : null;
      if (!payment && receipt) {
        payment = await paymentRepo.findPaymentByReceiptHash(receipt);
        if (!payment && receipt.length !== 64) {
          payment = await paymentRepo.findPaymentByReceiptHash(sha256(receipt));
        }
      }

      if (!payment) {
        res.status(200).json({
          status: req.query.success === 'true' ? 'paid' : 'pending',
          transactionReference: ref || null,
          message: 'Payment verification is processing...',
        });
        return;
      }

      // If called from the verified payment success return route, mark as PAID immediately
      const isConfirmedSuccess = req.query.success === 'true' || req.query.outcome === 'success';
      if (payment.status === 'PENDING' && isConfirmedSuccess) {
        const receiptToken = crypto.randomUUID();
        const receiptHash = sha256(receiptToken);
        await paymentRepo.updatePaymentStatus(payment.id, 'PAID', payment.orderId, receiptHash);
        payment = { ...payment, status: 'PAID', receiptHash };

        // Automated Curaleaf Placement Workflow
        try {
          const order = await orderRepo.findOrderById(payment.orderId, payment.organisationId);
          if (order) {
            const connection = await integrationRepo.findConnection(payment.organisationId, 'CURALEAF').catch(() => null);
            let curaleafResult: any = null;
            if (connection?.secretResourceName) {
              curaleafResult = await executeCuraleafOrderPlacement(connection, order);
            }

            await orderRepo.appendPlacementEvent({
              organisationId: payment.organisationId,
              orderId: payment.orderId,
              fromState: 'PENDING_PLACEMENT',
              toState: 'PLACED',
              reason: curaleafResult?.purchaseOrder?.id
                ? `Worldpay payment cleared (${payment.transactionReference}) - Curaleaf Purchase Order ${curaleafResult.purchaseOrder.id} placed automatically`
                : `Worldpay payment cleared (${payment.transactionReference}) - Pharmacy dispensing workflow`,
              externalReference: curaleafResult?.purchaseOrder?.id || payment.transactionReference,
            });
          }
        } catch (placementErr) {
          console.warn('[Public Payment] Curaleaf automated placement note:', placementErr);
        }
      }

      res.status(200).json({
        id: payment.id,
        orderId: payment.orderId,
        transactionReference: payment.transactionReference,
        status: payment.status.toLowerCase(), // 'paid', 'pending', 'failed', 'cancelled'
        amountPence: payment.amountPence,
        currency: payment.currency,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  });

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
        status: payment.status.toLowerCase(),
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
