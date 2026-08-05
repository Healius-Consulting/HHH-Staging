import { createHash } from 'node:crypto';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  curaleafRequest,
  findCuraleafPurchaseOrder,
  findCuraleafShipments,
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

type OperationRecord = {
  organisationId?: unknown;
  orderId?: unknown;
  customerReference?: unknown;
  prescriptionSerialNumber?: unknown;
  items?: unknown;
  status?: unknown;
  result?: unknown;
  kind?: unknown;
  prescriptionId?: unknown;
  prescriberPin?: unknown;
  prescriptionItems?: unknown;
};

type SavedPrescription = {
  serialNumber?: unknown;
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

async function reconciliationQuoteGate(organisationId: string, orderId: string, order: Record<string, unknown>, items: Array<{ packId: string; quantity: number }>) {
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
    prescriberPin: typeof operation.prescriberPin === 'string'
      ? operation.prescriberPin
      : prescriptions.length === 1 && fallbackPrescription && typeof (fallbackPrescription as Record<string, unknown>).prescriber === 'object'
        ? String(((fallbackPrescription as Record<string, unknown>).prescriber as Record<string, unknown>).pin ?? '')
        : '',
  };
}

function fulfilmentStatus(purchaseOrder: CuraleafPurchaseOrderRecord, shipments: CuraleafShipmentRecord[]): FulfilmentStatus {
  if (shipments.length) return 'dispatched_to_pharmacy';
  if (purchaseOrder.state === 'FULLY_ALLOCATED') return 'supplier_allocated';
  if (purchaseOrder.state === 'CANCELLED') return 'exception';
  return 'supplier_processing';
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
  if ((await document.get()).exists) return;
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
  if (order.organisationId !== operation.organisationId || order.paymentStatus !== 'paid') {
    await document.ref.update({ status: 'failed', errorCode: 'ORDER_NOT_ELIGIBLE', updatedAt: nowIso() });
    return 'failed';
  }
  const input = operationInput(operation, order);
  if (!input.serialNumber || !input.items.length) {
    await document.ref.update({ status: 'reconciliation_required', errorCode: 'PRESCRIPTION_METADATA_MISSING', updatedAt: nowIso() });
    return 'attention';
  }

  const clinicOperation = operation.kind === 'barcode';
  if (clinicOperation && (!input.prescriberPin || !input.prescriptionItems.length)) {
    await document.ref.update({ status: 'reconciliation_required', errorCode: 'CLINIC_VERIFICATION_METADATA_MISSING', updatedAt: nowIso() });
    return 'attention';
  }
  let reconciliation = clinicOperation
      ? await reconcileClinicPrescription(operation.organisationId, {
        prescriptionId: typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined,
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        quoteItems: input.items,
        expectedPrescriberPin: input.prescriberPin,
        expectedItems: input.prescriptionItems,
        allowPurchaseOrderCreate: false,
      })
    : await reconcileManualPrescription(operation.organisationId, {
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        items: input.items,
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
    const quoteApproved = await reconciliationQuoteGate(operation.organisationId, operation.orderId, order, input.items);
    if (!quoteApproved) {
      await document.ref.update({ status: 'quote_review_required', errorCode: 'QUOTE_REVIEW_REQUIRED', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      invalidateCollectionCache('orders', operation.orderId);
      return 'attention';
    }
    reconciliation = clinicOperation
      ? await reconcileClinicPrescription(operation.organisationId, {
        prescriptionId: typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined,
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        quoteItems: input.items,
        expectedPrescriberPin: input.prescriberPin,
        expectedItems: input.prescriptionItems,
        allowPurchaseOrderCreate: true,
      })
      : await reconcileManualPrescription(operation.organisationId, {
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        items: input.items,
        allowPurchaseOrderCreate: true,
      });
    if (reconciliation.status === 'purchase_order_confirmation_pending') {
      await document.ref.update({ status: 'reconciliation_required', errorCode: 'PURCHASE_ORDER_CONFIRMATION_PENDING', lastCheckedAt: nowIso(), updatedAt: nowIso() });
      return 'attention';
    }
  }

  const purchaseOrder = reconciliation.purchaseOrderId
    ? await findCuraleafPurchaseOrder(operation.organisationId, operation.customerReference)
    : null;
  if (!purchaseOrder) {
    await document.ref.update({
      status: 'purchase_order_submitted',
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      lastError: null,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await activatePatientForOrder(operation.orderId);
    return 'submitted';
  }

  const shipments = await findCuraleafShipments(operation.organisationId, purchaseOrder.id);
  const shipmentIds = await saveShipments(operation.organisationId, shipments);
  const nextFulfilmentStatus = fulfilmentStatus(purchaseOrder, shipments);
  const priorResult = operation.result && typeof operation.result === 'object' ? operation.result as Record<string, unknown> : {};
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
  };
  await document.ref.update({
    status: shipments.length ? 'shipment_created' : purchaseOrder.state === 'CANCELLED' ? 'failed' : 'purchase_order_submitted',
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
    fulfilmentStatus: nextFulfilmentStatus,
    integrationStatus: purchaseOrder.state === 'CANCELLED' ? 'attention' : 'submitted',
    updatedAt: nowIso(),
  });
  if (purchaseOrder.state === 'CANCELLED') {
    await ensureSupportCase(operation.organisationId, operation.orderId, 'supplier_exception', 'Curaleaf confirmed that the purchase order is cancelled. Review the patient payment and next action.', reconciliation.prescriptionId, purchaseOrder.id);
  }
  invalidateCollectionCache('orders', operation.orderId);
  if (purchaseOrder.state !== 'CANCELLED') await activatePatientForOrder(operation.orderId);
  return shipments.length ? 'dispatched' : 'processing';
}

export async function reconcilePendingCuraleafOrders(organisationId?: string) {
  const statuses = ['awaiting_prescription_approval', 'awaiting_clinic_prescription', 'purchase_order_submitted', 'reconciliation_required'];
  const snapshots = organisationId
    ? [await firestore.collection('integrationOperations').where('organisationId', '==', organisationId).limit(500).get()]
    : await Promise.all(statuses.map(status => firestore.collection('integrationOperations').where('status', '==', status).limit(100).get()));
  const documents = [...new Map(snapshots.flatMap(snapshot => snapshot.docs)
    .filter(document => statuses.includes(String(document.data().status)))
    .filter(document => document.data().integration === 'curaleaf' && ['manual', 'barcode'].includes(document.data().kind))
    .map(document => [document.id, document])).values()];
  const summary: Record<string, number> = {};
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
