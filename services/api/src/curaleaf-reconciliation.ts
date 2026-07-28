import { createHash } from 'node:crypto';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
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
  const reconciliation = clinicOperation
      ? await reconcileClinicPrescription(operation.organisationId, {
        prescriptionId: typeof operation.prescriptionId === 'string' ? operation.prescriptionId : undefined,
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        quoteItems: input.items,
        expectedPrescriberPin: input.prescriberPin,
        expectedItems: input.prescriptionItems,
        allowPurchaseOrderCreate: operation.status === 'awaiting_clinic_prescription',
      })
    : await reconcileManualPrescription(operation.organisationId, {
        serialNumber: input.serialNumber,
        customerReference: operation.customerReference,
        items: input.items,
        allowPurchaseOrderCreate: operation.status === 'awaiting_prescription_approval',
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
    await document.ref.update({
      status: operation.status === 'reconciliation_required' ? 'reconciliation_required' : 'purchase_order_submitted',
      prescriptionId: reconciliation.prescriptionId,
      prescriptionState: reconciliation.prescriptionState,
      lastError: null,
      lastCheckedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return 'submitted';
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
  invalidateCollectionCache('orders', operation.orderId);
  return shipments.length ? 'dispatched' : 'processing';
}

export async function reconcilePendingCuraleafOrders() {
  const statuses = ['awaiting_prescription_approval', 'awaiting_clinic_prescription', 'purchase_order_submitted', 'reconciliation_required'];
  const snapshots = await Promise.all(statuses.map(status =>
    firestore.collection('integrationOperations').where('status', '==', status).limit(100).get()
  ));
  const documents = [...new Map(snapshots
    .flatMap(snapshot => snapshot.docs)
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
