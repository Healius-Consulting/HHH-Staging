import { createHash } from 'node:crypto';

export type DispatchStatus = 'not_dispatched' | 'partial' | 'complete';

export type SupplierFulfilmentStatus =
  | 'SUPPLIER_PENDING'
  | 'SUPPLIER_PROCESSING'
  | 'SUPPLIER_ALLOCATED'
  | 'PARTIALLY_DISPATCHED_TO_PHARMACY'
  | 'DISPATCHED_TO_PHARMACY'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'READY_FOR_COLLECTION'
  | 'COLLECTED'
  | 'EXCEPTION';

export interface CuraleafPoItem {
  productId?: string | null;
  formulaId?: string | null;
  packsOrderedCount?: number | string | null;
  packsAllocatedCount?: number | string | null;
  packsReturnedCount?: number | string | null;
  count?: number | string | null;
}

export interface CuraleafPurchaseOrderLike {
  id?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderState?: string | null;
  state?: string | null;
  courier?: string | null;
  customerReference?: string | null;
  issuedDate?: string | null;
  createdAt?: string | null;
  items?: CuraleafPoItem[] | null;
}

export interface CuraleafShipmentItemLike {
  productId?: string | null;
  sku?: string | null;
  packCount?: number | string | null;
  count?: number | string | null;
  packsReturnedCount?: number | string | null;
  batchNumber?: string | null;
  batchExpiryDate?: string | null;
  formulaId?: string | null;
}

export interface CuraleafShipmentLike {
  id?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderCustomerReference?: string | null;
  customerReference?: string | null;
  createdAt?: string | null;
  items?: CuraleafShipmentItemLike[] | null;
}

export interface FulfilmentLine {
  lineId: string;
  productId: string;
  ordered: number;
  requested: number;
  sent: number | null;
  supplierReportedOrdered: number;
  allocated: number;
  shipped: number;
  returned: number;
  remaining: number;
  received: number;
  collected: number;
  backordered: boolean;
  quantityMismatch: boolean;
}

const FULFILMENT_RANK: Record<string, number> = {
  SUPPLIER_PENDING: 0,
  SUPPLIER_PROCESSING: 1,
  SUPPLIER_ALLOCATED: 2,
  PARTIALLY_DISPATCHED_TO_PHARMACY: 3,
  DISPATCHED_TO_PHARMACY: 4,
  PARTIALLY_RECEIVED: 5,
  RECEIVED: 6,
  READY_FOR_COLLECTION: 7,
  COLLECTED: 8,
  EXCEPTION: 9,
};

export function count(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function customerReferenceMatchesOrder(
  reference: string | null | undefined,
  order: { id: string; orderNumber?: string | null },
) {
  const ref = String(reference || '').trim();
  if (!ref) return false;
  const orderNum = String(order.orderNumber || '').trim();
  const orderId = String(order.id || '').trim();
  if (orderNum && (
    ref === orderNum
    || ref === `ORD-${orderNum}`
    || orderNum === `ORD-${ref}`
    || ref === `HHH-${orderNum}`
    || orderNum === `HHH-${ref}`
  )) return true;
  if (orderId && (
    ref === orderId
    || ref === `HHH-${orderId}`
    || ref.startsWith(`HHH-${orderId}-`)
    || ref.includes(orderId)
  )) return true;
  return false;
}

export function purchaseOrderMatchScore(
  order: { id: string; orderNumber?: string | null },
  purchaseOrder: CuraleafPurchaseOrderLike,
) {
  const ref = String(purchaseOrder.customerReference || '').trim();
  const orderId = String(order.id || '').trim();
  const orderNum = String(order.orderNumber || '').trim();
  const poId = String(purchaseOrder.id || '').trim();
  if (orderId && ref.startsWith(`HHH-${orderId}-`)) return 1_000;
  if (orderId && ref === `HHH-${orderId}`) return 900;
  if (orderId && ref.includes(orderId)) return 800;
  if (orderId && poId === orderId) return 700;
  if (orderNum && ref === orderNum) return 500;
  if (orderNum && ref === `ORD-${orderNum}`) return 500;
  if (orderNum && orderNum === `ORD-${ref}`) return 500;
  if (orderNum && ref === `HHH-${orderNum}`) return 400;
  if (orderNum && orderNum === `HHH-${ref}`) return 400;
  if (orderNum && poId === orderNum) return 300;
  return 0;
}

export function existingCuraleafPurchaseOrder(
  order: { id: string; orderNumber?: string | null; quoteSnapshot?: unknown },
) {
  const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, unknown>;
  const prior = (snapshot.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : null) as CuraleafPurchaseOrderLike | null;
  if (!prior) return null;
  const priorId = String(prior.purchaseOrderId || prior.id || '').trim();
  if (!priorId || !priorPurchaseOrderMatchesOrder(prior, order)) return null;
  return prior;
}

export function priorPurchaseOrderMatchesOrder(
  prior: CuraleafPurchaseOrderLike | null | undefined,
  order: { id: string; orderNumber?: string | null },
) {
  if (!prior || typeof prior !== 'object') return false;
  const ref = prior.customerReference;
  if (ref && customerReferenceMatchesOrder(ref, order)) return true;
  const priorId = String(prior.purchaseOrderId || prior.id || '').trim();
  if (!priorId) return false;
  return priorId === String(order.id || '').trim() || priorId === String(order.orderNumber || '').trim();
}

export function matchPurchaseOrder(
  order: { id: string; orderNumber?: string | null },
  purchaseOrders: CuraleafPurchaseOrderLike[],
  prior?: CuraleafPurchaseOrderLike | null,
) {
  const ranked = purchaseOrders
    .map(purchaseOrder => ({ purchaseOrder, score: purchaseOrderMatchScore(order, purchaseOrder) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length > 0) return ranked[0]!.purchaseOrder;

  const priorId = String(prior?.purchaseOrderId || prior?.id || '').trim();
  const priorRef = prior?.customerReference;
  if (priorId && priorRef && customerReferenceMatchesOrder(priorRef, order)) {
    return purchaseOrders.find(purchaseOrder => String(purchaseOrder.id || '') === priorId) ?? null;
  }
  return null;
}

export function resolveLivePurchaseOrder(
  order: { id: string; orderNumber?: string | null },
  purchaseOrders: CuraleafPurchaseOrderLike[],
  prior?: CuraleafPurchaseOrderLike | null,
) {
  const matched = matchPurchaseOrder(order, purchaseOrders, prior);
  if (matched) return matched;
  if (!priorPurchaseOrderMatchesOrder(prior, order)) return null;
  const priorId = String(prior?.purchaseOrderId || prior?.id || '').trim();
  return priorId
    ? purchaseOrders.find(purchaseOrder => String(purchaseOrder.id || '') === priorId) ?? null
    : null;
}

export function syncSnapshotLineItemsFromPurchaseOrder(
  snapshot: Record<string, unknown>,
  purchaseOrder: CuraleafPurchaseOrderLike | null,
  order: { id: string; orderNumber?: string | null },
) {
  if (!purchaseOrder?.items?.length) return snapshot;
  const ref = String(purchaseOrder.customerReference || '').trim();
  if (!ref || !customerReferenceMatchesOrder(ref, order)) return snapshot;

  const poByProduct = new Map(
    purchaseOrder.items.flatMap(item => item.productId
      ? [[String(item.productId), count(item.packsOrderedCount ?? item.count)] as const]
      : []),
  );
  if (!poByProduct.size) return snapshot;

  const patchItems = (items: unknown) => {
    if (!Array.isArray(items)) return items;
    return items.map(raw => {
      const item = raw as Record<string, unknown>;
      const productId = String(item.packId || item.productId || '');
      const poQty = poByProduct.get(productId);
      if (!productId || !poQty) return item;
      const currentQty = count(item.quantity ?? item.qty);
      if (currentQty === poQty) return item;
      return { ...item, quantity: poQty, qty: poQty };
    });
  };

  const next = { ...snapshot };
  if (Array.isArray(next.lineItems)) next.lineItems = patchItems(next.lineItems);
  if (Array.isArray(next.items)) next.items = patchItems(next.items);
  if (next.prescriptionFlow && typeof next.prescriptionFlow === 'object') {
    const flows = { ...(next.prescriptionFlow as Record<string, unknown>) };
    for (const [key, flow] of Object.entries(flows)) {
      if (!flow || typeof flow !== 'object') continue;
      const typed = flow as Record<string, unknown>;
      flows[key] = {
        ...typed,
        ...(Array.isArray(typed.items) ? { items: patchItems(typed.items) } : {}),
      };
    }
    next.prescriptionFlow = flows;
  }
  return next;
}

export function matchShipments(
  order: { id: string; orderNumber?: string | null },
  purchaseOrder: CuraleafPurchaseOrderLike | null,
  shipments: CuraleafShipmentLike[],
) {
  return shipments.filter(shipment => {
    if (!shipment) return false;
    if (purchaseOrder?.id && shipment.purchaseOrderId === purchaseOrder.id) return true;
    const ref = shipment.purchaseOrderCustomerReference || shipment.customerReference || '';
    if (customerReferenceMatchesOrder(ref, order)) return true;
    if (purchaseOrder?.customerReference && ref === purchaseOrder.customerReference) return true;
    return false;
  });
}

export function mergePriorPharmacyLines(...sources: unknown[]): Array<Record<string, unknown>> {
  const byProduct = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    const lines = Array.isArray(source) ? source as Array<Record<string, unknown>> : [];
    for (const line of lines) {
      const productId = String(line.productId ?? '');
      if (!productId) continue;
      const existing = byProduct.get(productId);
      if (!existing) {
        byProduct.set(productId, { ...line, productId });
        continue;
      }
      byProduct.set(productId, {
        ...existing,
        ...line,
        productId,
        received: Math.max(count(existing.received), count(line.received)),
        collected: Math.max(count(existing.collected), count(line.collected)),
      });
    }
  }
  return [...byProduct.values()];
}

export function pharmacyCountsKey(lines: Array<{ productId?: string; received?: number; collected?: number }>) {
  return lines.map(line => [String(line.productId || ''), count(line.received), count(line.collected)]);
}

export function applyPharmacyGoodsReceipt(input: {
  lines: FulfilmentLine[];
  items: Array<{ productId: string; receivedQuantity: number }>;
  shipmentId: string;
  shipmentStates?: Record<string, string>;
}): { lines: FulfilmentLine[]; shipmentStates: Record<string, string> } {
  const receivedByProduct = new Map(input.lines.map(line => [line.productId, line.received]));
  for (const item of input.items) {
    receivedByProduct.set(item.productId, Math.max(receivedByProduct.get(item.productId) ?? 0, count(item.receivedQuantity)));
  }
  const lines = input.lines.map(line => ({
    ...line,
    received: Math.min(line.ordered, line.shipped, receivedByProduct.get(line.productId) ?? line.received),
  }));
  return {
    lines,
    shipmentStates: { ...(input.shipmentStates ?? {}), [input.shipmentId]: 'received' },
  };
}

export function applyPharmacyHandout(input: {
  lines: FulfilmentLine[];
  shipmentStates?: Record<string, string>;
  shipmentId?: string;
  partial: boolean;
}): { lines: FulfilmentLine[]; shipmentStates: Record<string, string>; remainingOpen: boolean; allowed: boolean } {
  const remainingOpen = input.lines.some(line => line.remaining > 0 || line.received < line.ordered);
  if (!input.partial && remainingOpen) {
    return {
      lines: input.lines,
      shipmentStates: { ...(input.shipmentStates ?? {}) },
      remainingOpen,
      allowed: false,
    };
  }
  const lines = input.lines.map(line => ({
    ...line,
    collected: Math.max(line.collected, line.received),
  }));
  const shipmentStates = { ...(input.shipmentStates ?? {}) };
  if (input.shipmentId) {
    shipmentStates[input.shipmentId] = 'collected';
  } else {
    for (const [shipmentId, state] of Object.entries(shipmentStates)) {
      if (state === 'received' || state === 'ready_for_collection' || state === 'partially_received') {
        shipmentStates[shipmentId] = 'collected';
      }
    }
  }
  return { lines, shipmentStates, remainingOpen, allowed: true };
}

export function normalisedFulfilmentLines(input: {
  purchaseOrder?: CuraleafPurchaseOrderLike | null;
  shipments?: CuraleafShipmentLike[];
  requestedItems?: Array<{ packId?: string; productId?: string; quantity?: number; qty?: number; count?: number }>;
  priorLines?: unknown;
}): FulfilmentLine[] {
  const purchaseOrder = input.purchaseOrder ?? {};
  const shipments = input.shipments ?? [];
  const requestedItems = input.requestedItems ?? [];
  const priorByProduct = new Map(
    mergePriorPharmacyLines(input.priorLines).map(line => [String(line.productId ?? ''), line]),
  );
  const requestedByProduct = new Map<string, number>();
  for (const item of requestedItems) {
    const productId = String(item.packId || item.productId || '');
    const quantity = count(item.quantity ?? item.qty ?? item.count);
    if (productId && quantity > 0) requestedByProduct.set(productId, quantity);
  }
  const supplierByProduct = new Map(
    (purchaseOrder.items ?? []).flatMap(raw => typeof raw.productId === 'string' && raw.productId
      ? [[raw.productId, raw] as const]
      : []),
  );
  const productIds = [...new Set([...requestedByProduct.keys(), ...supplierByProduct.keys()])];
  return productIds.flatMap((requestedProductId, index) => {
    const raw = supplierByProduct.get(requestedProductId) ?? {};
    const productId = typeof raw.productId === 'string' ? raw.productId : requestedProductId;
    if (!productId) return [];
    const supplierReportedOrdered = count(raw.packsOrderedCount ?? raw.count);
    const requested = count(requestedByProduct.get(productId));
    const ordered = requested || supplierReportedOrdered;
    const allocated = count(raw.packsAllocatedCount);
    const returnedByPo = count(raw.packsReturnedCount);
    const shipped = shipments.reduce((total, shipment) => total + (shipment.items ?? [])
      .filter(item => String(item.productId || '') === productId)
      .reduce((sum, item) => sum + count(item.packCount ?? item.count), 0), 0);
    const returnedByShipments = shipments.reduce((total, shipment) => total + (shipment.items ?? [])
      .filter(item => String(item.productId || '') === productId)
      .reduce((sum, item) => sum + count(item.packsReturnedCount), 0), 0);
    const existing = priorByProduct.get(productId);
    const returned = Math.max(returnedByPo, returnedByShipments);
    const remaining = Math.max(0, ordered - Math.max(0, shipped - returned));
    return [{
      lineId: String(existing?.lineId ?? createHash('sha256').update(`${purchaseOrder.id ?? 'po'}:${productId}:${index}`).digest('hex').slice(0, 32)),
      productId,
      ordered,
      requested,
      sent: ordered,
      supplierReportedOrdered,
      allocated,
      shipped,
      returned,
      remaining,
      received: count(existing?.received),
      collected: count(existing?.collected),
      backordered: shipments.length > 0 && remaining > 0,
      quantityMismatch: requested > 0 && supplierReportedOrdered > 0 && requested !== supplierReportedOrdered,
    }];
  });
}

export function dispatchStatusFromLines(shipments: CuraleafShipmentLike[], lines: Array<{ remaining: number }>): DispatchStatus {
  if (!shipments.length) return 'not_dispatched';
  if (lines.some(line => line.remaining > 0)) return 'partial';
  if (lines.length > 0 && lines.every(line => line.remaining === 0)) return 'complete';
  return 'not_dispatched';
}

export function supplierFulfilmentStatus(input: {
  purchaseOrder?: CuraleafPurchaseOrderLike | null;
  shipments?: CuraleafShipmentLike[];
  lines: Array<{ remaining: number; received: number; collected: number; ordered: number }>;
}): SupplierFulfilmentStatus {
  const purchaseOrder = input.purchaseOrder;
  const shipments = input.shipments ?? [];
  const lines = input.lines;
  if (purchaseOrder?.state === 'CANCELLED') return 'EXCEPTION';
  if (lines.length > 0 && lines.every(line => line.ordered > 0 && line.collected >= line.ordered)) return 'COLLECTED';
  if (lines.some(line => line.received > 0) && lines.some(line => line.received < line.ordered || line.remaining > 0)) {
    return 'PARTIALLY_RECEIVED';
  }
  if (lines.length > 0 && lines.every(line => line.ordered > 0 && line.received >= line.ordered)) return 'RECEIVED';
  if (shipments.length) return lines.some(line => line.remaining > 0) ? 'PARTIALLY_DISPATCHED_TO_PHARMACY' : 'DISPATCHED_TO_PHARMACY';
  if (purchaseOrder?.state === 'FULLY_ALLOCATED') return 'SUPPLIER_ALLOCATED';
  if (purchaseOrder) return 'SUPPLIER_PROCESSING';
  return 'SUPPLIER_PENDING';
}

export function advanceFulfilmentStatus(current: string | null | undefined, next: SupplierFulfilmentStatus): SupplierFulfilmentStatus {
  const currentRank = FULFILMENT_RANK[String(current || '').toUpperCase()] ?? -1;
  const nextRank = FULFILMENT_RANK[next] ?? 0;
  const goodsInRank = FULFILMENT_RANK.PARTIALLY_RECEIVED ?? 5;
  if (currentRank >= goodsInRank && nextRank < currentRank) {
    return String(current).toUpperCase() as SupplierFulfilmentStatus;
  }
  return nextRank >= currentRank ? next : (String(current).toUpperCase() as SupplierFulfilmentStatus);
}

export function latestShipmentCreatedAt(shipments: CuraleafShipmentLike[]) {
  return shipments
    .map(shipment => shipment.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

export function buildCuraleafSnapshot(input: {
  purchaseOrder?: CuraleafPurchaseOrderLike | null;
  shipments?: CuraleafShipmentLike[];
  lines: FulfilmentLine[];
  shipmentStates?: Record<string, string>;
  order: { id: string; orderNumber?: string | null };
}) {
  const purchaseOrder = input.purchaseOrder ?? null;
  const shipments = input.shipments ?? [];
  const dispatchStatus = dispatchStatusFromLines(shipments, input.lines);
  return {
    status: purchaseOrder?.state === 'CANCELLED' ? 'purchase_order_submitted' as const : 'purchase_order_submitted' as const,
    customerReference: purchaseOrder?.customerReference || input.order.orderNumber || input.order.id,
    purchaseOrderId: purchaseOrder?.id ?? null,
    purchaseOrderState: (purchaseOrder?.state as 'CREATED' | 'PROCESSING' | 'FULLY_ALLOCATED' | 'CANCELLED' | undefined) ?? null,
    courier: purchaseOrder?.courier || 'POLAR_SPEED',
    issuedDate: purchaseOrder?.issuedDate ?? null,
    createdAt: purchaseOrder?.createdAt ?? null,
    shipments,
    shipmentIds: shipments.map(shipment => String(shipment.id || '')).filter(Boolean),
    shipmentStates: input.shipmentStates ?? {},
    dispatchStatus,
    quantityMismatch: input.lines.some(line => line.quantityMismatch),
    supplierItems: (purchaseOrder?.items ?? []).map(item => ({
      productId: item.productId ?? null,
      packsOrderedCount: count(item.packsOrderedCount ?? item.count),
      packsAllocatedCount: count(item.packsAllocatedCount),
      packsReturnedCount: count(item.packsReturnedCount),
    })),
    items: purchaseOrder?.items ?? [],
    lines: input.lines,
  };
}
