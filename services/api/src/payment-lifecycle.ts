import { randomUUID } from 'node:crypto';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { messageId, paymentLinkExpiryAt, prescriptionIsCurrent } from './order-flow.js';
import { queuePatientMessage } from './notification-outbox.js';
import { createHostedPaymentSession } from './worldpay.js';

function orderPayableTotal(order: Record<string, unknown>, prescriptions: Array<Record<string, unknown>>) {
  const lines = Array.isArray(order.lineItems) ? order.lineItems as Array<Record<string, unknown>> : [];
  const priceByPack = new Map(lines.map(line => [String(line.packId ?? line.productId ?? ''), Number(line.unitPricePence ?? 0)]));
  const productTotal = prescriptions.flatMap(prescription => Array.isArray(prescription.items) ? prescription.items as Array<Record<string, unknown>> : [])
    .reduce((total, item) => total + (priceByPack.get(String(item.packId ?? '')) ?? 0) * Number(item.quantity ?? 0), 0);
  return productTotal > 0 ? productTotal + Number(order.dispensingFeePence ?? 0) : 0;
}

async function replacementWorldpayLink(paymentId: string, payment: Record<string, unknown>, orderId: string, order: Record<string, unknown>, amountPence: number, prescriptions: Array<Record<string, unknown>>) {
  const organisationId = String(payment.organisationId);
  const organisation = (await firestore.collection('organisations').doc(organisationId).get()).data()!;
  const successUrl = typeof payment.successUrl === 'string' ? payment.successUrl : '';
  const cancelUrl = typeof payment.cancelUrl === 'string' ? payment.cancelUrl : '';
  if (!successUrl || !cancelUrl) throw new Error('The prior Worldpay link does not contain replacement return URLs.');
  const transactionReference = `HHH-${orderId}-${randomUUID().slice(0, 8)}`;
  const linkExpiresAt = paymentLinkExpiryAt(prescriptions);
  const expirySeconds = Math.max(300, Math.floor((Date.parse(linkExpiresAt) - Date.now()) / 1_000));
  const provider = await createHostedPaymentSession(organisationId, {
    transactionReference,
    amountPence,
    currency: 'GBP',
    successUrl,
    cancelUrl,
    statementNarrative: String(organisation.tradingName ?? organisation.name ?? 'HHH Pharmacy'),
    expirySeconds,
  });
  const links = provider._links && typeof provider._links === 'object' ? provider._links as Record<string, unknown> : {};
  const self = links.self && typeof links.self === 'object' ? links.self as Record<string, unknown> : {};
  const nextRef = firestore.collection('payments').doc();
  const sentAt = nowIso();
  await nextRef.set({
    id: nextRef.id,
    schemaVersion: 2,
    organisationId,
    orderId,
    route: 'worldpay',
    status: 'pending',
    amountPence,
    currency: 'GBP',
    transactionReference,
    providerUrl: typeof provider.url === 'string' ? provider.url : null,
    paymentQueryUrl: typeof self.href === 'string' ? self.href : null,
    linkExpiresAt,
    providerSession: provider,
    successUrl,
    cancelUrl,
    linkGeneration: Number(payment.linkGeneration ?? 1) + 1,
    sentAt,
    reminder24At: null,
    reminder48At: null,
    replacedPaymentId: paymentId,
    createdAt: sentAt,
    updatedAt: sentAt,
  });
  await firestore.collection('orders').doc(orderId).set({ paymentId: nextRef.id, paymentStatus: 'pending', paymentTransactionReference: transactionReference, totalPence: amountPence, updatedAt: sentAt }, { merge: true });
  const patient = typeof order.patientId === 'string' ? (await firestore.collection('patients').doc(order.patientId).get()).data() : null;
  if (typeof patient?.email === 'string') await queuePatientMessage({
    id: messageId([orderId, nextRef.id, 'request']),
    organisationId,
    orderId,
    paymentId: nextRef.id,
    kind: 'patient_payment_request',
    recipient: patient.email,
    channel: 'email',
    deliveryOwner: organisation.paymentMessageOwner === 'platform' ? 'platform' : 'worldpay',
    templateData: { firstName: String(patient.firstName ?? 'Patient'), amountPence, paymentUrl: provider.url ?? null, linkExpiresAt },
  });
  return nextRef.id;
}

export async function processPendingPaymentLifecycle(now = new Date()) {
  const snapshot = await firestore.collection('payments').where('status', '==', 'pending').limit(500).get();
  const summary = { checked: snapshot.size, reminders: 0, reduced: 0, voided: 0, errors: 0 };
  for (const document of snapshot.docs) {
    try {
      const payment = document.data();
      if (payment.route !== 'worldpay' || typeof payment.orderId !== 'string' || typeof payment.organisationId !== 'string') continue;
      const orderRef = firestore.collection('orders').doc(payment.orderId);
      const orderSnapshot = await orderRef.get();
      if (!orderSnapshot.exists) continue;
      const order = orderSnapshot.data()!;
      const prescriptions = Array.isArray(order.prescriptions) ? order.prescriptions.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
      const current = prescriptions.filter(prescription => prescriptionIsCurrent(prescription, now) && prescription.payable !== false && prescription.cancelled !== true);
      if (current.length !== prescriptions.filter(prescription => prescription.payable !== false && prescription.cancelled !== true).length) {
        const currentIds = new Set(current.map(item => String(item.id ?? item.fileId)));
        const nextPrescriptions = prescriptions.map(item => currentIds.has(String(item.id ?? item.fileId)) ? item : { ...item, payable: false, expiredWhileAwaitingPaymentAt: now.toISOString() });
        const flow = order.prescriptionFlow && typeof order.prescriptionFlow === 'object' ? order.prescriptionFlow as Record<string, Record<string, unknown>> : {};
        const nextFlow = Object.fromEntries(Object.entries(flow).map(([key, value]) => [key, currentIds.has(key) ? value : { ...value, payable: false, state: 'EXPIRED' }]));
        const amountPence = orderPayableTotal(order, current);
        await document.ref.set({ status: 'expired', supersededAt: now.toISOString(), supersededReason: 'prescription_expired', updatedAt: now.toISOString() }, { merge: true });
        await orderRef.set({ prescriptions: nextPrescriptions, prescriptionFlow: nextFlow, totalPence: amountPence, paymentStatus: amountPence > 0 ? 'reissue_pending' : 'expired', exceptionQueueState: amountPence > 0 ? 'payment_reissue' : 'no_payable_prescriptions', updatedAt: now.toISOString() }, { merge: true });
        if (amountPence > 0) {
          await replacementWorldpayLink(document.id, payment, document.data().orderId, order, amountPence, current);
          summary.reduced += 1;
        } else summary.voided += 1;
        continue;
      }
      const sentAt = Date.parse(String(payment.sentAt ?? payment.createdAt ?? ''));
      if (!Number.isFinite(sentAt)) continue;
      const elapsedHours = (now.getTime() - sentAt) / 3_600_000;
      const reminderHour = elapsedHours >= 48 && !payment.reminder48At ? 48 : elapsedHours >= 24 && !payment.reminder24At ? 24 : null;
      if (!reminderHour) continue;
      const patient = typeof order.patientId === 'string' ? (await firestore.collection('patients').doc(order.patientId).get()).data() : null;
      const organisation = (await firestore.collection('organisations').doc(payment.organisationId).get()).data();
      if (typeof patient?.email === 'string') await queuePatientMessage({
        id: messageId([document.id, `reminder${reminderHour}`]),
        organisationId: payment.organisationId,
        orderId: payment.orderId,
        paymentId: document.id,
        kind: 'patient_payment_request',
        recipient: patient.email,
        channel: 'email',
        deliveryOwner: organisation?.paymentMessageOwner === 'platform' ? 'platform' : 'worldpay',
        templateData: { firstName: String(patient.firstName ?? 'Patient'), amountPence: payment.amountPence, paymentUrl: payment.providerUrl, reminderHour },
      });
      await document.ref.set({ [reminderHour === 48 ? 'reminder48At' : 'reminder24At']: now.toISOString(), updatedAt: now.toISOString() }, { merge: true });
      summary.reminders += 1;
    } catch (error) {
      summary.errors += 1;
      await document.ref.set({ lifecycleError: error instanceof Error ? error.message : 'Unknown payment lifecycle error', updatedAt: nowIso() }, { merge: true }).catch(() => undefined);
    }
  }
  return summary;
}
