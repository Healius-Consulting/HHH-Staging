import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlPrescriptionRepository } from '../../repositories/sql/prescription.sql.js';
import { prescriptionFileIdsFromSnapshot } from './prescription-file-purge.js';

const UUID_LIKE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function plusDays(isoDate: string, days: number) {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export type CuraleafPrescriptionState = 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';

export function asCuraleafPrescriptionState(value: unknown): CuraleafPrescriptionState | null {
  const state = String(value || '').trim().toUpperCase();
  if (state === 'ACTIVE' || state === 'FULFILLED' || state === 'EXPIRED' || state === 'CANCELLED' || state === 'PENDING') {
    return state;
  }
  return null;
}

export function stampCuraleafPrescriptionOnSnapshot(
  snapshot: unknown,
  input: {
    prescriptionId?: string | null;
    prescriberId?: string | null;
    prescriptionState?: string | null;
    purchaseOrder?: Record<string, unknown> | null;
  },
) {
  const root = asRecord(snapshot);
  const prior = asRecord(root.curaleaf);
  const prescriptionId = input.prescriptionId || (typeof prior.prescriptionId === 'string' ? prior.prescriptionId : null);
  const prescriberId = input.prescriberId || (typeof prior.prescriberId === 'string' ? prior.prescriberId : null);
  const purchaseOrder = input.purchaseOrder && typeof input.purchaseOrder === 'object' ? input.purchaseOrder : null;
  const hasPurchaseOrder = Boolean(purchaseOrder?.id || purchaseOrder?.purchaseOrderId);
  const prescriptionState = asCuraleafPrescriptionState(input.prescriptionState)
    ?? asCuraleafPrescriptionState(prior.prescriptionState)
    ?? (hasPurchaseOrder ? 'ACTIVE' : prescriptionId ? 'PENDING' : null);
  const status = hasPurchaseOrder
    ? 'purchase_order_submitted'
    : prescriptionState === 'EXPIRED' || prescriptionState === 'CANCELLED'
      ? 'prescription_closed'
      : prescriptionId || prescriberId
        ? 'prescription_pending'
        : prior.status ?? null;
  const prescriptions = Array.isArray(root.prescriptions)
    ? root.prescriptions.map((entry) => {
      const rx = asRecord(entry);
      return prescriptionId ? { ...rx, curaleafPrescriptionId: prescriptionId } : rx;
    })
    : root.prescriptions;

  return {
    ...root,
    prescriptions,
    curaleaf: {
      ...prior,
      ...(purchaseOrder ?? {}),
      status,
      prescriptionId,
      prescriberId,
      prescriptionState,
      purchaseOrderId: purchaseOrder?.id ?? prior.purchaseOrderId ?? null,
      purchaseOrderState: purchaseOrder?.state ?? prior.purchaseOrderState ?? null,
      customerReference: purchaseOrder?.customerReference ?? prior.customerReference ?? null,
    },
  };
}

export async function persistCuraleafPrescriptionIdentity(input: {
  organisationId: string;
  orderId: string;
  patientId?: string | null;
  snapshot: unknown;
  prescriptionId?: string | null;
  prescriberId?: string | null;
  prescriptionState?: string | null;
  purchaseOrder?: Record<string, unknown> | null;
  fulfilmentStatus?: 'SUPPLIER_PENDING' | 'SUPPLIER_PROCESSING' | 'SUPPLIER_ALLOCATED' | 'PARTIALLY_DISPATCHED_TO_PHARMACY' | 'DISPATCHED_TO_PHARMACY' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'READY_FOR_COLLECTION' | 'COLLECTED' | 'EXCEPTION';
}) {
  if (!input.prescriptionId && !input.purchaseOrder && !input.prescriberId) return input.snapshot;

  const snapshot = stampCuraleafPrescriptionOnSnapshot(input.snapshot, input);
  const orderRepo = new SqlOrderRepository();
  await orderRepo.updateQuoteSnapshot({
    id: input.orderId,
    organisationId: input.organisationId,
    quoteSnapshot: snapshot,
    fulfilmentStatus: input.fulfilmentStatus,
  });

  if (!input.prescriptionId || !input.patientId) return snapshot;

  const root = asRecord(snapshot);
  const prescriptions = Array.isArray(root.prescriptions) ? root.prescriptions.map(asRecord) : [];
  const rx = prescriptions[0] ?? {};
  const serialNumber = typeof rx.serialNumber === 'string' && rx.serialNumber.trim()
    ? rx.serialNumber.trim()
    : `RX-${input.orderId.replace(/-/g, '').slice(0, 8)}`;
  const issueDate = typeof rx.issueDate === 'string' && rx.issueDate
    ? rx.issueDate.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const expiryDate = typeof rx.expiryDate === 'string' && rx.expiryDate
    ? rx.expiryDate.slice(0, 10)
    : plusDays(issueDate, 28);
  const patient = asRecord(rx.patient);
  const patientName = typeof patient.name === 'string' && patient.name.trim() ? patient.name.trim() : 'Unknown patient';
  const patientDob = typeof patient.dob === 'string' && patient.dob ? patient.dob.slice(0, 10) : '1900-01-01';
  const fileIds = prescriptionFileIdsFromSnapshot(snapshot);
  const fileId = fileIds[0] && UUID_LIKE.test(fileIds[0]) ? fileIds[0] : null;
  const placed = Boolean(input.purchaseOrder && (input.purchaseOrder.id || input.purchaseOrder.purchaseOrderId));

  try {
    const prescriptionRepo = new SqlPrescriptionRepository();
    await prescriptionRepo.recordSupplierPrescription({
      organisationId: input.organisationId,
      orderId: input.orderId,
      patientId: input.patientId,
      fileId,
      supplierPrescriptionId: input.prescriptionId,
      serialNumber,
      issueDate,
      expiryDate,
      status: placed ? 'PLACED' : 'PENDING_PLACEMENT',
      patientNameSnapshot: patientName,
      patientDobSnapshot: patientDob,
      prescriberSnapshot: rx.prescriber ?? {},
      supplierPurchaseOrderId: typeof input.purchaseOrder?.id === 'string'
        ? input.purchaseOrder.id
        : typeof input.purchaseOrder?.purchaseOrderId === 'string'
          ? input.purchaseOrder.purchaseOrderId
          : null,
      placementState: placed ? 'PLACED' : 'PENDING_PLACEMENT',
    });
  } catch (error) {
    console.warn('[Prescription] Failed to persist Curaleaf prescription ID to SQL:', error);
  }

  return snapshot;
}
