import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { pharmacyFinanceRecognition } from './finance-recognition.js';

const organisationIdSchema = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i);

const financeDateRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();

describe('portal finance query validation', () => {
  it('accepts compact tenant ids for admin finance filters', () => {
    const organisationId = '70913a3071c34a41952ed532927af58c';
    assert.doesNotThrow(() => organisationIdSchema.parse(organisationId));
  });

  it('accepts date-only filters for pharmacy prescription finance', () => {
    const parsed = financeDateRangeSchema.parse({ from: '2026-05-19' });
    assert.equal(parsed.from, '2026-05-19');
    assert.equal(parsed.to, undefined);
  });
});

describe('pharmacy finance recognition', () => {
  it('recognises paid orders before collection', () => {
    const paid = pharmacyFinanceRecognition({
      paymentStatus: 'PAID',
      status: 'PLACED',
      paidAt: '2026-08-01T10:00:00.000Z',
    });
    assert.equal(paid.recognised, true);
    assert.equal(paid.refunded, false);
    assert.equal(paid.refundPending, false);
  });

  it('does not recognise unpaid orders', () => {
    const unpaid = pharmacyFinanceRecognition({
      paymentStatus: 'PENDING',
      status: 'PENDING_PLACEMENT',
      paidAt: null,
    });
    assert.equal(unpaid.recognised, false);
  });

  it('removes completed refunds from recognised totals', () => {
    const refunded = pharmacyFinanceRecognition({
      paymentStatus: 'PAID',
      status: 'CANCELLED',
      paidAt: '2026-08-01T10:00:00.000Z',
      quoteSnapshot: { refund: { status: 'completed', confirmedAt: '2026-08-02T10:00:00.000Z' } },
    });
    assert.equal(refunded.recognised, false);
    assert.equal(refunded.refunded, true);
    assert.equal(refunded.refundConfirmedAt, '2026-08-02T10:00:00.000Z');
  });

  it('treats a confirmed payment cancellation as refunded', () => {
    const cancelledPayment = pharmacyFinanceRecognition({
      paymentStatus: 'CANCELLED',
      status: 'CANCELLED',
      paidAt: '2026-08-01T10:00:00.000Z',
    });
    assert.equal(cancelledPayment.recognised, false);
    assert.equal(cancelledPayment.refunded, true);
  });

  it('excludes opened refunds before confirmation', () => {
    const pending = pharmacyFinanceRecognition({
      paymentStatus: 'PAID',
      status: 'CANCELLED',
      paidAt: '2026-08-01T10:00:00.000Z',
      quoteSnapshot: { refund: { status: 'pending_confirmation' } },
    });
    assert.equal(pending.recognised, false);
    assert.equal(pending.refundPending, true);
    assert.equal(pending.refunded, false);
  });
});
