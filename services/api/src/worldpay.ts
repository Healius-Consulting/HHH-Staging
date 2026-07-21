import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';
import { readIntegrationSecret } from './secrets.js';

export type WorldpayCredential = { serviceKey: string; entityId: string; webhookSecret: string };

export function verifyWorldpaySignature(rawBody: Buffer, supplied: string | undefined, secret: string) {
  if (!supplied) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalised = supplied.replace(/^sha256=/i, '');
  return expected.length === normalised.length && timingSafeEqual(Buffer.from(expected), Buffer.from(normalised));
}

export async function createHostedPaymentSession(organisationId: string, input: { transactionReference: string; amountPence: number; currency: 'GBP'; successUrl: string; cancelUrl: string }) {
  if (!config.WORLDPAY_HPP_BASE_URL) throw new HttpError(503, 'Worldpay HPP is not configured in this environment.', 'WORLDPAY_NOT_CONFIGURED');
  const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
  const response = await fetch(new URL('/payment_pages', config.WORLDPAY_HPP_BASE_URL), {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(credential.serviceKey).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ transactionReference: input.transactionReference, merchant: { entity: credential.entityId }, value: { currency: input.currency, amount: input.amountPence }, resultURLs: { successURL: input.successUrl, cancelURL: input.cancelUrl } }),
  });
  if (!response.ok) throw new HttpError(502, `Worldpay rejected the payment session (${response.status}).`, 'WORLDPAY_REQUEST_FAILED');
  return await response.json() as Record<string, unknown>;
}

export async function reconcileWorldpayPayment(organisationId: string, transactionReference: string) {
  if (!config.WORLDPAY_VERIFY_BASE_URL) return { reconciled: false as const, reason: 'Verification endpoint is not configured.' };
  const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
  const response = await fetch(new URL(`/payments/${encodeURIComponent(transactionReference)}`, config.WORLDPAY_VERIFY_BASE_URL), {
    headers: { Authorization: `Basic ${Buffer.from(credential.serviceKey).toString('base64')}`, Accept: 'application/json' },
  });
  if (!response.ok) return { reconciled: false as const, reason: `Verification returned ${response.status}.` };
  return { reconciled: true as const, payment: await response.json() as Record<string, unknown> };
}
