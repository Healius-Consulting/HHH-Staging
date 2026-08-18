function snapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Paid orders count immediately. Completed or opened refunds drop out. Collection is not a gate. */
export function pharmacyFinanceRecognition(order: {
  paymentStatus?: string | null;
  status?: string | null;
  paidAt?: string | null;
  quoteSnapshot?: unknown;
}) {
  const payment = String(order.paymentStatus || '').toUpperCase();
  const status = String(order.status || '').toUpperCase();
  const refund = snapshotObject(snapshotObject(order.quoteSnapshot).refund);
  const refundStatus = String(refund.status || '').toLowerCase();
  const paidOnce = payment === 'PAID' || Boolean(order.paidAt);
  const refunded =
    refundStatus === 'completed'
    || payment === 'REFUNDED'
    || status === 'REFUNDED'
    || status === 'CANCELLED_REFUNDED'
    || (paidOnce && payment === 'CANCELLED');
  const refundPending = paidOnce && !refunded && (
    refundStatus === 'pending_confirmation'
    || payment === 'REFUND_REQUIRED'
    || status === 'CANCELLED'
  );
  return {
    recognised: paidOnce && !refunded && !refundPending,
    refunded,
    refundPending,
    refundConfirmedAt: typeof refund.confirmedAt === 'string' ? refund.confirmedAt : null,
  };
}
