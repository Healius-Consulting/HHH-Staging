function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function orderMoneyWasTaken(order: { paymentStatus?: string | null; paidAt?: string | null }) {
  const status = String(order.paymentStatus || '').toUpperCase();
  if (['PAID', 'REFUND_REQUIRED', 'REFUNDED'].includes(status)) return true;
  return Boolean(order.paidAt);
}

export function snapshotRefundCompleted(snapshot: unknown) {
  return String(asRecord(asRecord(snapshot).refund).status || '') === 'completed';
}

export function pendingManualRefund(order: {
  id: string;
  orderNumber?: string | null;
  totalPence?: number | null;
  paymentRoute?: string | null;
}, actorUid?: string | null, now = new Date().toISOString()) {
  const worldpay = String(order.paymentRoute || '').toLowerCase() === 'worldpay';
  return {
    id: `refund-${order.id}`,
    status: 'pending_confirmation' as const,
    amountPence: Math.max(0, Number(order.totalPence || 0)),
    method: worldpay ? 'worldpay_portal' as const : 'pharmacy_manual' as const,
    paymentReference: order.orderNumber || order.id,
    transactionReference: order.orderNumber || order.id,
    reason: 'patient_cancelled' as const,
    resolution: 'cancel' as const,
    requestedAt: now,
    requestedBy: actorUid || undefined,
  };
}

export function withPendingPaidRefund(snapshot: unknown, refund: ReturnType<typeof pendingManualRefund>) {
  const root = asRecord(snapshot);
  const existing = asRecord(root.refund);
  if (String(existing.status || '') === 'completed') return root;
  if (String(existing.status || '') === 'pending_confirmation' && existing.id) return root;
  return { ...root, refund };
}

export function snapshotWithManualRefundTask(
  order: {
    id: string;
    orderNumber?: string | null;
    totalPence?: number | null;
    paymentRoute?: string | null;
    paymentStatus?: string | null;
    paidAt?: string | null;
  },
  snapshot: unknown,
  actorUid?: string | null,
) {
  if (!orderMoneyWasTaken(order) || snapshotRefundCompleted(snapshot)) return asRecord(snapshot);
  if (String(asRecord(asRecord(snapshot).cancellation).status || '') !== 'refund_required') return asRecord(snapshot);
  return withPendingPaidRefund(snapshot, pendingManualRefund(order, actorUid));
}

export function completedManualRefund(
  order: Parameters<typeof pendingManualRefund>[0],
  input: { refundId?: string | null; externalReference: string; actorUid?: string | null; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  return {
    ...pendingManualRefund(order, input.actorUid, now),
    id: input.refundId || `refund-${order.id}`,
    status: 'completed' as const,
    externalReference: input.externalReference,
    confirmedAt: now,
    confirmedBy: input.actorUid || undefined,
  };
}
