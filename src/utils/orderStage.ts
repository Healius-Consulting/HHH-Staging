import type { PatientOrder, UnresolvedOrderReason } from '../context/AppContext';

export type OrderStage =
  | 'awaiting-payment'
  | 'paid'
  | 'curaleaf-pending'
  | 'curaleaf-approved'
  | 'dispatched'
  | 'delivered'
  | 'ready'
  | 'collected'
  | 'rejected'
  | 'archived'
  | 'cancelled';

export type StageFilter = 'current' | 'all' | 'awaiting-payment' | 'awaiting-fulfilment' | 'ready' | 'rejected' | 'archived' | 'completed' | 'cancelled';

export type CancellationResolution = 'none' | 'needs-action' | 'resolved' | 'refunded';

export function hasDispatchedRemainder(line: { ordered: number; shipped: number }) {
  return line.shipped > 0 && line.shipped < line.ordered;
}

/**
 * Cancellation is an order outcome, not a patient status. Keep unfinished
 * supplier/refund work operational while demoting closed cancellations.
 */
export function orderCancellationResolution(order: PatientOrder): CancellationResolution {
  if (!order.cancellation && order.lifecycleStatus !== 'cancelled') return 'none';
  if (order.refund?.status === 'completed') return 'refunded';

  const supplierActionOutstanding = ['contact_required', 'awaiting_confirmation'].includes(order.curaleafCancellation?.status ?? '')
    || ['curaleaf_contact_required', 'awaiting_curaleaf_confirmation'].includes(order.cancellation?.status ?? '');
  const refundActionOutstanding = order.cancellation?.status === 'refund_required'
    || order.refund?.status === 'pending_confirmation'
    || order.payment.status === 'paid';

  if (supplierActionOutstanding || refundActionOutstanding) return 'needs-action';
  return 'resolved';
}

function unresolvedOrderReason(order: PatientOrder, now: Date): UnresolvedOrderReason | null {
  if (order.payment.status === 'none') return null;
  if (order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.status === 'collected')) return null;
  if (order.redoneByOrderId) return null;
  if (order.unresolvedReason === 'expired' || order.unresolvedReason === 'rejected' || order.unresolvedReason === 'cancelled') return order.unresolvedReason;
  if (order.redoEligible === false) return null;
  if (order.cancellation?.status === 'refund_required' || order.cancellation?.status === 'confirmed' || order.prescriptions.some(rx => rx.status === 'cancelled' || rx.purchaseOrderState === 'CANCELLED')) return 'cancelled';
  if (order.quoteReview?.status === 'recreate_required' || order.quoteReview) return 'rejected';
  if (order.lifecycleStatus === 'archived' || order.isExpired) return 'expired';
  const entryDate = new Date(order.date);
  const expiryDate = order.cycleExpiresAt ? new Date(order.cycleExpiresAt) : (() => {
    const value = new Date(entryDate);
    value.setDate(value.getDate() + 28);
    return value;
  })();
  return now > expiryDate ? 'expired' : null;
}

export function orderStage(order: PatientOrder, now = new Date()): { stage: OrderStage; unresolvedReason: UnresolvedOrderReason | null } {
  const unresolvedReason = unresolvedOrderReason(order, now);
  if (order.lifecycleStatus === 'cancelled') return { stage: 'cancelled', unresolvedReason };
  if (unresolvedReason === 'expired' || order.unresolvedReason === 'expired' || order.lifecycleStatus === 'archived' || order.isExpired) return { stage: 'archived', unresolvedReason };
  if (unresolvedReason === 'rejected' || order.unresolvedReason === 'rejected' || order.quoteReview) return { stage: 'rejected', unresolvedReason };
  if (order.payment.status === 'sent') return { stage: 'awaiting-payment', unresolvedReason };

  const statuses = order.prescriptions.map(prescription => prescription.status);
  const remainingOpen = order.prescriptions.some(prescription =>
    (prescription.fulfilmentLines ?? []).some(line => line.remaining > 0 || line.received < line.ordered || line.collected < line.ordered),
  );
  const readyForCollection = order.prescriptions.some(prescription =>
    prescription.status === 'ready'
    || Object.values(prescription.shipmentStates ?? {}).includes('ready_for_collection'),
  );
  if (statuses.length && statuses.every(status => status === 'cancelled')) return { stage: 'cancelled', unresolvedReason };
  if (statuses.length && statuses.every(status => status === 'collected') && !remainingOpen) return { stage: 'collected', unresolvedReason };
  if (readyForCollection) return { stage: 'ready', unresolvedReason };
  if (statuses.some(status => status === 'received' || status === 'partially-received')) return { stage: 'delivered', unresolvedReason };
  if (statuses.some(status => status === 'dispatched')) return { stage: 'dispatched', unresolvedReason };
  if (statuses.length && statuses.every(status => ['processing', 'approved', 'dispatched', 'partially-received', 'received', 'ready', 'collected', 'cancelled'].includes(status))) return { stage: 'curaleaf-approved', unresolvedReason };
  if (order.prescriptions.some(prescription => prescription.placed || prescription.status === 'awaiting-approval')) return { stage: 'curaleaf-pending', unresolvedReason };
  return { stage: 'paid', unresolvedReason };
}

export function stageMatchesFilter(stage: OrderStage, filter: StageFilter) {
  if (filter === 'current') return !['archived', 'collected', 'cancelled'].includes(stage);
  if (filter === 'all') return true;
  if (filter === 'awaiting-fulfilment') return ['paid', 'curaleaf-pending', 'curaleaf-approved', 'dispatched', 'delivered'].includes(stage);
  if (filter === 'archived') return stage === 'archived';
  if (filter === 'cancelled') return stage === 'cancelled';
  if (filter === 'completed') return stage === 'collected';
  return stage === filter;
}
