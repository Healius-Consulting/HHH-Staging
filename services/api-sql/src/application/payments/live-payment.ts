import type { PaymentRecord } from '../../repositories/ports/payment.port.js';

const LIVE_STATUSES = new Set([
  'PAID',
  'REFUND_REQUIRED',
  'REFUNDED',
  'PENDING',
  'AWAITING_MANUAL_PAYMENT',
  'RECONCILIATION_REQUIRED',
]);

function rank(status: string) {
  const value = status.toUpperCase();
  if (value === 'PAID' || value === 'REFUND_REQUIRED' || value === 'REFUNDED') return 0;
  if (value === 'PENDING' || value === 'AWAITING_MANUAL_PAYMENT' || value === 'RECONCILIATION_REQUIRED') return 1;
  return 2;
}

export function isLivePaymentStatus(status: string | null | undefined) {
  return LIVE_STATUSES.has(String(status || '').toUpperCase());
}

export function selectLivePayment<T extends { status: string; createdAt?: string | null }>(payments: T[]): T | null {
  const live = payments.filter(payment => isLivePaymentStatus(payment.status));
  if (!live.length) return null;
  return [...live].sort((left, right) => {
    const byStatus = rank(left.status) - rank(right.status);
    if (byStatus !== 0) return byStatus;
    return Date.parse(String(right.createdAt || 0)) - Date.parse(String(left.createdAt || 0));
  })[0] ?? null;
}

export function pendingPaymentsToCancel(payments: PaymentRecord[], keepId?: string | null) {
  return payments.filter(payment => (
    payment.status === 'PENDING'
    && payment.id !== keepId
  ));
}
