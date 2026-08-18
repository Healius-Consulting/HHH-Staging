import { executeCuraleafOrderPlacement } from '../integrations/curaleaf.service.js';
import { persistCuraleafPrescriptionIdentity } from '../prescriptions/curaleaf-prescription-record.js';
import { promotePatientAfterCuraleafPlacement } from '../patient-finance/patient-finance.js';
import type { PatientFinanceDeps } from '../patient-finance/patient-finance.js';
import type { IntegrationRepositoryPort } from '../../repositories/ports/integration.port.js';
import type { OrderRepositoryPort } from '../../repositories/ports/order.port.js';
import type { PaymentRecord, PaymentRepositoryPort } from '../../repositories/ports/payment.port.js';
import { sha256 } from '../../security/session-utils.js';

export type WorldpaySettlementDeps = {
  paymentRepo: PaymentRepositoryPort;
  orderRepo: OrderRepositoryPort;
  integrationRepo: IntegrationRepositoryPort;
  patientFinanceDeps: PatientFinanceDeps;
};

export async function settlePaidWorldpayPayment(
  payment: PaymentRecord,
  deps: WorldpaySettlementDeps,
) {
  if (payment.status === 'PAID') {
    return { payment, settled: false as const, reason: 'already_paid' as const };
  }
  if (payment.status !== 'PENDING') {
    return { payment, settled: false as const, reason: 'not_pending' as const };
  }

  const receiptHash = payment.receiptHash ?? sha256(crypto.randomUUID());
  await deps.paymentRepo.updatePaymentStatus(payment.id, 'PAID', payment.orderId, receiptHash);
  const settled: PaymentRecord = { ...payment, status: 'PAID', receiptHash };

  try {
    await placeOrderAfterWorldpaySettlement(settled, deps);
  } catch (error) {
    console.warn('[Worldpay] Curaleaf placement after settlement note:', error);
  }

  return { payment: settled, settled: true as const, reason: 'paid' as const };
}

export async function placeOrderAfterWorldpaySettlement(
  payment: PaymentRecord,
  deps: WorldpaySettlementDeps,
) {
  const order = await deps.orderRepo.findOrderById(payment.orderId, payment.organisationId);
  if (!order) return null;

  const connection = await deps.integrationRepo.findConnection(payment.organisationId, 'CURALEAF').catch(() => null);
  let curaleafResult: Awaited<ReturnType<typeof executeCuraleafOrderPlacement>> | null = null;
  if (connection?.secretResourceName) {
    curaleafResult = await executeCuraleafOrderPlacement(connection, order);
  }

  if (curaleafResult && ('prescriptionId' in curaleafResult || 'purchaseOrder' in curaleafResult)) {
    const placed = curaleafResult as { prescriptionId?: string; prescriberId?: string; purchaseOrder?: Record<string, unknown> | null };
    if (placed.prescriptionId || placed.purchaseOrder) {
      await persistCuraleafPrescriptionIdentity({
        organisationId: payment.organisationId,
        orderId: order.id,
        patientId: order.patientId,
        snapshot: order.quoteSnapshot,
        prescriptionId: placed.prescriptionId,
        prescriberId: placed.prescriberId,
        purchaseOrder: placed.purchaseOrder ?? null,
        fulfilmentStatus: placed.purchaseOrder ? 'SUPPLIER_PROCESSING' : undefined,
      }).catch(err => console.warn('Curaleaf placement snapshot persist warning:', err));
    }
  }

  await promotePatientAfterCuraleafPlacement(deps.patientFinanceDeps, order, curaleafResult).catch(err =>
    console.warn('Patient activation after Curaleaf placement note:', err),
  );

  const skipped = curaleafResult && 'skipped' in curaleafResult ? curaleafResult.skipped : false;
  const purchaseOrderId = curaleafResult && 'purchaseOrder' in curaleafResult
    ? (curaleafResult.purchaseOrder as { id?: string } | null | undefined)?.id
    : undefined;
  const skipReason = curaleafResult && 'reason' in curaleafResult ? String(curaleafResult.reason) : '';

  await deps.orderRepo.appendPlacementEvent({
    organisationId: payment.organisationId,
    orderId: payment.orderId,
    fromState: 'PENDING_PLACEMENT',
    toState: 'PLACED',
    reason: skipped
      ? `Worldpay payment cleared (${payment.transactionReference}) - existing Curaleaf PO retained (${skipReason})`
      : purchaseOrderId
        ? `Worldpay payment cleared (${payment.transactionReference}) - Curaleaf Purchase Order ${purchaseOrderId} placed automatically`
        : `Worldpay payment cleared (${payment.transactionReference}) - Pharmacy dispensing workflow`,
    externalReference: purchaseOrderId || payment.transactionReference || null,
  });

  return curaleafResult;
}
