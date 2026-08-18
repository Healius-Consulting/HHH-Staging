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
    curaleaf: {
      ...curaleaf,
      ...purchaseOrder,
      purchaseOrderId: purchaseOrder.id ?? curaleaf.purchaseOrderId,
      purchaseOrderState: 'CANCELLED',
      state: 'CANCELLED',
    },
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
