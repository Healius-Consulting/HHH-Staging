import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  advanceFulfilmentStatus,
  normalisedFulfilmentLines,
  supplierFulfilmentStatus,
} from '../../application/orders/curaleaf-fulfilment.js';
import { SqlFulfilmentRepository } from '../../repositories/sql/fulfilment.sql.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const goodsReceiptSchema = z.object({
  orderId: z.string().uuid().optional(),
  receiptNumber: z.string().min(1).max(100).optional(),
  status: z.enum(['COMPLETE', 'DAMAGED', 'DISCREPANCY', 'PARTIAL']).optional(),
  notes: z.string().max(4000).optional(),
  items: z.array(z.object({
    productId: z.string(),
    expectedQuantity: z.number().int().nonnegative().optional(),
    receivedQuantity: z.number().int().nonnegative(),
  })).optional(),
  lines: z.array(z.object({
    productId: z.string(),
    expectedQuantity: z.number().int().nonnegative().optional(),
    receivedQuantity: z.number().int().nonnegative(),
  })).optional(),
});

function snapshotObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value as Record<string, any> } : {};
}

export function createPortalFulfilmentRouter(): Router {
  const router = Router();
  const fulfilmentRepo = new SqlFulfilmentRepository();
  const orderRepo = new SqlOrderRepository();

  router.get('/portal/shipments', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const shipments = await fulfilmentRepo.listShipments(scope.organisationId);
      res.status(200).json(shipments);
    } catch (error) {
      next(error);
    }
  });

  router.get('/portal/goods-receipts', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const receipts = await fulfilmentRepo.listGoodsReceipts(scope.organisationId);
      res.status(200).json(receipts);
    } catch (error) {
      next(error);
    }
  });

  router.post('/portal/shipments/:shipmentId/goods-receipts', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const supplierShipmentId = String(req.params.shipmentId || '');
      const input = goodsReceiptSchema.parse(req.body || {});
      const targetOrderId = input.orderId && input.orderId !== scope.organisationId ? input.orderId : undefined;
      const itemsPayload = input.items || input.lines || [];

      let sqlShipment = await fulfilmentRepo.findShipmentBySupplierId(scope.organisationId, supplierShipmentId).catch(() => null);
      if (!sqlShipment && targetOrderId) {
        const order = await orderRepo.findOrderById(targetOrderId, scope.organisationId);
        const snapshot = snapshotObject(order?.quoteSnapshot);
        const poId = snapshot.curaleaf?.purchaseOrderId || snapshot.curaleaf?.id;
        if (order && poId) {
          sqlShipment = await fulfilmentRepo.upsertSupplierShipment({
            organisationId: scope.organisationId,
            orderId: order.id,
            supplierPurchaseOrderId: String(poId),
            supplierShipmentId,
            supplierCustomerReference: snapshot.curaleaf?.customerReference || order.orderNumber,
          }).then(async result => (
            result.id
              ? { id: result.id, orderId: order.id, supplierPurchaseOrderId: String(poId), supplierShipmentId, supplierCustomerReference: order.orderNumber, status: 'DISPATCHED', dispatchedAt: null, createdAt: new Date().toISOString() }
              : null
          )).catch(() => null);
        }
      }

      const notesContent = input.notes
        ? String(input.notes)
        : itemsPayload.length > 0
          ? `Shipment ${supplierShipmentId} items check-in: ${JSON.stringify(itemsPayload)}`
          : `Shipment ${supplierShipmentId} goods receipt verified`;

      let recordId = `gr-${Date.now()}`;
      if (sqlShipment?.id) {
        const result = await fulfilmentRepo.createGoodsReceipt({
          organisationId: scope.organisationId,
          shipmentId: sqlShipment.id,
          receivedByUid: scope.uid,
          status: itemsPayload.some(item => (item.expectedQuantity ?? item.receivedQuantity) > item.receivedQuantity) ? 'PARTIAL' : 'COMPLETE',
          notes: notesContent,
        }).catch(err => {
          console.warn('Fulfilment SQL persistence fallback:', err);
          return null;
        });
        if (result?.id) recordId = result.id;
      }

      if (targetOrderId) {
        const order = await orderRepo.findOrderById(targetOrderId, scope.organisationId);
        if (order) {
          const snapshot = snapshotObject(order.quoteSnapshot);
          const curaleaf = snapshotObject(snapshot.curaleaf);
          const requestedItems = snapshot.lineItems || snapshot.items || [];
          const priorLines = normalisedFulfilmentLines({
            purchaseOrder: curaleaf,
            shipments: curaleaf.shipments || [],
            requestedItems,
            priorLines: curaleaf.lines,
          });
          const receivedByProduct = new Map(priorLines.map(line => [line.productId, line.received]));
          for (const item of itemsPayload) {
            receivedByProduct.set(item.productId, Math.max(receivedByProduct.get(item.productId) ?? 0, item.receivedQuantity));
          }
          const lines = priorLines.map(line => ({
            ...line,
            received: Math.min(line.ordered, receivedByProduct.get(line.productId) ?? line.received),
          }));
          const shipmentStates = { ...(curaleaf.shipmentStates || {}), [supplierShipmentId]: 'received' };
          const nextStatus = advanceFulfilmentStatus(
            order.fulfilmentStatus,
            supplierFulfilmentStatus({ purchaseOrder: curaleaf, shipments: curaleaf.shipments || [], lines }),
          );
          await orderRepo.updateQuoteSnapshot({
            id: order.id,
            organisationId: scope.organisationId,
            quoteSnapshot: { ...snapshot, curaleaf: { ...curaleaf, lines, shipmentStates } },
            fulfilmentStatus: nextStatus === 'DISPATCHED_TO_PHARMACY' && lines.some(line => line.received > 0)
              ? (lines.some(line => line.received < line.ordered) ? 'PARTIALLY_RECEIVED' : 'RECEIVED')
              : nextStatus,
          }).catch(err => console.warn('Order status sync on shipment check-in warning:', err));
        }
      }

      res.status(201).json({
        id: recordId,
        shipmentId: supplierShipmentId,
        receiptNumber: input.receiptNumber || `REC-${Date.now().toString(36).toUpperCase()}`,
        organisationId: scope.organisationId,
        status: 'goods_receipt_recorded',
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/portal/shipments/:shipmentId/status', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const supplierShipmentId = String(req.params.shipmentId || '');
      const { status, orderId } = req.body || {};

      if (orderId && typeof orderId === 'string') {
        const order = await orderRepo.findOrderById(orderId, scope.organisationId);
        if (order) {
          const snapshot = snapshotObject(order.quoteSnapshot);
          const curaleaf = snapshotObject(snapshot.curaleaf);
          const shipmentStates = { ...(curaleaf.shipmentStates || {}), [supplierShipmentId]: status || 'updated' };
          const lines = Array.isArray(curaleaf.lines) ? curaleaf.lines : [];
          const remainingOpen = lines.some((line: any) => Number(line.remaining || 0) > 0 || Number(line.received || 0) < Number(line.ordered || 0));
          const nextFulfilmentStatus = status === 'collected'
            ? (remainingOpen ? 'PARTIALLY_RECEIVED' : 'COLLECTED')
            : status === 'ready_for_collection'
              ? (remainingOpen ? 'PARTIALLY_RECEIVED' : 'READY_FOR_COLLECTION')
              : undefined;
          await orderRepo.updateQuoteSnapshot({
            id: order.id,
            organisationId: scope.organisationId,
            quoteSnapshot: { ...snapshot, curaleaf: { ...curaleaf, shipmentStates } },
            fulfilmentStatus: nextFulfilmentStatus,
          }).catch(err => console.warn('Shipment status order sync warning:', err));
        }
      }

      res.status(200).json({
        shipmentId: supplierShipmentId,
        organisationId: scope.organisationId,
        status: status || 'updated',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
