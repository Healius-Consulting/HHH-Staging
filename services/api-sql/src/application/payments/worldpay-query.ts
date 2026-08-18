export type WorldpayPaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refund_required'
  | 'refunded';

export type WorldpayPaymentQuery = {
  found: boolean;
  transactionReference: string;
  paymentId: string | null;
  providerStatus: string | null;
  paymentStatus: WorldpayPaymentStatus;
  amountPence: number | null;
  currency: string | null;
  entityId: string | null;
  payment: Record<string, unknown> | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalisedStatus(value: string | null) {
  return (value ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

export function worldpayPaymentStatus(providerStatus: string | null): WorldpayPaymentStatus {
  switch (normalisedStatus(providerStatus)) {
    case 'sentforsettlement':
    case 'settlementrequestsubmitted':
    case 'salesucceeded':
    case 'settled':
    case 'settlementsucceeded':
      return 'paid';
    case 'refused':
    case 'authorizationrefused':
    case 'salerefused':
    case 'error':
    case 'authorizationfailed':
    case 'salefailed':
    case 'settlementrequestsubmissionfailed':
    case 'settlementfailed':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'cancellationrequestsubmitted':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'sentforrefund':
    case 'refundrequested':
    case 'refundrequestsubmitted':
    case 'refundfailed':
    case 'refundrequestsubmissionfailed':
      return 'refund_required';
    case 'refunded':
    case 'refundsucceeded':
      return 'refunded';
    default:
      // Authorization reserves funds but does not prove that settlement has started.
      return 'pending';
  }
}

export function worldpayStatusToSql(status: WorldpayPaymentStatus): 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUND_REQUIRED' | 'REFUNDED' {
  switch (status) {
    case 'paid':
      return 'PAID';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'refund_required':
      return 'REFUND_REQUIRED';
    case 'refunded':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

export function normaliseWorldpayPaymentQuery(value: unknown, transactionReference: string): WorldpayPaymentQuery {
  const response = object(value);
  const embedded = object(response?._embedded);
  const candidates = Array.isArray(embedded?.payments)
    ? embedded.payments
    : Array.isArray(response?.payments)
      ? response.payments
      : [];
  const payment = candidates.map(object).find(candidate => string(candidate?.transactionReference) === transactionReference) ?? null;
  if (!payment) {
    return {
      found: false,
      transactionReference,
      paymentId: null,
      providerStatus: null,
      paymentStatus: 'pending',
      amountPence: null,
      currency: null,
      entityId: null,
      payment: null,
    };
  }
  const valueObject = object(payment.value) ?? object(payment.amount);
  const merchant = object(payment.merchant);
  const providerStatus = string(payment.lastEvent) ?? string(payment.eventName) ?? string(payment.status) ?? string(payment.outcome);
  return {
    found: true,
    transactionReference,
    paymentId: string(payment.paymentId),
    providerStatus,
    paymentStatus: worldpayPaymentStatus(providerStatus),
    amountPence: finiteNumber(valueObject?.amount) ?? finiteNumber(valueObject?.value),
    currency: string(valueObject?.currency) ?? string(valueObject?.currencyCode),
    entityId: string(payment.entityReference) ?? string(payment.entity) ?? string(merchant?.entity),
    payment,
  };
}

export function worldpayIdentityMatches(input: {
  query: WorldpayPaymentQuery;
  transactionReference: string;
  amountPence: number;
  currency: string;
  expectedEntityId: string;
}): boolean {
  return input.query.transactionReference === input.transactionReference
    && input.query.amountPence === input.amountPence
    && input.query.currency === input.currency
    && input.query.entityId === input.expectedEntityId;
}
