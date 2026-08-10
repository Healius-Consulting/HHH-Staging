import { calculatePrescriptionExpiry } from './placement-engine.js';

export type UnresolvedOrderReason = 'expired' | 'rejected';
export type ExpiryRecommendation = 'cancel_and_redo' | 'awaiting_delivery_redo' | 'ready_to_collect_redo';

export interface OrderCycleFields {
  createdAt?: string;
  updatedAt?: string;
  paymentStatus?: string;
  fulfilmentStatus?: string;
  status?: string;
  isExpired?: boolean;
  archivedAt?: string;
  archivedReason?: string;
  redoneByOrderId?: string | null;
  curaleafPoState?: string;
  quoteReview?: { status?: string } | null;
  prescriptions?: Array<{
    issueDate?: string;
    expiryDate?: string;
  }>;
}

export interface OrderCycleEvaluation {
  cycleStartedAt: string;
  cycleExpiresAt: string;
  isCycleExpired: boolean;
  isPaid: boolean;
  isDispatched: boolean;
  isArrivedAtPharmacy: boolean;
  recommendation: ExpiryRecommendation;
  unresolvedReason: UnresolvedOrderReason | null;
  redoEligible: boolean;
}

function asDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Earliest prescription cycle end, else createdAt + 28 days. */
export function orderCycleWindow(order: OrderCycleFields, now = new Date()) {
  const createdAt = asDate(order.createdAt, now);
  const prescriptionEnds = (order.prescriptions ?? [])
    .map(prescription => {
      if (!prescription.issueDate && !prescription.expiryDate) return null;
      const expiryIso = calculatePrescriptionExpiry(
        prescription.issueDate || createdAt.toISOString(),
        prescription.expiryDate,
      );
      return asDate(`${expiryIso}T23:59:59.999Z`, createdAt);
    })
    .filter((value): value is Date => Boolean(value));

  const cycleStartedAt = createdAt;
  const cycleExpiresAt = prescriptionEnds.length
    ? new Date(Math.min(...prescriptionEnds.map(date => date.getTime())))
    : (() => {
        const expiry = new Date(createdAt);
        expiry.setDate(expiry.getDate() + 28);
        return expiry;
      })();

  return {
    cycleStartedAt: cycleStartedAt.toISOString(),
    cycleExpiresAt: cycleExpiresAt.toISOString(),
    isCycleExpired: now.getTime() > cycleExpiresAt.getTime(),
  };
}

export function evaluateOrderCycle(order: OrderCycleFields, now = new Date()): OrderCycleEvaluation {
  const window = orderCycleWindow(order, now);
  const isPaid = order.paymentStatus === 'paid';
  const fulfilment = String(order.fulfilmentStatus ?? '');
  const isDispatched = ['dispatched_to_pharmacy', 'dispatched', 'in_transit'].includes(fulfilment)
    || ['DISPATCHED', 'SHIPPED'].includes(String(order.curaleafPoState ?? ''));
  const isArrivedAtPharmacy = ['received', 'partially_received', 'ready_for_collection', 'received_at_pharmacy'].includes(fulfilment);
  const isCompleted = ['collected', 'completed'].includes(fulfilment);

  let recommendation: ExpiryRecommendation = 'cancel_and_redo';
  if (isPaid) {
    if (isArrivedAtPharmacy) recommendation = 'ready_to_collect_redo';
    else if (isDispatched) recommendation = 'awaiting_delivery_redo';
    else recommendation = 'cancel_and_redo';
  }

  const alreadyRedone = Boolean(order.redoneByOrderId);
  const archived = order.status === 'archived' || order.isExpired === true;
  const rejected = order.quoteReview?.status === 'recreate_required';

  let unresolvedReason: UnresolvedOrderReason | null = null;
  if (!alreadyRedone && !isCompleted) {
    if (rejected) unresolvedReason = 'rejected';
    else if (archived || window.isCycleExpired) unresolvedReason = 'expired';
  }

  return {
    ...window,
    isPaid,
    isDispatched,
    isArrivedAtPharmacy,
    recommendation,
    unresolvedReason,
    redoEligible: unresolvedReason !== null,
  };
}

export function enrichOrderRecord<T extends OrderCycleFields>(order: T, now = new Date()) {
  const evaluation = evaluateOrderCycle(order, now);
  return {
    ...order,
    isExpired: order.isExpired === true || evaluation.unresolvedReason === 'expired' || evaluation.isCycleExpired,
    cycleStartedAt: evaluation.cycleStartedAt,
    cycleExpiresAt: evaluation.cycleExpiresAt,
    unresolvedReason: evaluation.unresolvedReason,
    redoEligible: evaluation.redoEligible,
    expiryCheck: {
      isPaid: evaluation.isPaid,
      isDispatched: evaluation.isDispatched,
      isArrivedAtPharmacy: evaluation.isArrivedAtPharmacy,
      recommendation: evaluation.recommendation,
    },
  };
}
