import { createHash } from 'node:crypto';
import { FLOW_CONFIG } from './flow-config.js';
import { calculatePrescriptionExpiry } from './placement-engine.js';

export type PatientMessageKind =
  | 'patient_payment_request'
  | 'patient_payment_confirmation'
  | 'patient_ready_for_collection'
  | 'patient_fulfilment_delay';

export type PrescriptionFlowState =
  | 'DRAFT'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PENDING_PLACEMENT'
  | 'HELD_PRICE'
  | 'HELD_STOCK'
  | 'PLACED'
  | 'HELD_FOR_RENEWAL'
  | 'READY_FOR_COLLECTION'
  | 'COLLECTED'
  | 'EXPIRED'
  | 'CANCELLED_REFUNDED';

export function deterministicSubOrderId(orderId: string, seed: string, index: number) {
  return createHash('sha256').update(`${orderId}:${seed}:${index}`).digest('hex').slice(0, 32);
}

export function prescriptionExpiryAt(value: { issueDate?: unknown; expiryDate?: unknown }) {
  if (typeof value.issueDate !== 'string') return null;
  const expiry = calculatePrescriptionExpiry(
    value.issueDate,
    typeof value.expiryDate === 'string' ? value.expiryDate : undefined,
  );
  const timestamp = Date.parse(`${expiry}T23:59:59.999Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function prescriptionIsCurrent(value: { issueDate?: unknown; expiryDate?: unknown }, now = new Date()) {
  const expiry = prescriptionExpiryAt(value);
  return expiry !== null && expiry >= now.getTime();
}

export function paymentLinkExpiryAt(
  prescriptions: Array<{ issueDate?: unknown; expiryDate?: unknown; payable?: unknown; cancelled?: unknown }>,
  sentAt = new Date(),
) {
  const configured = sentAt.getTime() + FLOW_CONFIG.linkExpiryHours * 60 * 60 * 1_000;
  const prescriptionExpiries = prescriptions
    .filter(item => item.payable !== false && item.cancelled !== true)
    .map(prescriptionExpiryAt)
    .filter((value): value is number => value !== null);
  return new Date(Math.min(configured, ...(prescriptionExpiries.length ? prescriptionExpiries : [configured]))).toISOString();
}

export function addCalendarMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12, 0, 0, 0));
}

export function patientRetentionState(nextAppointment: string | null | undefined, now = new Date()) {
  const due = Date.parse(String(nextAppointment ?? ''));
  if (!Number.isFinite(due) || now.getTime() <= due) return 'active' as const;
  return now.getTime() >= due + 28 * 24 * 60 * 60 * 1_000 ? 'inactive' as const : 'at_risk' as const;
}

export function messageId(parts: Array<string | number>) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}
