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
  | 'CANCELLED_PURCHASE_ORDER'
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

export type RedoPriceResolution = 'absorb' | 'continue_as_fee';

export function activeRedoPriceResolution(value: unknown): RedoPriceResolution | undefined {
  return value === 'absorb' || value === 'continue_as_fee' ? value : undefined;
}

export function settlePaidRedoTotals(input: {
  priceResolution?: unknown;
  quotedTotalPence: number;
  originalTotalPence: number;
}): { ok: true; totalPence: number; pharmacyContributionPence: number } | { ok: false; code: string; message: string } {
  if (input.priceResolution === 'refund_and_recharge') {
    return {
      ok: false,
      code: 'REDO_REFUND_RECHARGE_REMOVED',
      message: 'Cancel the source order and use paid-order resolution instead of creating a new payment link.',
    };
  }
  const difference = input.quotedTotalPence - input.originalTotalPence;
  if (difference === 0) {
    return { ok: true, totalPence: input.quotedTotalPence, pharmacyContributionPence: 0 };
  }
  if (input.priceResolution === 'absorb' && difference > 0) {
    return { ok: true, totalPence: input.originalTotalPence, pharmacyContributionPence: difference };
  }
  if (input.priceResolution === 'continue_as_fee') {
    return {
      ok: false,
      code: 'REDO_PAYMENT_AMOUNT_MISMATCH',
      message: 'Take the price drop into the dispensing fee so the replacement total matches the original payment, or cancel the order.',
    };
  }
  return {
    ok: false,
    code: 'REDO_PAYMENT_AMOUNT_MISMATCH',
    message: 'Absorb an increase, take a drop into the dispensing fee, or cancel the order for refund or replacement.',
  };
}
