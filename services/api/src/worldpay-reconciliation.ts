import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';
import { reconcileWorldpayPayment } from './worldpay.js';
import type { PaymentStatus } from './types.js';

const PAYMENT_QUERY_LAG_GRACE_MS = 2 * 60 * 1_000;

export type WorldpayReconciliationOutcome =
  | { state: 'verification_pending'; reason: string }
  | { state: 'reconciliation_required'; reason: string }
  | { state: 'reconciled'; paymentStatus: PaymentStatus; paymentId: string | null; providerStatus: string | null };

export async function reconcileWorldpayPaymentDocument(
  paymentDocument: QueryDocumentSnapshot<DocumentData>,
  webhookEntityId: string | null = null,
): Promise<WorldpayReconciliationOutcome> {
  const payment = paymentDocument.data();
  const organisationId = typeof payment.organisationId === 'string' ? payment.organisationId : '';
  const transactionReference = typeof payment.transactionReference === 'string' ? payment.transactionReference : '';
  const orderId = typeof payment.orderId === 'string' ? payment.orderId : '';
  if (!organisationId || !transactionReference || !orderId) {
    await paymentDocument.ref.update({
      status: 'reconciliation_required',
      reconciliationReason: 'The local payment record is missing its organisation, order or transaction reference.',
      reconciledAt: nowIso(),
      updatedAt: nowIso(),
    });
    return { state: 'reconciliation_required', reason: 'The local payment record is incomplete.' };
  }

  const reconciliation = await reconcileWorldpayPayment(organisationId, transactionReference);
  if (!reconciliation.reconciled) {
    return { state: 'verification_pending', reason: reconciliation.reason };
  }
  const provider = reconciliation.query;
  if (!provider.found) {
    const linkExpiry = Date.parse(typeof payment.linkExpiresAt === 'string' ? payment.linkExpiresAt : '');
    if (Number.isFinite(linkExpiry) && Date.now() > linkExpiry + PAYMENT_QUERY_LAG_GRACE_MS) {
      const updatedAt = nowIso();
      const orderReference = firestore.collection('orders').doc(orderId);
      const order = await orderReference.get();
      const batch = firestore.batch();
      batch.update(paymentDocument.ref, {
        status: 'expired',
        providerStatus: 'paymentLinkExpired',
        reconciliationReason: null,
        reconciledAt: updatedAt,
        updatedAt,
      });
      if (order.data()?.paymentId === paymentDocument.id) {
        batch.update(orderReference, { paymentStatus: 'expired', updatedAt });
      }
      await batch.commit();
      invalidateCollectionCache('payments', paymentDocument.id);
      if (order.data()?.paymentId === paymentDocument.id) invalidateCollectionCache('orders', orderId);
      return { state: 'reconciled', paymentStatus: 'expired', paymentId: null, providerStatus: 'paymentLinkExpired' };
    }
    return { state: 'verification_pending', reason: 'Payment Queries has not indexed this payment yet.' };
  }

  const observedEntityId = provider.entityId ?? webhookEntityId;
  const identityMatches = provider.transactionReference === transactionReference
    && provider.amountPence === payment.amountPence
    && provider.currency === payment.currency
    && observedEntityId === reconciliation.expectedEntityId;
  if (!identityMatches) {
    const reason = 'Worldpay reference, amount, currency or merchant entity did not match the local payment.';
    await paymentDocument.ref.update({
      status: 'reconciliation_required',
      reconciliationReason: reason,
      providerResponse: provider.payment,
      reconciledAt: nowIso(),
      updatedAt: nowIso(),
    });
    return { state: 'reconciliation_required', reason };
  }

  const updatedAt = nowIso();
  const orderReference = firestore.collection('orders').doc(orderId);
  const order = await orderReference.get();
  const batch = firestore.batch();
  batch.update(paymentDocument.ref, {
    status: provider.paymentStatus,
    providerPaymentId: provider.paymentId,
    providerStatus: provider.providerStatus,
    providerResponse: provider.payment,
    reconciliationReason: null,
    reconciledAt: updatedAt,
    updatedAt,
  });
  const shouldUpdateOrder = provider.paymentStatus !== 'pending'
    && (provider.paymentStatus === 'paid' || order.data()?.paymentId === paymentDocument.id);
  if (shouldUpdateOrder) {
    batch.update(orderReference, {
      paymentStatus: provider.paymentStatus,
      worldpayPaymentId: provider.paymentId,
      paymentTransactionReference: transactionReference,
      updatedAt,
    });
  }
  await batch.commit();
  invalidateCollectionCache('payments', paymentDocument.id);
  if (shouldUpdateOrder) invalidateCollectionCache('orders', orderId);
  return {
    state: 'reconciled',
    paymentStatus: provider.paymentStatus,
    paymentId: provider.paymentId,
    providerStatus: provider.providerStatus,
  };
}

export async function reconcilePendingWorldpayPayments(limit = 200) {
  const snapshot = await firestore.collection('payments')
    .where('route', '==', 'worldpay')
    .where('status', '==', 'pending')
    .limit(limit)
    .get();
  const candidates = snapshot.docs;
  const summary = { checked: candidates.length, reconciled: 0, pending: 0, attention: 0, errors: 0 };
  for (const document of candidates) {
    try {
      const outcome = await reconcileWorldpayPaymentDocument(document);
      if (outcome.state === 'reconciled') summary.reconciled += 1;
      else if (outcome.state === 'verification_pending') summary.pending += 1;
      else summary.attention += 1;
    } catch (error) {
      summary.errors += 1;
      console.error('Worldpay payment reconciliation failed', {
        paymentId: document.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return summary;
}
