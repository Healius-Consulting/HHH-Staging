import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEmailTemplateCode, isPatientMessageKind, messageIdempotencyKey } from './message-kinds.js';
import { renderEmailTemplate } from './email-renderer.js';

describe('email template kinds', () => {
  it('recognises supported template codes', () => {
    assert.equal(isEmailTemplateCode('patient_payment_confirmation'), true);
    assert.equal(isEmailTemplateCode('pharmacy_order_dispatched'), true);
    assert.equal(isEmailTemplateCode('nope'), false);
  });

  it('keeps patient template recognition narrow', () => {
    assert.equal(isPatientMessageKind('patient_ready_for_collection'), true);
    assert.equal(isPatientMessageKind('pharmacy_payment_received'), false);
  });

  it('builds deterministic idempotency keys', () => {
    assert.equal(messageIdempotencyKey(['a', 1, 'b']), 'a:1:b');
  });
});

describe('email template renderer', () => {
  it('renders a patient payment confirmation', () => {
    const rendered = renderEmailTemplate('patient_payment_confirmation', {
      firstName: 'Avery',
      amountPence: 12500,
      currency: 'GBP',
      orderNumber: 'ORD-123',
      receiptHash: 'a'.repeat(64),
    });
    assert.match(rendered.subject, /Payment received/);
    assert.match(rendered.text, /Avery/);
    assert.match(rendered.html, /ORD-123/);
  });

  it('renders a pharmacy dispatch update', () => {
    const rendered = renderEmailTemplate('pharmacy_order_dispatched', {
      orderNumber: 'ORD-456',
      summary: 'A partial order has been dispatched.',
    });
    assert.match(rendered.subject, /Order dispatched update/);
    assert.match(rendered.text, /partial order/);
    assert.match(rendered.html, /ORD-456/);
  });
});
