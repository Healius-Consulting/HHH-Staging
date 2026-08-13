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

export type StageFilter = 'all' | 'awaiting-payment' | 'awaiting-fulfilment' | 'ready' | 'rejected' | 'archived' | 'completed';

function unresolvedOrderReason(order: PatientOrder, now: Date): UnresolvedOrderReason | null {
  if (order.payment.status === 'none') return null;
  if (order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.status === 'collected')) return null;
  if (order.redoneByOrderId) return null;
  if (order.unresolvedReason === 'expired' || order.unresolvedReason === 'rejected') return order.unresolvedReason;
  if (order.redoEligible === false) return null;
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
  if (statuses.length && statuses.every(status => status === 'collected')) return { stage: 'collected', unresolvedReason };
  if (statuses.length && statuses.every(status => ['ready', 'collected'].includes(status)) && statuses.some(status => status === 'ready')) return { stage: 'ready', unresolvedReason };
  if (statuses.some(status => status === 'received' || status === 'partially-received')) return { stage: 'delivered', unresolvedReason };
  if (statuses.some(status => status === 'dispatched')) return { stage: 'dispatched', unresolvedReason };
  if (statuses.length && statuses.every(status => ['approved', 'dispatched', 'partially-received', 'received', 'ready', 'collected'].includes(status))) return { stage: 'curaleaf-approved', unresolvedReason };
  if (order.prescriptions.some(prescription => prescription.placed || prescription.status === 'awaiting-approval')) return { stage: 'curaleaf-pending', unresolvedReason };
  return { stage: 'paid', unresolvedReason };
}

export function stageMatchesFilter(stage: OrderStage, filter: StageFilter) {
  if (filter === 'all') return true;
  if (filter === 'awaiting-fulfilment') return ['paid', 'curaleaf-pending', 'curaleaf-approved', 'dispatched', 'delivered'].includes(stage);
  if (filter === 'archived') return stage === 'archived' || stage === 'cancelled';
  if (filter === 'completed') return stage === 'collected';
  return stage === filter;
}
