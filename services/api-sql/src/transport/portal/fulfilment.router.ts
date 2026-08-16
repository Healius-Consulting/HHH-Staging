import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { SqlFulfilmentRepository } from '../../repositories/sql/fulfilment.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const goodsReceiptSchema = z.object({
  orderId: z.string().uuid(),
  receiptNumber: z.string().min(1).max(100),
  status: z.enum(['COMPLETE', 'DAMAGED', 'DISCREPANCY']).default('COMPLETE'),
  notes: z.string().max(1000).optional(),
});

export function createPortalFulfilmentRouter(): Router {
  const router = Router();
  const fulfilmentRepo = new SqlFulfilmentRepository();

  // GET /v1/portal/shipments - List tenant shipments
  router.get('/portal/shipments', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const shipments = await fulfilmentRepo.listShipments(scope.organisationId);
      res.status(200).json(shipments);
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/goods-receipts - List tenant goods receipts
  router.get('/portal/goods-receipts', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const receipts = await fulfilmentRepo.listGoodsReceipts(scope.organisationId);
      res.status(200).json(receipts);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/goods-receipts - Create goods receipt
  router.post('/portal/goods-receipts', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = goodsReceiptSchema.parse(req.body);

      const result = await fulfilmentRepo.createGoodsReceipt({
        organisationId: scope.organisationId,
        orderId: input.orderId,
        receiptNumber: input.receiptNumber,
        receivedByUid: scope.uid,
        receivedDate: new Date().toISOString(),
        status: input.status,
        notes: input.notes,
      });

      res.status(201).json({ id: result.id, status: 'goods_receipt_created' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
