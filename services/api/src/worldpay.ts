import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';
import { readIntegrationSecret } from './secrets.js';
import type { PaymentStatus } from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;
const HPP_MEDIA_TYPE = 'application/vnd.worldpay.payment_pages-v1.hal+json';
const PAYMENT_QUERIES_MEDIA_TYPE = 'application/vnd.worldpay.payment-queries-v1.hal+json';

export type WorldpayCredential = { username: string; password: string; entityId: string };

export type WorldpayConnectionValidation = {
  passed: true;
  checkedAt: string;
  environment: 'try' | 'live';
  entityId: string;
};

export type WorldpayWebhookEvent = {
  eventId: string;
  eventTimestamp: string | null;
  transactionReference: string;
  type: string;
  entityId: string | null;
  paymentId: string | null;
  amountPence: number | null;
  currency: string | null;
};

export type WorldpayPaymentQuery = {
  found: boolean;
  transactionReference: string;
  paymentId: string | null;
  providerStatus: string | null;
  paymentStatus: PaymentStatus;
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

export function worldpayPaymentStatus(providerStatus: string | null): PaymentStatus {
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

function worldpayAuthorization(credential: WorldpayCredential) {
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
}

function paymentQueriesBaseUrl() {
  return config.WORLDPAY_PAYMENT_QUERIES_BASE_URL
    ?? config.WORLDPAY_VERIFY_BASE_URL
    ?? config.WORLDPAY_HPP_BASE_URL;
}

async function worldpayFetch(url: URL, init: RequestInit, credential: WorldpayCredential) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: worldpayAuthorization(credential), Accept: PAYMENT_QUERIES_MEDIA_TYPE, ...init.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'Worldpay did not respond in time.', 'WORLDPAY_TIMEOUT');
    }
    throw new HttpError(502, 'Worldpay could not be reached.', 'WORLDPAY_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

function worldpayEnvironment(url: string): 'try' | 'live' {
  return new URL(url).hostname.startsWith('try.') ? 'try' : 'live';
}

export async function validateWorldpayCredentials(credential: WorldpayCredential): Promise<WorldpayConnectionValidation> {
  const baseUrl = paymentQueriesBaseUrl();
  if (!baseUrl) throw new HttpError(503, 'Worldpay Payment Queries is not configured in this environment.', 'WORLDPAY_NOT_CONFIGURED');
  const url = new URL('/paymentQueries/payments', baseUrl);
  url.searchParams.set('transactionReference', `HHH-CONNECTION-CHECK-${randomUUID()}`);
  const response = await worldpayFetch(url, {}, credential);
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(401, 'Worldpay rejected these API credentials.', 'WORLDPAY_CREDENTIALS_REJECTED');
  }
  if (!response.ok) {
    throw new HttpError(502, `Worldpay could not validate the connection (${response.status}).`, 'WORLDPAY_VALIDATION_FAILED');
  }
  // Ensure the credentials return the documented JSON resource, not an intermediary HTML page.
  try {
    await response.json();
  } catch {
    throw new HttpError(502, 'Worldpay returned an invalid Payment Queries response.', 'WORLDPAY_VALIDATION_FAILED');
  }
  return {
    passed: true,
    checkedAt: new Date().toISOString(),
    environment: worldpayEnvironment(baseUrl),
    entityId: credential.entityId,
  };
}

export async function createHostedPaymentSession(
  organisationId: string,
  input: {
    transactionReference: string;
    amountPence: number;
    currency: 'GBP';
    successUrl: string;
    cancelUrl: string;
    statementNarrative: string;
    expirySeconds: number;
  },
) {
  if (!config.WORLDPAY_HPP_BASE_URL) throw new HttpError(503, 'Worldpay HPP is not configured in this environment.', 'WORLDPAY_NOT_CONFIGURED');
  const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
  const response = await worldpayFetch(new URL('/payment_pages', config.WORLDPAY_HPP_BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': HPP_MEDIA_TYPE, Accept: HPP_MEDIA_TYPE },
    body: JSON.stringify({
      transactionReference: input.transactionReference,
      merchant: { entity: credential.entityId },
      narrative: { line1: input.statementNarrative.slice(0, 24) },
      value: { currency: input.currency, amount: input.amountPence },
      // Worldpay documents expiry as an int64 but serialises it as a JSON string.
      expiry: String(input.expirySeconds),
      resultURLs: { successURL: input.successUrl, cancelURL: input.cancelUrl },
    }),
  }, credential);
  if (!response.ok) throw new HttpError(502, `Worldpay rejected the payment session (${response.status}).`, 'WORLDPAY_REQUEST_FAILED');
  return await response.json() as Record<string, unknown>;
}

export function parseWorldpayWebhookEvent(value: unknown): WorldpayWebhookEvent {
  const event = object(value);
  const details = object(event?.eventDetails);
  const amount = object(details?.amount);
  const merchant = object(details?.merchant);
  const eventId = string(event?.eventId);
  const transactionReference = string(details?.transactionReference);
  const type = string(details?.type);
  if (!eventId || !transactionReference || !type) {
    throw new HttpError(400, 'Worldpay sent an invalid payment event.', 'INVALID_WORLDPAY_EVENT');
  }
  return {
    eventId,
    eventTimestamp: string(event?.eventTimestamp),
    transactionReference,
    type,
    entityId: string(merchant?.entity),
    paymentId: string(details?.paymentId),
    amountPence: finiteNumber(amount?.value),
    currency: string(amount?.currencyCode),
  };
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

export async function reconcileWorldpayPayment(organisationId: string, transactionReference: string) {
  const baseUrl = paymentQueriesBaseUrl();
  if (!baseUrl) return { reconciled: false as const, reason: 'Payment Queries is not configured.' };
  const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
  const url = new URL('/paymentQueries/payments', baseUrl);
  url.searchParams.set('transactionReference', transactionReference);
  const response = await worldpayFetch(url, {}, credential);
  if (!response.ok) return { reconciled: false as const, reason: `Payment Queries returned ${response.status}.` };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { reconciled: false as const, reason: 'Payment Queries returned invalid JSON.' };
  }
  return {
    reconciled: true as const,
    query: normaliseWorldpayPaymentQuery(body, transactionReference),
    expectedEntityId: credential.entityId,
    raw: body,
  };
}
