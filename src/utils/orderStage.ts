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

type OrderPrescription = PatientOrder['prescriptions'][number];

function prescriptionPackTotals(prescription: OrderPrescription) {
  const lines = prescription.fulfilmentLines ?? [];
  return lines.reduce((totals, line) => ({
    ordered: totals.ordered + line.ordered,
    shipped: totals.shipped + line.shipped,
    received: totals.received + line.received,
    collected: totals.collected + line.collected,
  }), { ordered: 0, shipped: 0, received: 0, collected: 0 });
}

function prescriptionUsesPackProgress(prescription: OrderPrescription) {
  return (prescription.fulfilmentLines ?? []).length > 0;
}

function prescriptionHasCheckedInPacks(prescription: OrderPrescription) {
  if (prescriptionUsesPackProgress(prescription)) {
    return prescriptionPackTotals(prescription).received > 0;
  }
  return ['received', 'partially-received', 'ready', 'collected'].includes(prescription.status);
}

function prescriptionHasInTransitPacks(prescription: OrderPrescription) {
  if (prescriptionUsesPackProgress(prescription)) {
    const { shipped, received } = prescriptionPackTotals(prescription);
    return shipped > received;
  }
  if (prescription.status === 'dispatched') return true;
  return Boolean(prescription.shipmentIds?.length)
    && !['received', 'partially-received', 'ready', 'collected'].includes(prescription.status);
}

function prescriptionReadyForCollection(prescription: OrderPrescription) {
  if (!prescriptionHasCheckedInPacks(prescription)) return false;
  return prescription.status === 'ready'
    || Object.values(prescription.shipmentStates ?? {}).includes('ready_for_collection');
}

function prescriptionDeliveredAtPharmacy(prescription: OrderPrescription) {
  if (!prescriptionHasCheckedInPacks(prescription)) return false;
  if (prescriptionReadyForCollection(prescription)) return false;
  return prescription.status === 'received'
    || prescription.status === 'partially-received'
    || Object.values(prescription.shipmentStates ?? {}).some(state =>
      state === 'received' || state === 'partially_received',
    );
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
  const hasInTransitPacks = order.prescriptions.some(prescription => prescriptionHasInTransitPacks(prescription));
  const readyForCollection = !hasInTransitPacks
    && order.prescriptions.some(prescription => prescriptionReadyForCollection(prescription));
  const deliveredAtPharmacy = !hasInTransitPacks
    && order.prescriptions.some(prescription => prescriptionDeliveredAtPharmacy(prescription));
  if (statuses.length && statuses.every(status => status === 'cancelled')) return { stage: 'cancelled', unresolvedReason };
  if (statuses.length && statuses.every(status => status === 'collected') && !remainingOpen) return { stage: 'collected', unresolvedReason };
  if (hasInTransitPacks) return { stage: 'dispatched', unresolvedReason };
  if (readyForCollection) return { stage: 'ready', unresolvedReason };
  const usesPackProgress = order.prescriptions.some(prescriptionUsesPackProgress);
  if (deliveredAtPharmacy || (!usesPackProgress && statuses.some(status => status === 'received' || status === 'partially-received'))) {
    return { stage: 'delivered', unresolvedReason };
  }
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
