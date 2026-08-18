import { createHash } from 'node:crypto';
import {
  buildCuraleafSnapshot,
  customerReferenceMatchesOrder,
  matchShipments,
  mergePriorPharmacyLines,
  normalisedFulfilmentLines,
  supplierFulfilmentStatus,
} from '../orders/curaleaf-fulfilment.js';
import type { CuraleafPurchaseOrderLike, CuraleafShipmentLike } from '../orders/curaleaf-fulfilment.js';
import { HttpError } from '../../domain/common/errors.js';

export const CURALEAF_EVENT_POLL_SECONDS = 60;
const CURSOR_OVERLAP_MS = 2_000;
const INITIAL_LOOKBACK_MS = 5 * 60_000;

export const curaleafEventKinds = {
  product: { route: '/v1/product-events/', idField: 'productId', detailRoute: '/v1/products/' },
  prescriber: { route: '/v1/prescriber-events/', idField: 'prescriberId', detailRoute: '/v1/prescribers/' },
  prescription: { route: '/v1/prescription-events/', idField: 'prescriptionId', detailRoute: '/v1/prescriptions/' },
  purchaseOrder: { route: '/v1/purchase-order-events/', idField: 'purchaseOrderId', detailRoute: '/v1/purchase-orders/' },
  shipment: { route: '/v1/shipment-events/', idField: 'shipmentId', detailRoute: '/v1/shipments/' },
} as const;

export type CuraleafEventKind = keyof typeof curaleafEventKinds;

export function curaleafEventKey(organisationId: string, kind: CuraleafEventKind, entityId: string, lastUpdated: string) {
  return createHash('sha256').update(['curaleaf', organisationId, kind, entityId, lastUpdated].join(':')).digest('hex');
}

export function eventPollBackoffSeconds(error: unknown, priorFailures: number) {
  if (error instanceof HttpError && error.statusCode === 429) {
    const retryAfter = Number((error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(300, retryAfter);
  }
  return Math.min(300, 10 * 2 ** Math.min(priorFailures, 5));
}

export function cursorAfterIso(cursorAt: string | null | undefined, now = Date.now()) {
  const parsed = Date.parse(String(cursorAt ?? ''));
  const source = Number.isFinite(parsed) ? parsed : now - INITIAL_LOOKBACK_MS;
  return new Date(source - CURSOR_OVERLAP_MS).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function curaleafEntityRecord(value: unknown, kind: CuraleafEventKind) {
  const record = asRecord(value);
  const singular = kind === 'purchaseOrder' ? 'purchaseOrder' : kind;
  const nested = record[singular];
  const result = nested && typeof nested === 'object' ? nested as Record<string, unknown> : record;
  if (typeof result.id !== 'string') throw new Error(`Curaleaf returned a ${kind} record without an id.`);
  return result;
}

export function orderMatchesCancelledPurchaseOrder(
  order: { id: string; orderNumber?: string | null; quoteSnapshot?: unknown },
  purchaseOrder: CuraleafPurchaseOrderLike,
) {
  const snapshot = asRecord(order.quoteSnapshot);
  const curaleaf = asRecord(snapshot.curaleaf);
  const recordedId = String(curaleaf.purchaseOrderId || curaleaf.id || '');
  if (recordedId && recordedId === String(purchaseOrder.id || purchaseOrder.purchaseOrderId || '')) return true;
  return customerReferenceMatchesOrder(purchaseOrder.customerReference, order);
}

export function orderMatchesCancelledPrescription(
  order: { quoteSnapshot?: unknown },
  prescription: { id?: unknown; prescriptionId?: unknown },
) {
  const snapshot = asRecord(order.quoteSnapshot);
  const curaleaf = asRecord(snapshot.curaleaf);
  const recordedId = String(curaleaf.prescriptionId || '');
  const incomingId = String(prescription.id || prescription.prescriptionId || '');
  return Boolean(recordedId && incomingId && recordedId === incomingId);
}

export function orderMatchesRejectedPrescriber(
  order: { quoteSnapshot?: unknown },
  prescriber: { id?: unknown; prescriberId?: unknown },
) {
  const snapshot = asRecord(order.quoteSnapshot);
  const curaleaf = asRecord(snapshot.curaleaf);
  const recordedId = String(curaleaf.prescriberId || '');
  const incomingId = String(prescriber.id || prescriber.prescriberId || '');
  return Boolean(recordedId && incomingId && recordedId === incomingId);
}

export function isCuraleafTerminalRejection(state: unknown) {
  const value = String(state || '').trim().toUpperCase();
  return value === 'CANCELLED' || value === 'REJECTED';
}

export function isCuraleafPrescriberRejected(state: unknown) {
  const value = String(state || '').trim().toUpperCase();
  return value === 'ARCHIVED' || value === 'REJECTED';
}

export function isCuraleafRejectedRequest(error: unknown) {
  if (!(error instanceof HttpError)) return false;
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {};
  const curaleafStatus = Number(details.curaleafStatus);
  const status = Number.isFinite(curaleafStatus) ? curaleafStatus : error.statusCode;
  return status === 400 || status === 403 || status === 422;
}

export function curaleafRequiresSupplierCancel(snapshot: unknown) {
  const curaleaf = asRecord(asRecord(snapshot).curaleaf);
  if (
    isCuraleafTerminalRejection(curaleaf.purchaseOrderState || curaleaf.state)
    || isCuraleafTerminalRejection(curaleaf.prescriptionState)
    || isCuraleafPrescriberRejected(curaleaf.prescriberState)
  ) {
    return false;
  }
  const prescriptionState = String(curaleaf.prescriptionState || '').toUpperCase();
  if (prescriptionState === 'ACTIVE' || prescriptionState === 'FULFILLED') return true;
  return Boolean(String(curaleaf.purchaseOrderId || '').trim());
}

export function supplierCancellationAlreadyConfirmed(snapshot: unknown) {
  const cancellation = asRecord(asRecord(snapshot).curaleafCancellation);
  return cancellation.status === 'confirmed';
}

export function stampCuraleafRejectionOnSnapshot(
  snapshot: unknown,
  input: {
    source: 'prescriber' | 'prescription' | 'purchase_order';
    purchaseOrderId?: string | null;
    prescriptionId?: string | null;
    prescriberId?: string | null;
    note?: string | null;
    now?: string;
  },
) {
  const note = input.note ?? (
    input.source === 'prescriber'
      ? 'Curaleaf rejected the prescriber.'
      : input.source === 'prescription'
        ? 'Curaleaf rejected the prescription.'
        : 'Curaleaf rejected the purchase order.'
  );
  const stamped = stampCuraleafCancellationOnSnapshot(snapshot, {
    action: 'confirmed',
    purchaseOrderId: input.purchaseOrderId,
    prescriptionId: input.prescriptionId,
    prescriptionState: input.source === 'prescriber' ? null : 'CANCELLED',
    reference: `curaleaf_${input.source}_rejected`,
    note,
    now: input.now,
  });
  const root = asRecord(stamped);
  const curaleaf = asRecord(root.curaleaf);
  return {
    ...root,
    curaleaf: {
      ...curaleaf,
      status: 'prescription_closed',
      ...(input.prescriberId ? { prescriberId: input.prescriberId } : {}),
      ...(input.source === 'prescriber' ? { prescriberState: 'ARCHIVED' } : {}),
      ...(input.source === 'prescription' ? { prescriptionState: 'CANCELLED' } : {}),
      ...(input.source === 'purchase_order' ? { purchaseOrderState: 'CANCELLED', state: 'CANCELLED' } : {}),
    },
  };
}

export function applyCancelledPurchaseOrderSnapshot(
  snapshot: unknown,
  purchaseOrder: CuraleafPurchaseOrderLike,
) {
  const root = asRecord(snapshot);
  const curaleaf = asRecord(root.curaleaf);
  const flow = asRecord(root.prescriptionFlow);
  const nextFlow: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flow)) {
    const prescription = asRecord(value);
    nextFlow[key] = { ...prescription, state: 'CANCELLED_PURCHASE_ORDER' };
  }
  return {
    ...root,
    prescriptionFlow: Object.keys(nextFlow).length ? nextFlow : root.prescriptionFlow,
    quoteReview: null,
    refund: asRecord(root.refund).kind === 'quote_difference' ? null : root.refund,
    curaleaf: {
      ...curaleaf,
      ...purchaseOrder,
      status: 'prescription_closed',
      purchaseOrderId: purchaseOrder.id ?? curaleaf.purchaseOrderId,
      purchaseOrderState: 'CANCELLED',
      state: 'CANCELLED',
    },
  };
}

export function stampCuraleafCancellationOnSnapshot(
  snapshot: unknown,
  input: {
    action: 'requested' | 'contacted' | 'confirmed';
    purchaseOrderId?: string | null;
    prescriptionId?: string | null;
    prescriptionState?: string | null;
    reference?: string | null;
    note?: string | null;
    actorUid?: string | null;
    reason?: 'added_in_error' | 'patient_request' | 'other';
    now?: string;
  },
) {
  const root = asRecord(snapshot);
  const prior = asRecord(root.curaleafCancellation);
  const cancellation = asRecord(root.cancellation);
  const now = input.now ?? new Date().toISOString();
  const curaleaf = asRecord(root.curaleaf);
  const purchaseOrderId = input.purchaseOrderId || (typeof curaleaf.purchaseOrderId === 'string' ? curaleaf.purchaseOrderId : typeof curaleaf.id === 'string' ? curaleaf.id : null);
  const prescriptionId = input.prescriptionId || (typeof curaleaf.prescriptionId === 'string' ? curaleaf.prescriptionId : null);
  const nextCancellation = input.action === 'confirmed'
    ? {
      status: 'confirmed' as const,
      purchaseOrderId,
      prescriptionId,
      requestedAt: prior.requestedAt || now,
      requestedBy: prior.requestedBy || input.actorUid || null,
      contactReference: prior.contactReference || input.reference || null,
      contactNote: prior.contactNote || input.note || null,
      contactedAt: prior.contactedAt || now,
      contactedBy: prior.contactedBy || input.actorUid || null,
      confirmedAt: now,
      confirmedBy: input.actorUid || null,
      confirmationReference: input.reference || 'curaleaf_po_cancelled',
    }
    : input.action === 'contacted'
      ? {
        status: 'awaiting_confirmation' as const,
        purchaseOrderId,
        prescriptionId,
        requestedAt: prior.requestedAt || now,
        requestedBy: prior.requestedBy || input.actorUid || null,
        contactReference: input.reference || null,
        contactNote: input.note || null,
        contactedAt: now,
        contactedBy: input.actorUid || null,
      }
      : {
        status: 'contact_required' as const,
        purchaseOrderId,
        prescriptionId,
        requestedAt: now,
        requestedBy: input.actorUid || null,
      };
  const nextOrderCancellation = {
    status: input.action === 'confirmed' ? 'refund_required' as const
      : input.action === 'contacted' ? 'awaiting_curaleaf_confirmation' as const
        : 'curaleaf_contact_required' as const,
    reason: input.reason || (typeof cancellation.reason === 'string' ? cancellation.reason : 'other'),
    note: input.note ?? cancellation.note ?? null,
    requestedAt: cancellation.requestedAt || now,
    requestedBy: cancellation.requestedBy || input.actorUid || null,
  };
  const cancelled = input.action === 'confirmed' && purchaseOrderId
    ? applyCancelledPurchaseOrderSnapshot(root, {
      id: purchaseOrderId,
      purchaseOrderId,
      state: 'CANCELLED',
      purchaseOrderState: 'CANCELLED',
    })
    : input.action === 'confirmed' && (prescriptionId || isCuraleafTerminalRejection(input.prescriptionState))
      ? {
        ...root,
        quoteReview: null,
        curaleaf: {
          ...curaleaf,
          status: 'prescription_closed',
          prescriptionId,
          prescriptionState: 'CANCELLED',
        },
      }
      : { ...root, quoteReview: null };
  const cancelledRecord = asRecord(cancelled);
  return {
    ...cancelled,
    quoteReview: null,
    refund: asRecord(cancelledRecord.refund).kind === 'quote_difference' ? null : cancelledRecord.refund,
    curaleafCancellation: nextCancellation,
    cancellation: nextOrderCancellation,
  };
}

export function shipmentBelongsToOrder(
  order: { id: string; orderNumber?: string | null; quoteSnapshot?: unknown },
  shipment: CuraleafShipmentLike,
) {
  const snapshot = asRecord(order.quoteSnapshot);
  const curaleaf = asRecord(snapshot.curaleaf);
  const poId = String(curaleaf.purchaseOrderId || curaleaf.id || '');
  if (poId && String(shipment.purchaseOrderId || '') === poId) return true;
  return customerReferenceMatchesOrder(
    shipment.purchaseOrderCustomerReference || shipment.customerReference,
    order,
  );
}

export function applyShipmentSnapshot(
  order: { id: string; orderNumber?: string | null; quoteSnapshot?: unknown },
  shipment: CuraleafShipmentLike,
) {
  const root = asRecord(order.quoteSnapshot);
  const curaleaf = asRecord(root.curaleaf);
  const purchaseOrder = (curaleaf.id || curaleaf.purchaseOrderId ? curaleaf : null) as CuraleafPurchaseOrderLike | null;
  const existingShipments = Array.isArray(curaleaf.shipments) ? curaleaf.shipments as CuraleafShipmentLike[] : [];
  const shipments = [
    ...existingShipments.filter(item => String(item?.id || '') !== String(shipment.id || '')),
    shipment,
  ];
  const matched = matchShipments(order, purchaseOrder, shipments);
  const requestedItems = Array.isArray(root.lineItems)
    ? (root.lineItems as Array<Record<string, unknown>>).map(item => ({
      packId: String(item.packId || item.productId || ''),
      productId: String(item.productId || item.packId || ''),
      quantity: Number(item.quantity ?? 0),
    }))
    : [];
  const lines = normalisedFulfilmentLines({
    purchaseOrder,
    shipments: matched,
    requestedItems,
    priorLines: mergePriorPharmacyLines(curaleaf.lines, Object.values(asRecord(root.prescriptionFlow)).flatMap(flow => {
      const typed = asRecord(flow);
      return Array.isArray(typed.lines) ? typed.lines as Array<Record<string, unknown>> : [];
    })),
  });
  return {
    snapshot: {
      ...root,
      curaleaf: {
        ...buildCuraleafSnapshot({
          purchaseOrder,
          shipments: matched,
          lines,
          shipmentStates: asRecord(curaleaf.shipmentStates) as Record<string, string>,
          order,
        }),
      },
    },
    fulfilmentStatus: supplierFulfilmentStatus({ purchaseOrder, shipments: matched, lines }),
  };
}
