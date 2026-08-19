import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { curaleafApiRequest, executeCuraleafOrderPlacement, fetchCuraleafPurchaseOrders, fetchCuraleafShipments, fetchCuraleafQuote } from '../../application/integrations/curaleaf.service.js';
import { curaleafRequiresSupplierCancel, stampCuraleafCancellationOnSnapshot } from '../../application/integrations/curaleaf-events.js';
import {
  curaleafCancellationBlocksPlacement,
  evaluateQuoteReview,
  readQuoteReview,
  stampQuoteReviewOnSnapshot,
  supplierOrderCancelled,
} from '../../application/orders/quote-review.js';
import {
  assertPatientEligibleForOrder,
  promotePatientAfterCuraleafPlacement,
  recordCollectedDispense,
} from '../../application/patient-finance/patient-finance.js';
import {
  advanceFulfilmentStatus,
  applyPharmacyHandout,
  buildCuraleafSnapshot,
  matchPurchaseOrder,
  matchShipments,
  mergePriorPharmacyLines,
  normalisedFulfilmentLines,
  pharmacyCountsKey,
  priorPurchaseOrderMatchesOrder,
  resolveLivePurchaseOrder,
  supplierFulfilmentStatus,
  syncSnapshotLineItemsFromPurchaseOrder,
} from '../../application/orders/curaleaf-fulfilment.js';
import { listPharmacyRecipients, pharmacyEmailContext, queueEmailToRecipients } from '../../application/notifications/email-outbox.js';
import { SqlFulfilmentRepository } from '../../repositories/sql/fulfilment.sql.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlIntegrationRepository } from '../../repositories/sql/integration.sql.js';
import { SqlNotificationRepository } from '../../repositories/sql/notification.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlPatientFinanceRepository } from '../../repositories/sql/patient-finance.sql.js';
import { SqlPatientRepository } from '../../repositories/sql/patient.sql.js';
import { purgeOrderPrescriptionFiles } from '../../application/prescriptions/prescription-file-purge.js';
import { persistCuraleafPrescriptionIdentity } from '../../application/prescriptions/curaleaf-prescription-record.js';
import type { OrderRecord, CreateOrderInput } from '../../repositories/ports/order.port.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
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
    productId: z.string().optional(),
    packId: z.string(),
    formulaId: z.string().optional(),
    name: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPricePence: z.number().int().nonnegative().optional(),
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
  pricingQuote: z.record(z.string(), z.unknown()).optional(),
  quoteSnapshot: z.record(z.string(), z.unknown()).optional(),
  redoContext: z.record(z.string(), z.unknown()).nullable().optional(),
});

async function attachCuraleafToOrder(
  order: OrderRecord,
  purchaseOrders: any[],
  shipments: any[],
  repos?: { orderRepo: SqlOrderRepository; fulfilmentRepo: SqlFulfilmentRepository },
) {
  const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, any>;
  const prior = snapshot.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : {};
  const matchedPO = resolveLivePurchaseOrder(order, purchaseOrders, prior);
  const matchedShipments = matchShipments(order, matchedPO, shipments);
  const alignedSnapshot = syncSnapshotLineItemsFromPurchaseOrder(snapshot, matchedPO, order);
  const requestedItems = (alignedSnapshot.lineItems || alignedSnapshot.items || []) as Array<{
    packId?: string;
    productId?: string;
    quantity?: number;
    qty?: number;
    count?: number;
  }>;
  const liveShipments = matchedShipments.length ? matchedShipments : (Array.isArray(prior.shipments) ? prior.shipments : []);
  const livePo = matchedPO;
  const priorValid = priorPurchaseOrderMatchesOrder(prior, order);
  const lines = normalisedFulfilmentLines({
    purchaseOrder: livePo,
    shipments: liveShipments,
    requestedItems,
    priorLines: mergePriorPharmacyLines(
      prior.lines,
      Object.values(snapshot.prescriptionFlow || {}).flatMap((flow: any) => Array.isArray(flow?.lines) ? flow.lines : []),
    ),
  });
  const liveCancelled = String(matchedPO?.state || matchedPO?.purchaseOrderState || '').toUpperCase() === 'CANCELLED';
  const snapshotCancelled = supplierOrderCancelled(snapshot);
  if (snapshotCancelled && !liveCancelled) {
    return toPortalOrder(order as any);
  }
  if (liveCancelled || snapshotCancelled) {
    const nextSnapshot = stampCuraleafCancellationOnSnapshot(alignedSnapshot, {
      action: 'confirmed',
      purchaseOrderId: String(matchedPO?.id || prior.purchaseOrderId || prior.id || ''),
      prescriptionId: typeof prior.prescriptionId === 'string' ? prior.prescriptionId : typeof matchedPO?.prescriptionId === 'string' ? matchedPO.prescriptionId : null,
      prescriptionState: String(prior.prescriptionState || matchedPO?.prescriptionState || '') === 'CANCELLED' ? 'CANCELLED' : undefined,
      reference: 'curaleaf_po_cancelled',
      note: 'Curaleaf cancelled the purchase order after pharmacy contact.',
    });
    const nextCuraleaf = {
      ...((nextSnapshot as { curaleaf?: Record<string, unknown> }).curaleaf || {}),
      prescriptionId: prior.prescriptionId || matchedPO?.prescriptionId || null,
      prescriberId: prior.prescriberId || matchedPO?.prescriberId || null,
    };
    const persisted = { ...(nextSnapshot as Record<string, unknown>), curaleaf: nextCuraleaf };
    if (repos) {
      await repos.orderRepo.updateQuoteSnapshot({
        id: order.id,
        organisationId: order.organisationId,
        quoteSnapshot: persisted,
        fulfilmentStatus: 'EXCEPTION',
      }).catch(err => console.warn('Curaleaf cancelled snapshot persist warning:', err));
      order.fulfilmentStatus = 'EXCEPTION';
      order.quoteSnapshot = persisted;
    }
    return toPortalOrder(order as any);
  }

  const curaleaf = matchedPO || (priorValid && liveShipments.length)
    ? {
      ...(livePo || {}),
      shipments: liveShipments,
      shipmentIds: liveShipments.map((shipment: any) => shipment.id).filter(Boolean),
      shipmentStates: prior.shipmentStates || {},
      lines,
    }
    : null;

  if (repos && (curaleaf || (!matchedPO && !priorValid && (prior.purchaseOrderId || prior.id)))) {
    const nextStatus = curaleaf
      ? advanceFulfilmentStatus(
        order.fulfilmentStatus,
        supplierFulfilmentStatus({ purchaseOrder: livePo, shipments: liveShipments, lines }),
      )
      : order.fulfilmentStatus;
    const nextSnapshot = curaleaf
      ? {
        ...alignedSnapshot,
        curaleaf: {
          ...prior,
          ...buildCuraleafSnapshot({
            purchaseOrder: livePo,
            shipments: liveShipments,
            lines,
            shipmentStates: prior.shipmentStates || {},
            order,
          }),
          prescriptionId: prior.prescriptionId || livePo?.prescriptionId || null,
          prescriberId: prior.prescriberId || livePo?.prescriberId || null,
          prescriptionState: prior.prescriptionState || (livePo ? 'ACTIVE' : prior.prescriptionState) || null,
          lines,
          shipmentStates: prior.shipmentStates || {},
        },
      }
      : (() => {
        const { curaleaf: _removed, ...rest } = alignedSnapshot;
        return rest;
      })();
    const previousKey = JSON.stringify({
      status: order.fulfilmentStatus,
      po: prior.purchaseOrderId || prior.id || null,
      state: prior.purchaseOrderState || prior.state || null,
      shipments: prior.shipmentIds || [],
      shipped: (prior.lines || []).map((line: any) => [line.productId, line.shipped, line.allocated]),
      pharmacy: pharmacyCountsKey(prior.lines || []),
      shipmentStates: prior.shipmentStates || {},
    });
    const nextKey = JSON.stringify({
      status: nextStatus,
      po: curaleaf ? (matchedPO?.id || null) : null,
      state: curaleaf ? (matchedPO?.state || null) : null,
      shipments: curaleaf ? liveShipments.map((shipment: any) => shipment.id) : [],
      shipped: curaleaf ? lines.map(line => [line.productId, line.shipped, line.allocated]) : [],
      pharmacy: curaleaf ? pharmacyCountsKey(lines) : [],
      shipmentStates: curaleaf ? (prior.shipmentStates || {}) : {},
      lineItems: alignedSnapshot.lineItems || alignedSnapshot.items || [],
    });
    if (previousKey !== nextKey) {
      await repos.orderRepo.updateQuoteSnapshot({
        id: order.id,
        organisationId: order.organisationId,
        quoteSnapshot: nextSnapshot,
        fulfilmentStatus: curaleaf
          ? nextStatus as CreateOrderInput['fulfilmentStatus']
          : undefined,
      }).catch(err => console.warn('Curaleaf snapshot persist warning:', err));
      order.fulfilmentStatus = nextStatus;
      order.quoteSnapshot = nextSnapshot;
    }
    for (const shipment of liveShipments) {
      if (!shipment?.id || !matchedPO?.id) continue;
      await repos.fulfilmentRepo.upsertSupplierShipment({
        organisationId: order.organisationId,
        orderId: order.id,
        supplierPurchaseOrderId: String(matchedPO.id),
        supplierShipmentId: String(shipment.id),
        supplierCustomerReference: shipment.purchaseOrderCustomerReference || matchedPO.customerReference || order.orderNumber,
        dispatchedAt: shipment.createdAt || null,
      }).catch(err => console.warn('Curaleaf shipment persist warning:', err));
    }
  }

  return toPortalOrder({
    ...order,
    ...(curaleaf ? { curaleaf } : {}),
  } as any);
}

export function createPortalOrderRouter(): Router {
  const router = Router();
  const orderRepo = new SqlOrderRepository();
  const integrationRepo = new SqlIntegrationRepository();
  const identityRepo = new SqlIdentityRepository();
  const paymentRepo = new SqlPaymentRepository();
  const fulfilmentRepo = new SqlFulfilmentRepository();
  const notificationRepo = new SqlNotificationRepository();
  const organisationRepo = new SqlOrganisationRepository();
  const patientRepo = new SqlPatientRepository();
  const patientFinanceRepo = new SqlPatientFinanceRepository();
  const patientFinanceDeps = { patientRepo, patientFinanceRepo };

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

      if (input.patientId) {
        const patient = await patientRepo.findPatientById(scope.organisationId, input.patientId);
        assertPatientEligibleForOrder(patient);
      }

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

      const patient = await patientRepo.findPatientById(scope.organisationId, input.patientId);
      assertPatientEligibleForOrder(patient);

      const medicineTotalPence = input.medicineTotalPence ?? input.lineItems.reduce((s, it) => s + (it.unitPricePence ?? 0) * it.quantity, 0);
      const dispensingFeePence = input.dispensingFeePence ?? 0;
      const deliveryPence = input.deliveryPence ?? 0;
      const taxPence = input.taxPence ?? 0;
      const calculatedTotal = medicineTotalPence + dispensingFeePence + deliveryPence + taxPence;
      const totalPence = input.totalPence && input.totalPence > 0 ? input.totalPence : calculatedTotal;
      const redoContext = input.redoContext && typeof input.redoContext === 'object' ? input.redoContext as Record<string, unknown> : null;
      if (redoContext?.priceResolution === 'refund_and_recharge') {
        throw new HttpError(409, 'Cancel the source order and use paid-order resolution instead of creating a new payment link.', 'REDO_REFUND_RECHARGE_REMOVED');
      }
      const paymentRoute = input.paymentRoute.toUpperCase() === 'WORLDPAY' ? 'WORLDPAY' as const : 'MANUAL' as const;
      const orderNumber = input.orderNumber || `ORD-${Date.now().toString(36).toUpperCase()}`;

      const quoteSnapshot = input.quoteSnapshot ?? {
        prescriptions: input.prescriptions,
        lineItems: input.lineItems,
        pricingQuote: input.pricingQuote ?? null,
        medicineTotalPence,
        dispensingFeePence,
        totalPence,
      };

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
        quoteSnapshot,
        createdByUid: scope.uid,
      });

      if (input.draftId) {
        await orderRepo.deleteDraft(input.draftId, scope.organisationId).catch(() => undefined);
      }

      const pharmacyRecipients = await listPharmacyRecipients(scope.organisationId, { identityRepo, organisationRepo });
      await queueEmailToRecipients(
        notificationRepo,
        pharmacyRecipients,
        'pharmacy_order_accepted',
        {
          orderNumber,
          amountPence: totalPence,
          currency: input.currency,
        },
        ['pharmacy-order-accepted', result.id, orderNumber],
        { organisationId: scope.organisationId, patientId: input.patientId, orderId: result.id },
      );

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

      const connection = await integrationRepo.findConnection(scope.organisationId, 'CURALEAF').catch(() => null);
      let curaleafPOs: any[] = [];
      let curaleafShipments: any[] = [];
      if (connection?.secretResourceName) {
        [curaleafPOs, curaleafShipments] = await Promise.all([
          fetchCuraleafPurchaseOrders(connection).catch(() => []),
          fetchCuraleafShipments(connection).catch(() => []),
        ]);
      }

      const ordersWithPOs = await Promise.all(orders.map(order => (
        attachCuraleafToOrder(order, curaleafPOs, curaleafShipments, { orderRepo, fulfilmentRepo })
      )));

      res.status(200).json(ordersWithPOs);
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

      const connection = await integrationRepo.findConnection(scope.organisationId, 'CURALEAF').catch(() => null);
      let curaleafPOs: any[] = [];
      let curaleafShipments: any[] = [];
      if (connection?.secretResourceName) {
        [curaleafPOs, curaleafShipments] = await Promise.all([
          fetchCuraleafPurchaseOrders(connection).catch(() => []),
          fetchCuraleafShipments(connection).catch(() => []),
        ]);
      }

      const mapped = await attachCuraleafToOrder(order, curaleafPOs, curaleafShipments, { orderRepo, fulfilmentRepo });
      res.status(200).json(mapped);
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

      if (order.paymentStatus !== 'PAID' && !order.paidAt) {
        throw new HttpError(409, 'Order must be paid before placing with Curaleaf.', 'ORDER_NOT_PAID');
      }
      if (curaleafCancellationBlocksPlacement(order.quoteSnapshot)) {
        throw new HttpError(409, 'This Curaleaf order was cancelled.', 'CURALEAF_ORDER_CANCELLED');
      }

      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'PROCESSING',
        fulfilmentStatus: 'SUPPLIER_PENDING',
      });

      // Submit purchase order to Curaleaf API if connected (deduped — never double-submit)
      const connection = await integrationRepo.findConnection(scope.organisationId, 'CURALEAF').catch(() => null);
      let curaleafResult: any = null;
      if (connection?.secretResourceName) {
        try {
          curaleafResult = await executeCuraleafOrderPlacement(connection, order);
        } catch (curaleafErr) {
          console.warn('Curaleaf purchase order submission note:', curaleafErr);
        }
      }

      if (curaleafResult?.prescriptionId || curaleafResult?.purchaseOrder) {
        await persistCuraleafPrescriptionIdentity({
          organisationId: scope.organisationId,
          orderId,
          patientId: order.patientId,
          snapshot: order.quoteSnapshot,
          prescriptionId: curaleafResult.prescriptionId,
          prescriberId: curaleafResult.prescriberId,
          purchaseOrder: curaleafResult.purchaseOrder ?? null,
          fulfilmentStatus: curaleafResult.purchaseOrder ? 'SUPPLIER_PROCESSING' : undefined,
        }).catch(err => console.warn('Curaleaf placement snapshot persist warning:', err));
      }

      await promotePatientAfterCuraleafPlacement(patientFinanceDeps, order, curaleafResult).catch(err =>
        console.warn('Patient activation after Curaleaf placement note:', err),
      );

      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        orderLineId: prescriptionId,
        fromState: 'PENDING_PLACEMENT',
        toState: 'PLACED',
        reason: curaleafResult?.skipped
          ? `Prescription already placed with Curaleaf (${curaleafResult.reason})`
          : curaleafResult?.purchaseOrder?.id
            ? 'Prescription placed with Curaleaf Laboratories'
            : 'Prescription placed manually with pharmacy dispensing',
        externalReference: curaleafResult?.purchaseOrder?.id || order.orderNumber,
        actorUid: scope.uid,
      });

      res.status(200).json({ success: true, status: 'placed_manually', curaleaf: curaleafResult });
    } catch (error) {
      next(error);
    }
  });

  router.post('/portal/orders/:id/cancellations', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        reason: z.enum(['added_in_error', 'patient_request', 'other']),
        note: z.string().max(1000).optional(),
      }).parse(req.body);
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      const requiresCuraleafCancel = curaleafRequiresSupplierCancel(order.quoteSnapshot) && !supplierOrderCancelled(order.quoteSnapshot);
      const snapshot = stampCuraleafCancellationOnSnapshot(order.quoteSnapshot, {
        action: supplierOrderCancelled(order.quoteSnapshot) || !requiresCuraleafCancel ? 'confirmed' : 'requested',
        reason: input.reason,
        note: input.note,
        actorUid: scope.uid,
      });
      const exception = requiresCuraleafCancel || order.paymentStatus === 'PAID' || supplierOrderCancelled(snapshot);
      await orderRepo.updateQuoteSnapshot({
        id: orderId,
        organisationId: scope.organisationId,
        quoteSnapshot: snapshot,
        fulfilmentStatus: exception ? 'EXCEPTION' : undefined,
      });
      if (!requiresCuraleafCancel && order.paymentStatus !== 'PAID') {
        await orderRepo.updateOrderStatus({
          id: orderId,
          organisationId: scope.organisationId,
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
        });
      }
      const mapped = toPortalOrder({ ...order, quoteSnapshot: snapshot, fulfilmentStatus: exception ? 'EXCEPTION' : order.fulfilmentStatus } as any);
      res.status(201).json(mapped);
    } catch (error) { next(error); }
  });

  router.post('/portal/orders/:id/quote-review/resolve', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        action: z.enum(['absorb', 'continue_as_fee', 'refresh']),
      }).parse(req.body);
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      if (curaleafCancellationBlocksPlacement(order.quoteSnapshot)) {
        throw new HttpError(409, 'This Curaleaf purchase order was cancelled.', 'CURALEAF_ORDER_CANCELLED');
      }
      const connection = await integrationRepo.findConnection(scope.organisationId, 'CURALEAF').catch(() => null);
      const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, any>;
      const review = readQuoteReview(snapshot);
      const now = new Date().toISOString();
      const lineItems = Array.isArray(snapshot.lineItems) ? snapshot.lineItems as Array<Record<string, unknown>> : [];
      const quoteItems = lineItems.map(item => ({
        packId: String(item.packId || item.productId || ''),
        quantity: Number(item.quantity || item.count || 1),
      })).filter(item => item.packId && item.quantity > 0);

      const persistAndMaybePlace = async (nextSnapshot: unknown, extra?: { dispensingFeePence?: number; medicineTotalPence?: number; place?: boolean }) => {
        await orderRepo.updateQuoteSnapshot({
          id: orderId,
          organisationId: scope.organisationId,
          quoteSnapshot: nextSnapshot,
          fulfilmentStatus: 'SUPPLIER_PENDING',
          dispensingFeePence: extra?.dispensingFeePence,
          medicineTotalPence: extra?.medicineTotalPence,
        });
        let placement = null;
        if (extra?.place && connection?.secretResourceName) {
          placement = await executeCuraleafOrderPlacement(connection, {
            ...order,
            quoteSnapshot: nextSnapshot,
            paymentStatus: 'PAID',
            paidAt: order.paidAt,
            status: 'PROCESSING',
          });
        }
        const latest = await orderRepo.findOrderById(orderId, scope.organisationId);
        return { order: latest, placement };
      };

      if (input.action === 'refresh') {
        if (!connection?.secretResourceName || !quoteItems.length) throw new HttpError(409, 'A live Curaleaf quote is required.', 'QUOTE_UNAVAILABLE');
        const latestQuote = await fetchCuraleafQuote(connection, quoteItems);
        const decision = evaluateQuoteReview({ snapshot, latestRaw: latestQuote, now });
        if (!decision.hold) {
          const approved = stampQuoteReviewOnSnapshot(snapshot, {
            status: 'approved',
            type: review?.type || 'supplier_cost_changed',
            fingerprint: decision.fingerprint,
            latestQuote,
            differences: [],
            patientDeltaPence: 0,
            checkedAt: now,
            approvedAt: now,
            approvedFingerprint: decision.fingerprint,
          });
          const result = await persistAndMaybePlace(approved, { place: true });
          res.status(200).json({ action: 'refresh', placed: Boolean(result.placement && 'purchaseOrder' in result.placement && result.placement.purchaseOrder), order: toPortalOrder(result.order as any) });
          return;
        }
        const held = stampQuoteReviewOnSnapshot(snapshot, decision.review);
        const result = await persistAndMaybePlace(held);
        res.status(200).json({ action: 'refresh', placed: false, order: toPortalOrder(result.order as any) });
        return;
      }

      if (!review || (review.status !== 'required' && review.status !== 'awaiting_top_up' && review.status !== 'awaiting_refund')) {
        throw new HttpError(409, 'This order is not waiting on quote review.', 'QUOTE_REVIEW_NOT_REQUIRED');
      }

      if (input.action === 'absorb') {
        if (review.type === 'out_of_stock') throw new HttpError(409, 'Out-of-stock lines cannot be absorbed.', 'STOCK_HOLD');
        if (review.type === 'patient_price_changed' && review.patientDeltaPence < 0) {
          throw new HttpError(409, 'Absorb is only for a patient-price increase.', 'QUOTE_REVIEW_ACTION');
        }
        const approved = stampQuoteReviewOnSnapshot({
          ...snapshot,
          pharmacyContributionPence: Math.max(0, review.patientDeltaPence),
        }, {
          ...review,
          status: 'approved',
          approvedAt: now,
          approvedFingerprint: review.fingerprint,
          pharmacyContributionPence: Math.max(0, review.patientDeltaPence),
        });
        const result = await persistAndMaybePlace(approved, { place: true });
        res.status(200).json({ action: 'absorb', order: toPortalOrder(result.order as any) });
        return;
      }

      if (input.action === 'continue_as_fee') {
        if (review.type !== 'patient_price_changed' || review.patientDeltaPence >= 0) {
          throw new HttpError(409, 'Continue as fee is only for a patient-price drop.', 'QUOTE_REVIEW_ACTION');
        }
        const extraFee = Math.abs(review.patientDeltaPence);
        const approved = stampQuoteReviewOnSnapshot(snapshot, {
          ...review,
          status: 'approved',
          approvedAt: now,
          approvedFingerprint: review.fingerprint,
        });
        const result = await persistAndMaybePlace(approved, {
          dispensingFeePence: Number(order.dispensingFeePence || 0) + extraFee,
          medicineTotalPence: Math.max(0, Number(order.medicineTotalPence || 0) + review.patientDeltaPence),
          place: true,
        });
        res.status(200).json({ action: 'continue_as_fee', order: toPortalOrder(result.order as any) });
        return;
      }

      throw new HttpError(400, 'Unsupported quote review action.', 'QUOTE_REVIEW_ACTION');
    } catch (error) { next(error); }
  });

  // POST /v1/portal/orders/:id/curaleaf-cancellation - Record Curaleaf order cancellation
  router.post('/portal/orders/:id/curaleaf-cancellation', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        action: z.enum(['contacted', 'confirmed']).default('contacted'),
        reference: z.string().trim().min(3).max(160).optional(),
        note: z.string().max(1000).optional(),
        reason: z.string().min(1).max(255).optional(),
      }).parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) {
        throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
      }

      const snapshot = stampCuraleafCancellationOnSnapshot(order.quoteSnapshot, {
        action: input.action,
        reference: input.reference || input.reason || 'curaleaf_contact',
        note: input.note,
        actorUid: scope.uid,
      });
      await orderRepo.updateQuoteSnapshot({
        id: orderId,
        organisationId: scope.organisationId,
        quoteSnapshot: snapshot,
        fulfilmentStatus: input.action === 'confirmed' || supplierOrderCancelled(snapshot)
          ? 'EXCEPTION'
          : undefined,
      });
      const latest = await orderRepo.findOrderById(orderId, scope.organisationId);
      res.status(200).json(toPortalOrder(latest as any));
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
        fromState: 'PENDING_PLACEMENT',
        toState: 'HELD_STOCK',
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

  // POST /v1/portal/orders/:id/refunds/manual - Prepare manual refund task
  router.post('/portal/orders/:id/refunds/manual', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        reason: z.enum(['patient_cancelled', 'replacement_price_changed']),
        resolution: z.enum(['cancel', 'replace_new_payment']),
      }).parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');

      const refundId = `ref-${Date.now().toString(36)}`;
      const refundState = {
        id: refundId,
        status: 'pending_confirmation',
        amountPence: Number(order.totalPence || 0),
        method: order.paymentRoute === 'worldpay' ? 'worldpay_portal' : 'pharmacy_manual',
        paymentReference: order.orderNumber || order.id,
        transactionReference: order.orderNumber || order.id,
        reason: input.reason,
        resolution: input.resolution,
        requestedAt: new Date().toISOString(),
        requestedBy: scope.uid,
      };

      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
      });

      await purgeOrderPrescriptionFiles(scope.organisationId, order.quoteSnapshot).catch(error =>
        console.warn('[Prescription file] Purge after cancellation note:', error),
      );

      res.status(201).json(refundState);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/refunds/:refundId/confirm - Confirm completed manual refund
  router.post('/portal/orders/:id/refunds/:refundId/confirm', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const refundId = String(req.params.refundId || '');
      const input = z.object({
        organisationId: z.string().optional(),
        externalReference: z.string().trim().min(3).max(160),
      }).parse(req.body);

      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');

      const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, any>;
      const review = readQuoteReview(snapshot);
      const now = new Date().toISOString();

      if (review || snapshot.refund?.kind === 'quote_difference') {
        await orderRepo.updateQuoteSnapshot({
          id: orderId,
          organisationId: scope.organisationId,
          quoteSnapshot: stampQuoteReviewOnSnapshot({
            ...snapshot,
            refund: {
              id: refundId,
              status: 'completed',
              kind: 'paid_order',
              amountPence: Number(order.totalPence || 0),
              externalReference: input.externalReference,
              confirmedAt: now,
              confirmedBy: scope.uid,
            },
          }, null),
          fulfilmentStatus: 'EXCEPTION',
        });
      }

      await paymentRepo.updatePaymentStatus(orderId, 'CANCELLED', orderId);
      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'CANCELLED',
        cancelledAt: now,
      });

      await purgeOrderPrescriptionFiles(scope.organisationId, order.quoteSnapshot).catch(error =>
        console.warn('[Prescription file] Purge after cancellation note:', error),
      );

      const nextRefund = {
        id: refundId,
        status: 'completed',
        amountPence: Number(order.totalPence || 0),
        externalReference: input.externalReference,
        confirmedAt: now,
        confirmedBy: scope.uid,
      };

      const [patient, organisation] = await Promise.all([
        patientRepo.findPatientById(scope.organisationId, order.patientId).catch(() => null),
        organisationRepo.findOrganisationById(scope.organisationId).catch(() => null),
      ]);
      if (patient?.email) {
        await queueEmailToRecipients(
          notificationRepo,
          [{ email: patient.email, displayName: patient.firstName || null }],
          'patient_refunded',
          {
            firstName: patient.firstName || 'Patient',
            amountPence: nextRefund.amountPence,
            currency: order.currency || 'GBP',
            orderNumber: order.orderNumber,
            ...pharmacyEmailContext(organisation),
          },
          ['patient-refunded', orderId, refundId],
          { organisationId: scope.organisationId, patientId: order.patientId, orderId },
        );
      }

      res.status(200).json(nextRefund);
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/handout - Hand out medication to patient
  router.post('/portal/orders/:id/handout', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const input = z.object({
        organisationId: z.string().optional(),
        partial: z.boolean().optional(),
        shipmentId: z.string().optional(),
      }).parse(req.body || {});
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');

      const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, any>;
      const curaleaf = snapshot.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : {};
      const requestedItems = snapshot.lineItems || snapshot.items || [];
      const lines = normalisedFulfilmentLines({
        purchaseOrder: curaleaf,
        shipments: curaleaf.shipments || [],
        requestedItems,
        priorLines: curaleaf.lines,
      });
      const result = applyPharmacyHandout({
        lines,
        shipmentStates: curaleaf.shipmentStates || {},
        shipmentId: input.shipmentId,
        partial: input.partial === true,
      });
      if (!result.allowed) {
        throw new HttpError(409, 'Remaining packs are still open with Curaleaf. Use partial handover for arrived packs only.', 'REMAINDER_OPEN');
      }
      if (!order.patientId) {
        throw new HttpError(409, 'The order has no patient.', 'PATIENT_REQUIRED');
      }

      const collectedAt = new Date().toISOString();
      const dispenseKey = input.shipmentId || (input.partial ? `partial-${collectedAt.slice(0, 10)}` : 'full');
      await recordCollectedDispense(patientFinanceDeps, {
        organisationId: scope.organisationId,
        patientId: order.patientId,
        orderId,
        actorUid: scope.uid,
        dispenseKey,
        collectedAt,
      });

      const nextStatus = result.remainingOpen
        ? 'PARTIALLY_RECEIVED'
        : 'COLLECTED';
      await orderRepo.updateQuoteSnapshot({
        id: orderId,
        organisationId: scope.organisationId,
        quoteSnapshot: {
          ...snapshot,
          curaleaf: {
            ...curaleaf,
            lines: result.lines,
            shipmentStates: result.shipmentStates,
          },
        },
        fulfilmentStatus: nextStatus,
      });

      if (!result.remainingOpen) {
        await orderRepo.updateOrderStatus({
          id: orderId,
          organisationId: scope.organisationId,
          status: 'COMPLETED',
          fulfilmentStatus: 'COLLECTED',
        });
      }

      const pharmacyRecipients = await listPharmacyRecipients(scope.organisationId, { identityRepo, organisationRepo });
      await queueEmailToRecipients(
        notificationRepo,
        pharmacyRecipients,
        'pharmacy_collection_completed',
        {
          orderNumber: order.orderNumber,
          summary: result.remainingOpen ? 'Partial collection completed.' : 'Collection completed.',
        },
        ['pharmacy-collection-completed', orderId, dispenseKey],
        { organisationId: scope.organisationId, patientId: order.patientId, orderId },
      );

      res.status(200).json({
        id: orderId,
        status: result.remainingOpen ? 'partially_collected' : 'collected',
        collectedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/ready-for-collection - Mark order ready for collection
  router.post('/portal/orders/:id/ready-for-collection', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');

      const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, any>;
      const curaleaf = snapshot.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : {};
      const lines = Array.isArray(curaleaf.lines) ? curaleaf.lines : [];
      const remainingOpen = lines.some((line: any) => Number(line.remaining || 0) > 0 || Number(line.received || 0) < Number(line.ordered || 0));
      await orderRepo.updateQuoteSnapshot({
        id: orderId,
        organisationId: scope.organisationId,
        quoteSnapshot: snapshot,
        fulfilmentStatus: remainingOpen ? 'PARTIALLY_RECEIVED' : 'READY_FOR_COLLECTION',
      });

      const patient = await patientRepo.findPatientById(scope.organisationId, order.patientId).catch(() => null);
      if (patient?.email) {
        const organisation = await organisationRepo.findOrganisationById(scope.organisationId).catch(() => null);
        await queueEmailToRecipients(
          notificationRepo,
          [{ email: patient.email, displayName: patient.firstName || null }],
          'patient_ready_for_collection',
          {
            firstName: patient.firstName || 'Patient',
            orderNumber: order.orderNumber,
            ...pharmacyEmailContext(organisation),
          },
          ['patient-ready-for-collection', orderId, remainingOpen ? 'partial' : 'full'],
          { organisationId: scope.organisationId, patientId: order.patientId, orderId },
        );
      }

      res.status(200).json({ id: orderId, status: 'ready', readyAt: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  // POST /v1/portal/orders/:id/cancel-and-archive - Cancel with Curaleaf & Replace Order
  router.post('/portal/orders/:id/cancel-and-archive', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const orderId = String(req.params.id || '');
      const order = await orderRepo.findOrderById(orderId, scope.organisationId);
      if (!order) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');

      const connection = await integrationRepo.findConnection(scope.organisationId, 'CURALEAF').catch(() => null);
      if (connection?.secretResourceName) {
        try {
          const pos = await fetchCuraleafPurchaseOrders(connection);
          const po = resolveLivePurchaseOrder(order, pos, (order.quoteSnapshot as any)?.curaleaf);
          if (po?.id) {
            await curaleafApiRequest(connection, `/v1/purchase-orders/${po.id}`, {
              method: 'DELETE',
            });
          }
        } catch (err) {
          console.warn('Failed to cancel Curaleaf order:', err);
        }
      }

      await orderRepo.updateOrderStatus({
        id: orderId,
        organisationId: scope.organisationId,
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
      });

      await purgeOrderPrescriptionFiles(scope.organisationId, order.quoteSnapshot).catch(error =>
        console.warn('[Prescription file] Purge after cancellation note:', error),
      );

      await orderRepo.appendPlacementEvent({
        organisationId: scope.organisationId,
        orderId,
        toState: 'CANCELLED_REFUNDED',
        reason: 'Order cancelled and archived for replacement',
        actorUid: scope.uid,
      });

      const pharmacyRecipients = await listPharmacyRecipients(scope.organisationId, { identityRepo, organisationRepo });
      await queueEmailToRecipients(
        notificationRepo,
        pharmacyRecipients,
        'pharmacy_order_cancelled',
        {
          orderNumber: order.orderNumber,
          summary: 'Order cancelled and archived for replacement.',
        },
        ['pharmacy-order-cancelled', orderId, 'archive'],
        { organisationId: scope.organisationId, patientId: order.patientId, orderId },
      );

      res.status(200).json({ success: true, cancelledOrderId: orderId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
