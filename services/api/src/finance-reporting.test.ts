import assert from 'node:assert/strict';
import test from 'node:test';
import { pharmacyFinanceRow, summarisePharmacyFinanceRows, type PharmacyFinanceRow } from './finance-reporting.js';

function financeOrder(paymentStatus: string, refund?: Record<string, unknown>) {
  return {
    id: `order-${paymentStatus}`,
    patientId: 'patient-1',
    paymentStatus,
    refund,
    lineItems: [{ packId: 'pack-1', name: 'Product', quantity: 1, unitPricePence: 10_000 }],
    dispensingFeePence: 500,
    pricingQuote: {
      shippingPrice: '5.00',
      items: [{ packId: 'pack-1', wholesalePackPrice: '80.00' }],
    },
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  };
}

function dated(row: ReturnType<typeof pharmacyFinanceRow>): PharmacyFinanceRow {
  const recognisedAt = row.recognised ? row.updatedAt : null;
  const refundedAt = row.refunded ? row.refundConfirmedAt ?? row.updatedAt : null;
  return { ...row, recognisedAt, refundedAt, financialEventAt: recognisedAt ?? refundedAt ?? row.updatedAt };
}

test('finance recognition excludes completed and pending refunds', () => {
  const paid = pharmacyFinanceRow(financeOrder('paid'));
  const pendingRefund = pharmacyFinanceRow(financeOrder('refund_required', { status: 'pending_confirmation' }));
  const refunded = pharmacyFinanceRow(financeOrder('refunded', { status: 'completed', confirmedAt: '2026-08-02T10:00:00.000Z' }));

  assert.equal(paid.recognised, true);
  assert.equal(pendingRefund.recognised, false);
  assert.equal(pendingRefund.refundPending, true);
  assert.equal(refunded.recognised, false);
  assert.equal(refunded.refunded, true);

  const totals = summarisePharmacyFinanceRows([dated(paid), dated(pendingRefund), dated(refunded)]);
  assert.equal(totals.paidPrescriptionCount, 1);
  assert.equal(totals.refundPendingCount, 1);
  assert.equal(totals.refundedPrescriptionCount, 1);
  assert.equal(totals.patientRevenuePence, 10_500);
  assert.equal(totals.wholesaleProductPence, 8_000);
  assert.equal(totals.shippingPence, 500);
  assert.equal(totals.productMarginPence, 2_000);
  assert.equal(totals.totalContributionPence, 2_000);
  assert.equal(totals.refundedPatientPence, 10_500);
  assert.equal(totals.refundPendingPatientPence, 10_500);
});

test('a completed refund wins over a stale paid status', () => {
  const row = pharmacyFinanceRow(financeOrder('paid', { status: 'completed', confirmedAt: '2026-08-02T10:00:00.000Z' }));
  assert.equal(row.recognised, false);
  assert.equal(row.refunded, true);
});
