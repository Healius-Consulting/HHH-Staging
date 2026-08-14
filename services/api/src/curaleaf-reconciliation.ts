import { createHash } from 'node:crypto';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  curaleafRequest,
  findCuraleafPurchaseOrder,
  findCuraleafShipments,
  registerManualPrescription,
  reconcileClinicPrescription,
  reconcileManualPrescription,
  type CuraleafPurchaseOrderRecord,
  type CuraleafShipmentRecord,
} from './curaleaf.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';
import { activatePatientForOrder } from './patient-finance.js';
import type { FulfilmentStatus } from './types.js';
import { loadUploadedPrescriptionFile } from './prescription-file.js';
import { recordPlacementLedgerEvent, satisfiesMarginFloor } from './placement-engine.js';

type OperationRecord = {
  organisationId?: unknown;
  orderId?: unknown;
  customerReference?: unknown;
  prescriptionSerialNumber?: unknown;
  items?: unknown;
  status?: unknown;
  result?: unknown;
  kind?: unknown;
  subOrderId?: unknown;
  prescriptionId?: unknown;
  prescriptionState?: unknown;
  prescriberId?: unknown;
  prescriberPin?: unknown;
  prescriptionItems?: unknown;
  autoPlacement?: unknown;
  manualPlacementRequested?: unknown;
};

type SavedPrescription = {
  fileId?: unknown;
  clinicScanId?: unknown;
  curaleafPrescriptionId?: unknown;
  serialNumber?: unknown;
  issueDate?: unknown;
  prescriber?: unknown;
  items?: unknown;
};

const placementQuoteSchema = z.object({
  shippingPrice: z.string(),
  taxRate: z.string(),
  items: z.array(z.object({ packId: z.string(), quantity: z.number().int().positive(), inStock: z.boolean(), wholesalePackPrice: z.string(), patientPackPrice: z.string() })).min(1),
});

function pricePence(value: unknown) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match || match[2]?.slice(2).match(/[1-9]/)) throw new Error('Curaleaf returned an invalid placement price.');
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0').slice(0, 2));
}

function normalisedPlacementQuote(quote: z.infer<typeof placementQuoteSchema>) {
  return {
    shippingPence: pricePence(quote.shippingPrice),
    taxRate: Number(quote.taxRate),
    items: [...quote.items].sort((left, right) => left.packId.localeCompare(right.packId)).map(item => ({ packId: item.packId, quantity: item.quantity, inStock: item.inStock, wholesalePence: pricePence(item.wholesalePackPrice), patientPence: pricePence(item.patientPackPrice) })),
  };
}

async function reconciliationQuoteGate(organisationId: string, orderId: string, order: Record<string, unknown>, items: Array<{ packId: string; quantity: number }>, prescriptionId?: string) {
  const raw = await curaleafRequest<unknown>(organisationId, '/v1/quotes/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  const latestResult = placementQuoteSchema.safeParse(raw);
  const baselineResult = placementQuoteSchema.safeParse(order.pricingQuote);
  if (!latestResult.success || !baselineResult.success) throw new Error('A valid original and final Curaleaf quote are required before purchase ordering.');
  const latest = normalisedPlacementQuote(latestResult.data);
  const baseline = normalisedPlacementQuote(baselineResult.data);
  const requested = new Map(items.map(item => [item.packId, item.quantity]));
  if (latest.items.length !== requested.size || latest.items.some(item => requested.get(item.packId) !== item.quantity)) throw new Error('Curaleaf’s final quote does not match the prescription order.');
  const baselineItems = new Map(baseline.items.map(item => [item.packId, item]));
  const differences: Array<{ category: 'stock' | 'patient_price' | 'supplier_cost'; field: string; packId?: string; previous: string | boolean; latest: string | boolean }> = [];
  for (const item of latest.items) {
    const prior = baselineItems.get(item.packId);
    if (!prior) continue;
    if (item.inStock !== prior.inStock) differences.push({ category: 'stock', field: 'inStock', packId: item.packId, previous: prior.inStock, latest: item.inStock });
    if (item.patientPence !== prior.patientPence) differences.push({ category: 'patient_price', field: 'patientPackPrice', packId: item.packId, previous: String(prior.patientPence), latest: String(item.patientPence) });
    if (item.wholesalePence !== prior.wholesalePence) differences.push({ category: 'supplier_cost', field: 'wholesalePackPrice', packId: item.packId, previous: String(prior.wholesalePence), latest: String(item.wholesalePence) });
  }
  if (latest.shippingPence !== baseline.shippingPence) differences.push({ category: 'supplier_cost', field: 'shippingPrice', previous: String(baseline.shippingPence), latest: String(latest.shippingPence) });
  if (latest.taxRate !== baseline.taxRate) differences.push({ category: 'supplier_cost', field: 'taxRate', previous: String(baseline.taxRate), latest: String(latest.taxRate) });
  const fingerprint = createHash('sha256').update(JSON.stringify(latest)).digest('hex');
  const review = order.quoteReview && typeof order.quoteReview === 'object' ? order.quoteReview as Record<string, unknown> : {};
  const outOfStock = latest.items.some(item => !item.inStock);
  const type = outOfStock ? 'out_of_stock' : differences.some(item => item.category === 'patient_price') ? 'patient_price_changed' : 'supplier_cost_changed';
  if (!outOfStock && type === 'supplier_cost_changed' && prescriptionId) {
    const placementSnapshot = await firestore.collection('prescriptionPlacements')
      .where('orderId', '==', orderId)
      .where('prescriptionId', '==', prescriptionId)
      .limit(1)
      .get();
    const placementDocument = placementSnapshot.docs[0];
    if (placementDocument) {
      const placement = placementDocument.data();
      const latestByPack = new Map(latest.items.map(item => [item.packId, item]));
      const ledgerEvents: Array<Parameters<typeof recordPlacementLedgerEvent>[0]> = [];
      let held = false;
      const updatedLines = (Array.isArray(placement.lines) ? placement.lines as Array<Record<string, unknown>> : []).map(line => {
        const latestLine = latestByPack.get(String(line.packId));
        if (!latestLine) return line;
        const previousWholesale = Number(line.linkSendWholesalePence ?? line.latestWholesalePence ?? 0);
        const latestWholesale = latestLine.wholesalePence * latestLine.quantity;
        if (latestWholesale <= previousWholesale) {
          ledgerEvents.push({ pharmacyId: organisationId, orderId, prescriptionId, lineId: String(line.id), eventType: 'margin_improved', actor: 'system', details: { decision: latestWholesale < previousWholesale ? 'lower_cost' : 'unchanged_cost', previousWholesalePence: previousWholesale, latestWholesalePence: latestWholesale } });
          return { ...line, latestWholesalePence: latestWholesale, placementState: 'PENDING_PLACEMENT', updatedAt: nowIso() };
        }
        const passes = satisfiesMarginFloor(Number(line.lineMedicineRevenuePence ?? line.fixedPatientPricePence ?? 0), Number(line.allocatedDispensingFeePence ?? 0), latestWholesale);
        if (!passes) held = true;
        ledgerEvents.push({ pharmacyId: organisationId, orderId, prescriptionId, lineId: String(line.id), eventType: passes ? 'margin_improved' : 'held_price', actor: 'system', details: { decision: passes ? 'higher_cost_margin_passed' : 'higher_cost_margin_failed', previousWholesalePence: previousWholesale, latestWholesalePence: latestWholesale, marginFloorPercent: 15 } });
        return { ...line, latestWholesalePence: latestWholesale, placementState: passes ? 'PENDING_PLACEMENT' : 'HELD_PRICE', holdEpisodeStartedAt: passes ? null : String(line.holdEpisodeStartedAt ?? nowIso()), updatedAt: nowIso() };
      });
      await Promise.all(ledgerEvents.map(event => recordPlacementLedgerEvent(event)));
      await placementDocument.ref.set({ lines: updatedLines, overallState: held ? 'HELD_PRICE' : 'PENDING_PLACEMENT', updatedAt: nowIso() }, { merge: true });
      if (held) {
        await firestore.collection('orders').doc(orderId).update({ [`prescriptionFlow.${prescriptionId}.state`]: 'HELD_PRICE', [`prescriptionFlow.${prescriptionId}.updatedAt`]: nowIso(), integrationStatus: 'quote_review_required', updatedAt: nowIso() });
        await ensureSupportCase(organisationId, orderId, 'supplier_exception', 'A supplier-cost increase fell below the configured 15% line margin floor.', prescriptionId);
        return false;
      }
      await firestore.collection('orders').doc(orderId).update({ [`prescriptionFlow.${prescriptionId}.state`]: 'PENDING_PLACEMENT', [`prescriptionFlow.${prescriptionId}.updatedAt`]: nowIso(), updatedAt: nowIso() });
      return true;
    }
  }
  const approved = differences.length === 0 && !outOfStock || type === 'supplier_cost_changed' && review.status === 'approved' && review.approvedFingerprint === fingerprint;
  if (approved) return true;
  const quoteReview = { status: type === 'patient_price_changed' ? 'recreate_required' : 'required', type, fingerprint, latestQuote: latestResult.data, differences, checkedAt: nowIso() };
  await firestore.collection('orders').doc(orderId).update({ quoteReview, integrationStatus: 'quote_review_required', updatedAt: nowIso() });
  await ensureSupportCase(organisationId, orderId, 'supplier_exception', type === 'out_of_stock' ? 'Curaleaf reports an out-of-stock pack.' : type === 'patient_price_changed' ? 'The Curaleaf patient price changed after payment; cancel/refund and recreate the order.' : 'Curaleaf supplier costs changed after payment and require approval.');
  return false;
}

function orderItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.packId === 'string' && Number.isInteger(record.quantity) && Number(record.quantity) > 0
      ? [{ packId: record.packId, quantity: Number(record.quantity) }]
      : [];
  });
}

function prescribedFormulaItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.formulaId === 'string' && Number.isInteger(record.unitsNeededCount) && Number(record.unitsNeededCount) > 0
      ? [{ formulaId: record.formulaId, unitsNeededCount: Number(record.unitsNeededCount) }]
      : [];
  });
}

function operationInput(operation: OperationRecord, order: Record<string, unknown>) {
  const prescriptions = Array.isArray(order.prescriptions) ? order.prescriptions as SavedPrescription[] : [];
  const fallbackPrescription = prescriptions.length === 1 ? prescriptions[0] : undefined;
  const serialNumber = typeof operation.prescriptionSerialNumber === 'string'
    ? operation.prescriptionSerialNumber
    : typeof fallbackPrescription?.serialNumber === 'string'
      ? fallbackPrescription.serialNumber
      : null;
  const items = orderItems(operation.items);
  const fallbackItems = orderItems(fallbackPrescription?.items);
  const prescriptionItems = prescribedFormulaItems(operation.prescriptionItems);
  const fallbackPrescriptionItems = prescribedFormulaItems(fallbackPrescription?.items);
  return {
    serialNumber,
    items: items.length ? items : fallbackItems,
    prescriptionItems: prescriptionItems.length ? prescriptionItems : fallbackPrescriptionItems,
    prescriberId: typeof operation.prescriberId === 'string'
      ? operation.prescriberId
      : prescriptions.length === 1 && fallbackPrescription && typeof fallbackPrescription.prescriber === 'object' && fallbackPrescription.prescriber
        ? String((fallbackPrescription.prescriber as Record<string, unknown>).id ?? '')
        : '',
    prescriberPin: typeof operation.prescriberPin === 'string'
      ? operation.prescriberPin
      : prescriptions.length === 1 && fallbackPrescription && typeof (fallbackPrescription as Record<string, unknown>).prescriber === 'object'
        ? String(((fallbackPrescription as Record<string, unknown>).prescriber as Record<string, unknown>).pin ?? '')
        : '',
  };
}

function fulfilmentStatus(
  purchaseOrder: CuraleafPurchaseOrderRecord,
  shipments: CuraleafShipmentRecord[],
  lines: Array<{ remaining: number }>,
): FulfilmentStatus {
  if (purchaseOrder.state === 'CANCELLED') return 'exception';
  if (shipments.length) return lines.some(line => line.remaining > 0) ? 'partially_dispatched_to_pharmacy' : 'dispatched_to_pharmacy';
  if (purchaseOrder.state === 'FULLY_ALLOCATED') return 'supplier_allocated';
  return 'supplier_processing';
}

function count(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalisedFulfilmentLines(
  purchaseOrder: CuraleafPurchaseOrderRecord,
  shipments: CuraleafShipmentRecord[],
  prior: unknown,
  requestedItems: Array<{ packId: string; quantity: number }> = [],
  sentItems: Array<{ productId: string; count: number }> | null = null,
) {
  const priorByProduct = new Map((Array.isArray(prior) ? prior as Array<Record<string, unknown>> : []).map(line => [String(line.productId ?? ''), line]));
  const requestedByProduct = new Map(requestedItems.map(item => [item.packId, item.quantity]));
  const sentByProduct = sentItems ? new Map(sentItems.map(item => [item.productId, item.count])) : null;
  const supplierByProduct = new Map(purchaseOrder.items.flatMap(raw => typeof raw.productId === 'string' ? [[raw.productId, raw] as const] : []));
  const productIds = [...new Set([...requestedByProduct.keys(), ...supplierByProduct.keys()])];
  return productIds.flatMap((requestedProductId, index) => {
    const raw = supplierByProduct.get(requestedProductId) ?? {};
    const productId = typeof raw.productId === 'string' ? raw.productId : requestedProductId;
    if (!productId) return [];
    const supplierReportedOrdered = count(raw.packsOrderedCount ?? raw.count);
    const requested = count(requestedByProduct.get(productId));
    const ordered = requested || supplierReportedOrdered;
    const sent = sentByProduct ? count(sentByProduct.get(productId)) : null;
    const allocated = count(raw.packsAllocatedCount);
    const returnedByPo = count(raw.packsReturnedCount);
    const shipped = shipments.reduce((total, shipment) => total + shipment.items
      .filter(item => item.productId === productId)
      .reduce((sum, item) => sum + count(item.packCount), 0), 0);
    const returnedByShipments = shipments.reduce((total, shipment) => total + shipment.items
      .filter(item => item.productId === productId)
      .reduce((sum, item) => sum + count(item.packsReturnedCount), 0), 0);
    const existing = priorByProduct.get(productId);
    const returned = Math.max(returnedByPo, returnedByShipments);
    const remaining = Math.max(0, ordered - Math.max(0, shipped - returned));
    return [{
      lineId: String(existing?.lineId ?? createHash('sha256').update(`${purchaseOrder.id}:${productId}:${index}`).digest('hex').slice(0, 32)),
      productId,
      ordered,
      requested,
      sent,
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

async function saveShipments(organisationId: string, shipments: CuraleafShipmentRecord[]) {
  const ids: string[] = [];
  for (const shipment of shipments) {
    const id = createHash('sha256').update(`${organisationId}:${shipment.id}`).digest('hex');
    const document = firestore.collection('shipments').doc(id);
    const existing = await document.get();
    await document.set({
      ...shipment,
      id,
      schemaVersion: 1,
      organisationId,
      supplierShipmentId: shipment.id,
      customerReference: shipment.purchaseOrderCustomerReference,
      supplierCreatedAt: shipment.createdAt,
      ...(existing.exists ? {} : { status: 'dispatched_to_pharmacy' satisfies FulfilmentStatus, createdAt: nowIso() }),
      updatedAt: nowIso(),
    }, { merge: true });
    ids.push(id);
  }
  if (ids.length) invalidateCollectionCache('shipments');
  return ids;
}

async function ensureSupportCase(organisationId: string, orderId: string, reason: 'prescription_exception' | 'supplier_exception', note: string, prescriptionId?: string, purchaseOrderId?: string) {
  const id = createHash('sha256').update(`${organisationId}:${orderId}:${reason}:${prescriptionId ?? ''}:${purchaseOrderId ?? ''}`).digest('hex');
  const document = firestore.collection('curaleafSupportCases').doc(id);
  if ((await document.get()).exists) return id;
  await document.create({
    id,
    schemaVersion: 1,
    organisationId,
    orderId,
    reason,
    status: 'open',
    note,
    prescriptionId: prescriptionId ?? null,
    purchaseOrderId: purchaseOrderId ?? null,
    openedBy: 'system',
    openedByRole: 'hhh_admin',
    openedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  invalidateCollectionCache('curaleafSupportCases', id);
  return id;
}

/**
 * Applies an authoritative Curaleaf cancellation discovered by event polling
 * or the hourly repair mirror. The supplier state is reflected in the portal,
 * while a paid order remains refund-required rather than silently refunded.
 */
export async function ingestCancelledCuraleafPurchaseOrder(
  organisationId: string,
  purchaseOrder: CuraleafPurchaseOrderRecord,
) {
  if (purchaseOrder.state !== 'CANCELLED') return { matchedOperations: 0, updatedOrders: 0 };
  const snapshots = await Promise.all([
    firestore.collection('integrationOperations').where('purchaseOrderId', '==', purchaseOrder.id).limit(100).get(),
    ...(typeof purchaseOrder.customerReference === 'string' && purchaseOrder.customerReference
      ? [firestore.collection('integrationOperations').where('customerReference', '==', purchaseOrder.customerReference).limit(100).get()]
      : []),
  ]);
  const operations = [...new Map(snapshots.flatMap(snapshot => snapshot.docs)
    .filter(document => document.data().organisationId === organisationId)
    .map(document => [document.id, document])).values()];
  const updatedOrderIds = new Set<string>();
  const supplierCancelledAt = nowIso();

  for (const operationDocument of operations) {
    const operation = operationDocument.data() as OperationRecord;
    if (typeof operation.orderId !== 'string') continue;
    const priorResult = operation.result && typeof operation.result === 'object' ? operation.result as Record<string, unknown> : {};
    const result = {
      ...priorResult,
      status: 'purchase_order_submitted',
      customerReference: purchaseOrder.customerReference ?? operation.customerReference ?? null,
      ...(typeof operation.prescriptionId === 'string' ? { prescriptionId: operation.prescriptionId } : {}),
      ...(typeof operation.prescriptionState === 'string' ? { prescriptionState: operation.prescriptionState } : {}),
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderState: 'CANCELLED',
      supplierStatusLabel: 'Cancelled purchase order',
    };
    await operationDocument.ref.set({
      status: 'failed',
      errorCode: 'PURCHASE_ORDER_CANCELLED',
      result,
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderState: 'CANCELLED',
      lastError: null,
      lastCheckedAt: supplierCancelledAt,
      updatedAt: supplierCancelledAt,
    }, { merge: true });

    const orderRef = firestore.collection('orders').doc(operation.orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists || orderSnapshot.data()?.organisationId !== organisationId) continue;
    const order = orderSnapshot.data()!;
    const paymentStatus = String(order.paymentStatus ?? '');
    const refundRequired = ['paid', 'refund_required'].includes(paymentStatus);
    const nextPaymentStatus = refundRequired ? 'refund_required' : paymentStatus === 'refunded' ? 'refunded' : 'cancelled';
    const existingCancellation = order.cancellation && typeof order.cancellation === 'object' ? order.cancellation as Record<string, unknown> : {};
    const existingCuraleafCancellation = order.curaleafCancellation && typeof order.curaleafCancellation === 'object' ? order.curaleafCancellation as Record<string, unknown> : {};
    const prescriptionId = typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined;
    const supportCaseId = await ensureSupportCase(
      organisationId,
      operation.orderId,
      'supplier_exception',
      'Curaleaf reported the purchase order as cancelled. Review the patient payment and complete any required refund.',
      prescriptionId,
      purchaseOrder.id,
    );
    const subOrderId = typeof operation.subOrderId === 'string' ? operation.subOrderId : null;
    const currentCuraleaf = order.curaleaf && typeof order.curaleaf === 'object' ? order.curaleaf as Record<string, unknown> : {};
    const ownsLegacyResult = currentCuraleaf.customerReference === result.customerReference || !currentCuraleaf.customerReference;
    const currentFlow = subOrderId && order.prescriptionFlow && typeof order.prescriptionFlow === 'object'
      ? (order.prescriptionFlow as Record<string, Record<string, unknown>>)[subOrderId] ?? {}
      : {};
    const curaleafSubOrders = order.curaleafSubOrders && typeof order.curaleafSubOrders === 'object'
      ? order.curaleafSubOrders as Record<string, unknown>
      : {};
    const prescriptionFlow = order.prescriptionFlow && typeof order.prescriptionFlow === 'object'
      ? order.prescriptionFlow as Record<string, unknown>
      : {};
    const nextCuraleafSubOrders = subOrderId ? { ...curaleafSubOrders, [subOrderId]: result } : curaleafSubOrders;
    const prescriptionKeys = Array.isArray(order.prescriptions)
      ? (order.prescriptions as Array<Record<string, unknown>>).flatMap(item => {
        const key = typeof item.id === 'string' ? item.id : typeof item.fileId === 'string' ? item.fileId : null;
        return key ? [key] : [];
      })
      : Object.keys(prescriptionFlow);
    const wholeOrderCancelled = prescriptionKeys.length <= 1 || prescriptionKeys.every(key => {
      const state = nextCuraleafSubOrders[key];
      return state && typeof state === 'object' && (state as Record<string, unknown>).purchaseOrderState === 'CANCELLED';
    });
    await orderRef.set({
      ...(ownsLegacyResult ? { curaleaf: result } : {}),
      ...(subOrderId ? { curaleafSubOrders: nextCuraleafSubOrders } : {}),
      ...(subOrderId ? {
        prescriptionFlow: {
          ...prescriptionFlow,
          [subOrderId]: {
            ...currentFlow,
            state: 'CANCELLED_PURCHASE_ORDER',
            purchaseOrderId: purchaseOrder.id,
            supplierCancelledAt,
            updatedAt: supplierCancelledAt,
          },
        },
      } : {}),
      ...(wholeOrderCancelled ? {
        status: 'cancelled',
        cancelledAt: String(order.cancelledAt ?? supplierCancelledAt),
        paymentStatus: nextPaymentStatus,
        fulfilmentStatus: 'exception' satisfies FulfilmentStatus,
      } : {}),
      integrationStatus: 'attention',
      ...(wholeOrderCancelled ? { cancellation: {
        reason: 'other',
        note: 'Curaleaf reported this purchase order as cancelled. Review the pharmacy’s Curaleaf call or case notes for the supplier reason.',
        requestedAt: supplierCancelledAt,
        requestedBy: 'system',
        paymentLinkStatus: 'not_applicable',
        paymentReference: order.worldpayPaymentId ?? order.paymentTransactionReference ?? order.paymentId ?? null,
        ...existingCancellation,
        status: refundRequired ? 'refund_required' : 'cancelled',
      } } : {}),
      ...(wholeOrderCancelled ? { curaleafCancellation: {
        requestedAt: supplierCancelledAt,
        requestedBy: 'system',
        ...existingCuraleafCancellation,
        status: 'confirmed',
        purchaseOrderId: purchaseOrder.id,
        prescriptionId: prescriptionId ?? existingCuraleafCancellation.prescriptionId ?? null,
        supportCaseId: existingCuraleafCancellation.supportCaseId ?? supportCaseId,
        confirmedAt: supplierCancelledAt,
        confirmedBy: 'system',
        confirmationReference: `Curaleaf state: CANCELLED (${purchaseOrder.id})`,
      } } : {}),
      updatedAt: supplierCancelledAt,
    }, { merge: true });

    if (subOrderId) {
      const placementSnapshot = await firestore.collection('prescriptionPlacements')
        .where('orderId', '==', operation.orderId)
        .where('prescriptionId', '==', subOrderId)
        .limit(1)
        .get();
      const placement = placementSnapshot.docs[0];
      if (placement) {
        const lines = (Array.isArray(placement.data().lines) ? placement.data().lines as Array<Record<string, unknown>> : [])
          .map(line => ({ ...line, placementState: 'CANCELLATION_PENDING_REFUND', supplierCancelledAt, updatedAt: supplierCancelledAt }));
        await placement.ref.set({ lines, overallState: 'CANCELLATION_PENDING_REFUND', supplierCancelledAt, updatedAt: supplierCancelledAt }, { merge: true });
      }
    }
    invalidateCollectionCache('orders', operation.orderId);
    updatedOrderIds.add(operation.orderId);
  }
  return { matchedOperations: operations.length, updatedOrders: updatedOrderIds.size };
}

async function reconcileOperation(document: QueryDocumentSnapshot) {
  const operation = document.data() as OperationRecord;
  if (typeof operation.organisationId !== 'string' || typeof operation.orderId !== 'string' || typeof operation.customerReference !== 'string') {
    await document.ref.update({ status: 'failed', errorCode: 'INVALID_OPERATION_RECORD', updatedAt: nowIso() });
    return 'failed';
  }
  const orderRef = firestore.collection('orders').doc(operation.orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) {
    await document.ref.update({ status: 'failed', errorCode: 'ORDER_NOT_FOUND', updatedAt: nowIso() });
    return 'failed';
  }
  const order = orderSnapshot.data()!;
  if (order.organisationId !== operation.organisationId) {
    await document.ref.update({ status: 'failed', errorCode: 'ORDER_NOT_ELIGIBLE', updatedAt: nowIso() });
    return 'failed';
  }
  if (order.paymentStatus !== 'paid') {
    if (operation.kind === 'manual') {
      await ensureManualOperationRegistered(document, operation, order);
      await document.ref.update({ status: 'awaiting_payment', errorCode: null, lastCheckedAt: nowIso(), updatedAt: nowIso() });
      return 'awaiting_payment';
    }
    await document.ref.update({ status: 'failed', errorCode: 'ORDER_NOT_ELIGIBLE', updatedAt: nowIso() });
    return 'failed';
  }
  if (operation.kind === 'manual') await ensureManualOperationRegistered(document, operation, order);
  const input = operationInput(operation, order);
  if (!input.serialNumber || !input.items.length) {
    await document.ref.update({ status: 'reconciliation_required', errorCode: 'PRESCRIPTION_METADATA_MISSING', updatedAt: nowIso() });
    return 'attention';
  }

  const clinicOperation = operation.kind === 'barcode';
  if (clinicOperation && ((!input.prescriberId && !input.prescriberPin) || !input.prescriptionItems.length)) {
    await document.ref.update({ status: 'reconciliation_required', errorCode: 'CLINIC_VERIFICATION_METADATA_MISSING', updatedAt: nowIso() });
    return 'attention';
  }
  let reconciliation = clinicOperation
      ? await reconcileClinicPrescription(operation.organisationId, {
        prescriptionId: typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined,
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        quoteItems: input.items,
        expectedPrescriberId: input.prescriberId || undefined,
        expectedPrescriberPin: input.prescriberPin,
        expectedItems: input.prescriptionItems,
        allowPurchaseOrderCreate: false,
      })
    : await reconcileManualPrescription(operation.organisationId, {
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        items: input.items,
        expectedPrescriberId: input.prescriberId || undefined,
        allowPurchaseOrderCreate: false,
      });
  if (reconciliation.status === 'prescription_processing') {
    await document.ref.update({ status: 'awaiting_clinic_prescription', lastError: null, lastCheckedAt: nowIso(), updatedAt: nowIso() });
    return 'pending';
  }
  if (reconciliation.status === 'prescription_mismatch') {
    await document.ref.update({
      status: 'failed',
      errorCode: reconciliation.reason,
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      lastError: null,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await orderRef.update({ fulfilmentStatus: 'exception' satisfies FulfilmentStatus, integrationStatus: 'attention', updatedAt: nowIso() });
    await ensureSupportCase(operation.organisationId, operation.orderId, 'prescription_exception', 'Curaleaf reported a prescription mismatch. Customer-service review is required; no decline reason has been assumed.', reconciliation.prescriptionId);
    invalidateCollectionCache('orders', operation.orderId);
    return 'failed';
  }
  if (reconciliation.status === 'prescription_pending') {
    await document.ref.update({
      status: clinicOperation ? 'awaiting_clinic_prescription' : 'awaiting_prescription_approval',
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      lastError: null,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    const pendingResult = {
      status: 'prescription_pending',
      customerReference: operation.customerReference,
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      ...('prescriberId' in reconciliation ? { prescriberId: reconciliation.prescriberId } : {}),
      ...('prescriberName' in reconciliation ? { prescriberName: reconciliation.prescriberName } : {}),
    };
    const subOrderKey = typeof operation.subOrderId === 'string' ? operation.subOrderId : null;
    await orderRef.update({
      curaleaf: pendingResult,
      ...(subOrderKey ? { [`curaleafSubOrders.${subOrderKey}`]: pendingResult } : {}),
      integrationStatus: clinicOperation ? 'awaiting_clinic_prescription' : 'awaiting_prescription_approval',
      fulfilmentStatus: 'supplier_pending' satisfies FulfilmentStatus,
      updatedAt: nowIso(),
    });
    invalidateCollectionCache('orders', operation.orderId);
    return 'pending';
  }
  if (reconciliation.status === 'prescription_closed') {
    await document.ref.update({
      status: 'failed',
      errorCode: `PRESCRIPTION_${reconciliation.prescriptionState}`,
      prescriptionState: reconciliation.prescriptionState,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await orderRef.update({
      fulfilmentStatus: 'exception' satisfies FulfilmentStatus,
      integrationStatus: 'attention',
      updatedAt: nowIso(),
    });
    await ensureSupportCase(operation.organisationId, operation.orderId, 'prescription_exception', `Curaleaf reported the prescription state ${reconciliation.prescriptionState}. Customer-service review is required; this does not assume the prescription was declined.`, reconciliation.prescriptionId);
    invalidateCollectionCache('orders', operation.orderId);
    return 'failed';
  }
  if (reconciliation.status === 'reconciliation_required') {
    await document.ref.update({
      status: 'reconciliation_required',
      errorCode: 'FULFILLED_PRESCRIPTION_WITHOUT_PURCHASE_ORDER',
      prescriptionState: reconciliation.prescriptionState,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return 'attention';
  }
  if (reconciliation.status === 'purchase_order_confirmation_pending') {
    const quoteApproved = await reconciliationQuoteGate(operation.organisationId, operation.orderId, order, input.items, typeof operation.subOrderId === 'string' ? operation.subOrderId : undefined);
    if (!quoteApproved) {
      await document.ref.update({ status: 'quote_review_required', errorCode: 'QUOTE_REVIEW_REQUIRED', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      invalidateCollectionCache('orders', operation.orderId);
      return 'attention';
    }
    if (operation.autoPlacement === false && operation.manualPlacementRequested !== true) {
      await document.ref.update({ status: 'manual_placement_required', errorCode: null, lastCheckedAt: nowIso(), updatedAt: nowIso() });
      if (typeof operation.subOrderId === 'string') await orderRef.update({ [`prescriptionFlow.${operation.subOrderId}.state`]: 'PENDING_PLACEMENT', [`prescriptionFlow.${operation.subOrderId}.manualPlaceRequired`]: true, updatedAt: nowIso() });
      return 'manual_placement_required';
    }
    reconciliation = clinicOperation
      ? await reconcileClinicPrescription(operation.organisationId, {
        prescriptionId: typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined,
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        quoteItems: input.items,
        expectedPrescriberId: input.prescriberId || undefined,
        expectedPrescriberPin: input.prescriberPin,
        expectedItems: input.prescriptionItems,
        allowPurchaseOrderCreate: true,
      })
      : await reconcileManualPrescription(operation.organisationId, {
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        items: input.items,
        expectedPrescriberId: input.prescriberId || undefined,
        allowPurchaseOrderCreate: true,
      });
    if (reconciliation.status === 'purchase_order_confirmation_pending') {
      await document.ref.update({ status: 'reconciliation_required', errorCode: 'PURCHASE_ORDER_CONFIRMATION_PENDING', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      return 'attention';
    }
  }

  const priorResult = operation.result && typeof operation.result === 'object' ? operation.result as Record<string, unknown> : {};
  const reconciliationPlacementRequest = 'placementRequest' in reconciliation
    && reconciliation.placementRequest
    && typeof reconciliation.placementRequest === 'object'
    ? reconciliation.placementRequest as Record<string, unknown>
    : null;
  const placementRequest = reconciliationPlacementRequest ?? (
    priorResult.placementRequest && typeof priorResult.placementRequest === 'object'
      ? priorResult.placementRequest as Record<string, unknown>
      : null
  );
  const purchaseOrder = reconciliation.purchaseOrderId
    ? await findCuraleafPurchaseOrder(operation.organisationId, operation.customerReference)
    : null;
  if (!purchaseOrder) {
    const submittedResult = {
      ...priorResult,
      status: 'purchase_order_submitted',
      customerReference: operation.customerReference,
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      ...('prescriberId' in reconciliation ? { prescriberId: reconciliation.prescriberId } : {}),
      ...('prescriberName' in reconciliation ? { prescriberName: reconciliation.prescriberName } : {}),
      purchaseOrderId: null,
      purchaseOrderState: null,
      requestedItems: input.items,
      placementRequest,
    };
    await document.ref.update({
      status: 'purchase_order_submitted',
      result: submittedResult,
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      lastError: null,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    const subOrderKey = typeof operation.subOrderId === 'string' ? operation.subOrderId : null;
    await orderRef.update({
      curaleaf: submittedResult,
      ...(subOrderKey ? { [`curaleafSubOrders.${subOrderKey}`]: submittedResult } : {}),
      integrationStatus: 'submitted',
      fulfilmentStatus: 'supplier_processing' satisfies FulfilmentStatus,
      updatedAt: nowIso(),
    });
    invalidateCollectionCache('orders', operation.orderId);
    await activatePatientForOrder(operation.orderId);
    return 'submitted';
  }

  const shipments = await findCuraleafShipments(operation.organisationId, purchaseOrder.id);
  const shipmentIds = await saveShipments(operation.organisationId, shipments);
  const subOrderKey = typeof operation.subOrderId === 'string' ? operation.subOrderId : null;
  const flow = order.prescriptionFlow && typeof order.prescriptionFlow === 'object' ? order.prescriptionFlow as Record<string, Record<string, unknown>> : {};
  const currentFlow = subOrderKey ? flow[subOrderKey] ?? {} : {};
  const sentItems = placementRequest && Array.isArray(placementRequest.items)
    ? (placementRequest.items as Array<Record<string, unknown>>).flatMap(item =>
      typeof item.productId === 'string' && Number.isInteger(item.count) && Number(item.count) > 0
        ? [{ productId: item.productId, count: Number(item.count) }]
        : [])
    : null;
  const lines = normalisedFulfilmentLines(purchaseOrder, shipments, currentFlow.lines, input.items, sentItems);
  const nextFulfilmentStatus = fulfilmentStatus(purchaseOrder, shipments, lines);
  const partialDispatch = shipments.length > 0 && lines.some(line => line.remaining > 0);
  const fullyDispatched = shipments.length > 0 && lines.length > 0 && lines.every(line => line.remaining === 0);
  const quantityMismatch = lines.some(line => line.quantityMismatch);
  const curaleafApprovedAt = purchaseOrder.state === 'CANCELLED'
    ? typeof order.curaleafApprovedAt === 'string' ? order.curaleafApprovedAt : undefined
    : typeof order.curaleafApprovedAt === 'string' ? order.curaleafApprovedAt : nowIso();
  const result = {
    ...priorResult,
    status: 'purchase_order_submitted',
    customerReference: operation.customerReference,
    prescriptionId: reconciliation.prescriptionId,
    prescriptionState: reconciliation.prescriptionState,
    ...('prescriberId' in reconciliation ? { prescriberId: reconciliation.prescriberId } : {}),
    ...('prescriberName' in reconciliation ? { prescriberName: reconciliation.prescriberName } : {}),
    purchaseOrderId: purchaseOrder.id,
    purchaseOrderState: purchaseOrder.state,
    courier: purchaseOrder.courier,
    shipmentIds,
    requestedItems: input.items,
    placementRequest,
    supplierItems: purchaseOrder.items.map(item => ({
      productId: item.productId ?? null,
      packsOrderedCount: count(item.packsOrderedCount ?? item.count),
      packsAllocatedCount: count(item.packsAllocatedCount),
      packsReturnedCount: count(item.packsReturnedCount),
    })),
    dispatchStatus: partialDispatch ? 'partial' : fullyDispatched ? 'complete' : 'not_dispatched',
    quantityMismatch,
  };
  const operationStatus = purchaseOrder.state === 'CANCELLED'
    ? 'failed'
    : fullyDispatched
      ? 'fully_dispatched'
      : partialDispatch
        ? 'partially_dispatched'
        : 'purchase_order_submitted';
  await document.ref.update({
    status: operationStatus,
    errorCode: purchaseOrder.state === 'CANCELLED' ? 'PURCHASE_ORDER_CANCELLED' : quantityMismatch ? 'SUPPLIER_QUANTITY_MISMATCH' : null,
    result,
    prescriptionId: reconciliation.prescriptionId,
    prescriptionState: reconciliation.prescriptionState,
    purchaseOrderId: purchaseOrder.id,
    purchaseOrderState: purchaseOrder.state,
    lastError: null,
    lastCheckedAt: nowIso(),
    updatedAt: nowIso(),
  });
  const currentCuraleaf = order.curaleaf && typeof order.curaleaf === 'object' ? order.curaleaf as Record<string, unknown> : {};
  const ownsLegacyResult = currentCuraleaf.customerReference === operation.customerReference || !currentCuraleaf.customerReference;
  await orderRef.update({
    ...(ownsLegacyResult ? { curaleaf: result } : {}),
    ...(subOrderKey ? { [`curaleafSubOrders.${subOrderKey}`]: result } : {}),
    ...(curaleafApprovedAt ? { curaleafApprovedAt } : {}),
    fulfilmentStatus: nextFulfilmentStatus,
    integrationStatus: purchaseOrder.state === 'CANCELLED' || quantityMismatch ? 'attention' : 'submitted',
    updatedAt: nowIso(),
  });
  if (subOrderKey) {
    const protectedFlowState = ['READY_FOR_COLLECTION', 'COLLECTED', 'HELD_FOR_RENEWAL'].includes(String(currentFlow.state));
    await orderRef.update({
      [`prescriptionFlow.${subOrderKey}`]: {
        ...currentFlow,
        id: subOrderKey,
        state: purchaseOrder.state === 'CANCELLED' ? 'HELD_STOCK' : protectedFlowState ? currentFlow.state : 'PLACED',
        purchaseOrderId: purchaseOrder.id,
        manualPlaceRequired: false,
        shipmentIds,
        lines,
        dispatchStatus: partialDispatch ? 'partial' : fullyDispatched ? 'complete' : 'not_dispatched',
        quantityMismatch,
        placedAt: String(currentFlow.placedAt ?? nowIso()),
        updatedAt: nowIso(),
      },
    });
    const placementSnapshot = await firestore.collection('prescriptionPlacements').where('orderId', '==', operation.orderId).where('prescriptionId', '==', subOrderKey).limit(1).get();
    const placement = placementSnapshot.docs[0];
    if (placement) {
      const nextLines = (Array.isArray(placement.data().lines) ? placement.data().lines as Array<Record<string, unknown>> : []).map(line => ({ ...line, placementState: purchaseOrder.state === 'CANCELLED' ? 'HELD_STOCK' : 'PLACED', updatedAt: nowIso() }));
      await placement.ref.set({ lines: nextLines, overallState: purchaseOrder.state === 'CANCELLED' ? 'HELD_STOCK' : 'PLACED', purchaseOrderId: purchaseOrder.id, placedAt: String(placement.data().placedAt ?? nowIso()), updatedAt: nowIso() }, { merge: true });
    }
  }
  if (purchaseOrder.state === 'CANCELLED') {
    await ingestCancelledCuraleafPurchaseOrder(operation.organisationId, purchaseOrder);
  } else if (quantityMismatch) {
    await ensureSupportCase(
      operation.organisationId,
      operation.orderId,
      'supplier_exception',
      'The HHH requested pack quantity differs from Curaleaf’s purchase-order quantity. Contact Curaleaf before further supply is dispatched.',
      reconciliation.prescriptionId,
      purchaseOrder.id,
    );
  }
  invalidateCollectionCache('orders', operation.orderId);
  if (purchaseOrder.state !== 'CANCELLED') await activatePatientForOrder(operation.orderId);
  return purchaseOrder.state === 'CANCELLED' ? 'cancelled' : fullyDispatched ? 'dispatched' : partialDispatch ? 'partially_dispatched' : 'processing';
}

function savedClinicPrescriptions(order: Record<string, unknown>) {
  if (!Array.isArray(order.prescriptions)) return [];
  return (order.prescriptions as SavedPrescription[]).flatMap(prescription => {
    if (
      typeof prescription.fileId !== 'string'
      || typeof prescription.clinicScanId !== 'string'
      || typeof prescription.curaleafPrescriptionId !== 'string'
      || typeof prescription.serialNumber !== 'string'
      || !prescription.prescriber
      || typeof prescription.prescriber !== 'object'
    ) return [];
    const prescriber = prescription.prescriber as Record<string, unknown>;
    const items = orderItems(prescription.items);
    const prescriptionItems = prescribedFormulaItems(prescription.items);
    if (!items.length || !prescriptionItems.length || typeof prescriber.id !== 'string') return [];
    return [{
      fileId: prescription.fileId,
      prescriptionId: prescription.curaleafPrescriptionId,
      serialNumber: prescription.serialNumber,
      prescriberId: prescriber.id,
      items,
      prescriptionItems,
    }];
  });
}

function savedManualPrescription(order: Record<string, unknown>, operation: OperationRecord) {
  if (!Array.isArray(order.prescriptions)) return null;
  const prescription = (order.prescriptions as SavedPrescription[]).find(candidate =>
    typeof candidate.serialNumber === 'string'
    && (candidate.serialNumber === operation.prescriptionSerialNumber || candidate.fileId === operation.subOrderId)
  );
  if (
    !prescription
    || typeof prescription.fileId !== 'string'
    || typeof prescription.serialNumber !== 'string'
    || typeof prescription.issueDate !== 'string'
    || prescription.clinicScanId
    || !prescription.prescriber
    || typeof prescription.prescriber !== 'object'
  ) return null;
  const prescriber = prescription.prescriber as Record<string, unknown>;
  const items = Array.isArray(prescription.items) ? prescription.items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const line = item as Record<string, unknown>;
    return typeof line.formulaId === 'string'
      && Number.isInteger(line.unitsNeededCount)
      && typeof line.packId === 'string'
      && Number.isInteger(line.quantity)
      ? [{ formulaId: line.formulaId, unitsNeededCount: Number(line.unitsNeededCount), packId: line.packId, quantity: Number(line.quantity) }]
      : [];
  }) : [];
  if (
    !items.length
    || typeof prescriber.pin !== 'string'
    || typeof prescriber.name !== 'string'
    || typeof prescriber.initials !== 'string'
  ) return null;
  return {
    fileId: prescription.fileId,
    serialNumber: prescription.serialNumber,
    issueDate: prescription.issueDate,
    prescriber: {
      pin: prescriber.pin,
      gmcNumber: typeof prescriber.gmcNumber === 'number' ? prescriber.gmcNumber : null,
      gphcNumber: typeof prescriber.gphcNumber === 'string' ? prescriber.gphcNumber : null,
      name: prescriber.name,
      initials: prescriber.initials,
    },
    items,
  };
}

async function ensureManualOperationRegistered(document: QueryDocumentSnapshot, operation: OperationRecord, order: Record<string, unknown>) {
  if (typeof operation.prescriptionId === 'string' && typeof operation.prescriberId === 'string') {
    return {
      prescriptionId: operation.prescriptionId,
      prescriptionState: typeof operation.prescriptionState === 'string'
        ? operation.prescriptionState
        : 'PENDING',
      prescriberId: operation.prescriberId,
    };
  }
  const prescription = savedManualPrescription(order, operation);
  if (!prescription || typeof operation.organisationId !== 'string') {
    await document.ref.update({ status: 'reconciliation_required', errorCode: 'MANUAL_PRESCRIPTION_METADATA_MISSING', updatedAt: nowIso() });
    throw new Error('The saved manual prescription is incomplete.');
  }
  const file = await loadUploadedPrescriptionFile(operation.organisationId, prescription.fileId);
  const registered = await registerManualPrescription(operation.organisationId, { ...prescription, file });
  const directoryMatches = await firestore.collection('prescriberDirectory').where('pin', '==', prescription.prescriber.pin).limit(1).get();
  const directoryDocument = directoryMatches.docs[0];
  if (directoryDocument) {
    const existingIds = directoryDocument.data().curaleafIds && typeof directoryDocument.data().curaleafIds === 'object'
      ? directoryDocument.data().curaleafIds as Record<string, string>
      : {};
    await directoryDocument.ref.set({ curaleafIds: { ...existingIds, [operation.organisationId]: registered.prescriberId }, updatedAt: nowIso() }, { merge: true });
  }
  await document.ref.update({
    prescriptionId: registered.prescriptionId,
    prescriptionState: registered.prescriptionState,
    prescriberId: registered.prescriberId,
    formulaMatchMode: registered.formulaMatchMode,
    formulaAliases: registered.formulaAliases,
    status: order.paymentStatus === 'paid' ? 'awaiting_prescription_approval' : 'awaiting_payment',
    errorCode: null,
    lastError: null,
    lastCheckedAt: nowIso(),
    updatedAt: nowIso(),
  });
  return registered;
}

async function seedManualOrderOperations(orderDocument: QueryDocumentSnapshot | DocumentSnapshot) {
  if (!orderDocument.exists) return 0;
  const order = orderDocument.data() as Record<string, unknown>;
  const organisationId = typeof order.organisationId === 'string' ? order.organisationId : '';
  if (!organisationId || order.status === 'cancelled' || order.cancellation || !Array.isArray(order.prescriptions)) return 0;
  const existing = await firestore.collection('integrationOperations').where('orderId', '==', orderDocument.id).get();
  const existingSerials = new Set(existing.docs
    .filter(document => document.data().organisationId === organisationId)
    .map(document => String(document.data().prescriptionSerialNumber ?? '')));
  let created = 0;
  for (const prescription of order.prescriptions as SavedPrescription[]) {
    if (
      prescription.clinicScanId
      || typeof prescription.fileId !== 'string'
      || typeof prescription.serialNumber !== 'string'
      || existingSerials.has(prescription.serialNumber)
    ) continue;
    const items = orderItems(prescription.items);
    if (!items.length) continue;
    const id = createHash('sha256').update(`${organisationId}:${orderDocument.id}:${prescription.fileId}:curaleaf`).digest('hex');
    const referenceHash = createHash('sha256').update(prescription.fileId).digest('hex').slice(0, 10);
    const operation = firestore.collection('integrationOperations').doc(id);
    try {
      await operation.create({
        id,
        schemaVersion: 1,
        organisationId,
        orderId: orderDocument.id,
        subOrderId: prescription.fileId,
        integration: 'curaleaf',
        kind: 'manual',
        autoPlacement: order.autoPlacementEnabled !== false,
        trigger: 'manual_prescription_saved',
        customerReference: `HHH-${orderDocument.id.slice(0, 72)}-${referenceHash}`,
        status: 'registering_prescription',
        prescriptionSerialNumber: prescription.serialNumber,
        items,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created += 1;
      existingSerials.add(prescription.serialNumber);
    } catch (error) {
      if ((error as { code?: number | string }).code !== 6 && (error as { code?: number | string }).code !== 'already-exists') throw error;
    }
  }
  return created;
}

async function seedPaidClinicOrder(orderDocument: QueryDocumentSnapshot | DocumentSnapshot) {
  if (!orderDocument.exists) return 0;
  const order = orderDocument.data() as Record<string, unknown>;
  const organisationId = typeof order.organisationId === 'string' ? order.organisationId : '';
  if (!organisationId || order.paymentStatus !== 'paid' || order.status === 'cancelled' || order.cancellation) return 0;
  const prescriptions = savedClinicPrescriptions(order);
  if (!prescriptions.length) return 0;
  const existing = await firestore.collection('integrationOperations').where('orderId', '==', orderDocument.id).get();
  const existingSerials = new Set(existing.docs
    .filter(document => document.data().organisationId === organisationId)
    .map(document => String(document.data().prescriptionSerialNumber ?? '')));
  let created = 0;
  for (const prescription of prescriptions) {
    if (existingSerials.has(prescription.serialNumber)) continue;
    const id = createHash('sha256').update(`${organisationId}:${orderDocument.id}:${prescription.fileId}:curaleaf`).digest('hex');
    const referenceHash = createHash('sha256').update(prescription.fileId).digest('hex').slice(0, 10);
    const customerReference = `HHH-${orderDocument.id.slice(0, 72)}-${referenceHash}`;
    const operation = firestore.collection('integrationOperations').doc(id);
    try {
      await operation.create({
        id,
        schemaVersion: 1,
        organisationId,
        orderId: orderDocument.id,
        subOrderId: prescription.fileId,
        integration: 'curaleaf',
        kind: 'barcode',
        autoPlacement: order.autoPlacementEnabled !== false,
        trigger: 'payment_confirmed',
        customerReference,
        status: 'awaiting_clinic_prescription',
        prescriptionId: prescription.prescriptionId,
        prescriptionSerialNumber: prescription.serialNumber,
        prescriberId: prescription.prescriberId,
        prescriptionItems: prescription.prescriptionItems,
        items: prescription.items,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created += 1;
      existingSerials.add(prescription.serialNumber);
    } catch (error) {
      if ((error as { code?: number | string }).code !== 6 && (error as { code?: number | string }).code !== 'already-exists') throw error;
    }
  }
  return created;
}

/**
 * Starts and immediately evaluates every paid Curaleaf prescription on
 * an order. The deterministic operation record makes webhook, staff-payment,
 * and scheduled retries safe to run more than once.
 */
export async function prepareManualPrescriptionsForOrder(organisationId: string, orderId: string) {
  const orderDocument = await firestore.collection('orders').doc(orderId).get();
  if (!orderDocument.exists || orderDocument.data()?.organisationId !== organisationId) return { seeded: 0, checked: 0 };
  const seeded = await seedManualOrderOperations(orderDocument);
  const order = orderDocument.data()!;
  const operations = await firestore.collection('integrationOperations').where('orderId', '==', orderId).get();
  const candidates = operations.docs.filter(document => {
    const data = document.data();
    return data.organisationId === organisationId
      && data.integration === 'curaleaf'
      && data.kind === 'manual'
      && ['registering_prescription', 'awaiting_payment', 'reconciliation_required'].includes(String(data.status));
  });
  const summary: Record<string, number> = { seeded, checked: candidates.length };
  for (const document of candidates) {
    try {
      await ensureManualOperationRegistered(document, document.data() as OperationRecord, order);
      summary.registered = (summary.registered ?? 0) + 1;
    } catch (error) {
      await document.ref.update({ lastError: error instanceof Error ? error.message : 'Unknown manual prescription registration error', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      summary.error = (summary.error ?? 0) + 1;
    }
  }
  return summary;
}

export async function autoSubmitPaidPrescriptions(organisationId: string, orderId: string) {
  const orderDocument = await firestore.collection('orders').doc(orderId).get();
  if (!orderDocument.exists || orderDocument.data()?.organisationId !== organisationId) return { seeded: 0, checked: 0 };
  const seeded = await seedPaidClinicOrder(orderDocument) + await seedManualOrderOperations(orderDocument);
  const operations = await firestore.collection('integrationOperations').where('orderId', '==', orderId).get();
  const candidates = operations.docs.filter(document => {
    const data = document.data();
    return data.organisationId === organisationId
      && data.integration === 'curaleaf'
      && ['manual', 'barcode'].includes(String(data.kind))
      && ['registering_prescription', 'awaiting_payment', 'awaiting_prescription_approval', 'awaiting_clinic_prescription', 'purchase_order_submitted', 'shipment_created', 'partially_dispatched', 'reconciliation_required', 'manual_placement_required'].includes(String(data.status));
  });
  const summary: Record<string, number> = { seeded, checked: candidates.length };
  for (const document of candidates) {
    try {
      const result = await reconcileOperation(document);
      summary[result] = (summary[result] ?? 0) + 1;
    } catch (error) {
      await document.ref.update({ lastError: error instanceof Error ? error.message : 'Unknown automatic placement error', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      summary.error = (summary.error ?? 0) + 1;
    }
  }
  return summary;
}

export async function reconcilePendingCuraleafOrders(organisationId?: string) {
  const paidOrders = await firestore.collection('orders').where('paymentStatus', '==', 'paid').limit(500).get();
  let seeded = 0;
  for (const order of paidOrders.docs) {
    if (organisationId && order.data().organisationId !== organisationId) continue;
    seeded += await seedPaidClinicOrder(order) + await seedManualOrderOperations(order);
  }
  const statuses = ['registering_prescription', 'awaiting_prescription_approval', 'awaiting_clinic_prescription', 'purchase_order_submitted', 'shipment_created', 'partially_dispatched', 'reconciliation_required'];
  const snapshots = organisationId
    ? [await firestore.collection('integrationOperations').where('organisationId', '==', organisationId).limit(500).get()]
    : await Promise.all(statuses.map(status => firestore.collection('integrationOperations').where('status', '==', status).limit(100).get()));
  const documents = [...new Map(snapshots.flatMap(snapshot => snapshot.docs)
    .filter(document => statuses.includes(String(document.data().status)))
    .filter(document => document.data().integration === 'curaleaf' && ['manual', 'barcode'].includes(document.data().kind))
    .map(document => [document.id, document])).values()];
  const summary: Record<string, number> = { seeded };
  for (const document of documents) {
    try {
      const result = await reconcileOperation(document);
      summary[result] = (summary[result] ?? 0) + 1;
    } catch (error) {
      await document.ref.update({
        lastError: error instanceof Error ? error.message : 'Unknown reconciliation error',
        lastCheckedAt: nowIso(),
        updatedAt: nowIso(),
      });
      summary.error = (summary.error ?? 0) + 1;
    }
  }
  return { checked: documents.length, ...summary };
}
