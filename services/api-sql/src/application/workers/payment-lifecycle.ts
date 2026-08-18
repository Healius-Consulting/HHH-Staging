import { evaluatePendingPaymentLifecycle } from '../payments/payment-lifecycle.js';
import { patientMessageIdempotencyKey } from '../notifications/patient-messages.js';
import type { NotificationRepositoryPort } from '../../repositories/ports/notification.port.js';
import type { OrderRepositoryPort } from '../../repositories/ports/order.port.js';
import type { PatientRepositoryPort } from '../../repositories/ports/patient.port.js';
import type { PaymentRepositoryPort } from '../../repositories/ports/payment.port.js';
import { sha256 } from '../../security/session-utils.js';

export type PaymentLifecycleDeps = {
  paymentRepo: PaymentRepositoryPort;
  orderRepo: OrderRepositoryPort;
  patientRepo: PatientRepositoryPort;
  notificationRepo: NotificationRepositoryPort;
};

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function processPendingPaymentLifecycle(deps: PaymentLifecycleDeps, now = new Date()) {
  const payments = await deps.paymentRepo.listPendingWorldpayPayments(500);
  const summary = { checked: payments.length, reminders: 0, reduced: 0, voided: 0, errors: 0 };
  for (const payment of payments) {
    if (payment.status !== 'PENDING') continue;
    try {
      const order = await deps.orderRepo.findOrderById(payment.orderId, payment.organisationId);
      if (!order) continue;
      const decision = evaluatePendingPaymentLifecycle({
        payment,
        quoteSnapshot: order.quoteSnapshot,
        dispensingFeePence: order.dispensingFeePence,
        now,
      });
      if (decision.action === 'none') continue;
      if (decision.action === 'void_expired') {
        await deps.paymentRepo.updatePaymentOutcome({
          id: payment.id,
          orderId: payment.orderId,
          status: 'EXPIRED',
          receiptHash: payment.receiptHash,
          providerPayload: { ...payloadObject(payment.providerPayload), supersededReason: 'prescription_expired' },
        });
        summary.voided += 1;
        continue;
      }
      if (decision.action === 'reduce_expired') {
        await deps.paymentRepo.updatePaymentOutcome({
          id: payment.id,
          orderId: payment.orderId,
          status: 'EXPIRED',
          receiptHash: payment.receiptHash,
          providerPayload: {
            ...payloadObject(payment.providerPayload),
            supersededReason: 'prescription_expired',
            remainingAmountPence: decision.amountPence,
          },
        });
        summary.reduced += 1;
        continue;
      }
      const patient = await deps.patientRepo.findPatientById(payment.organisationId, order.patientId).catch(() => null);
      if (patient?.email) {
        await deps.notificationRepo.enqueue({
          organisationId: payment.organisationId,
          patientId: order.patientId,
          orderId: order.id,
          channel: 'EMAIL',
          templateCode: 'patient_payment_request',
          recipientHash: sha256(patient.email.toLowerCase()),
          encryptedRecipient: patient.email,
          payload: {
            firstName: patient.firstName || 'Patient',
            amountPence: payment.amountPence,
            paymentUrl: payment.hostedPaymentUrl,
            reminderHour: decision.hour,
          },
          idempotencyKey: patientMessageIdempotencyKey([payment.id, `reminder${decision.hour}`]),
        });
      }
      await deps.paymentRepo.updatePaymentOutcome({
        id: payment.id,
        orderId: payment.orderId,
        status: 'PENDING',
        receiptHash: payment.receiptHash,
        providerPayload: {
          ...payloadObject(payment.providerPayload),
          [decision.hour === 48 ? 'reminder48At' : 'reminder24At']: now.toISOString(),
        },
      });
      summary.reminders += 1;
    } catch (error) {
      summary.errors += 1;
      console.error('Payment lifecycle failed', {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return summary;
}
