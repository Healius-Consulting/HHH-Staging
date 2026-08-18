import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEmailTemplateCode, isPatientMessageKind, messageIdempotencyKey } from './message-kinds.js';
import { renderEmailTemplate } from './email-renderer.js';

describe('email template kinds', () => {
  it('recognises supported template codes', () => {
    assert.equal(isEmailTemplateCode('patient_payment_confirmation'), true);
    assert.equal(isEmailTemplateCode('patient_refunded'), true);
    assert.equal(isEmailTemplateCode('pharmacy_2fa_enabled'), true);
    assert.equal(isEmailTemplateCode('pharmacy_2fa_disabled'), true);
    assert.equal(isEmailTemplateCode('pharmacy_order_dispatched'), true);
    assert.equal(isEmailTemplateCode('nope'), false);
  });

  it('keeps patient template recognition narrow', () => {
    assert.equal(isPatientMessageKind('patient_ready_for_collection'), true);
    assert.equal(isPatientMessageKind('patient_refunded'), true);
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

  it('renders patient payment awaiting, refunded, and ready emails', () => {
    const request = renderEmailTemplate('patient_payment_request', {
      firstName: 'Avery',
      amountPence: 8900,
      currency: 'GBP',
      orderNumber: 'ORD-890',
      paymentUrl: 'https://payments.example/pay',
      pharmacyName: 'North Pharmacy',
    });
    assert.match(request.subject, /Payment needed/);
    assert.match(request.html, /Pay now/);
    assert.match(request.html, /https:\/\/payments\.example\/pay/);

    const refunded = renderEmailTemplate('patient_refunded', {
      firstName: 'Avery',
      amountPence: 8900,
      currency: 'GBP',
      orderNumber: 'ORD-890',
    });
    assert.match(refunded.subject, /refunded/);
    assert.match(refunded.html, /ORD-890/);

    const ready = renderEmailTemplate('patient_ready_for_collection', {
      firstName: 'Avery',
      orderNumber: 'ORD-890',
      pharmacyName: 'North Pharmacy',
    });
    assert.match(ready.subject, /ready to collect/);
    assert.match(ready.html, /North Pharmacy/);
  });

  it('renders staff signup, reset, and 2FA emails', () => {
    const invite = renderEmailTemplate('pharmacy_staff_invite', {
      pharmacyName: 'North Pharmacy',
      actionLink: 'https://portal.holistichealthhub.cc/reset-password?oobCode=invite',
    });
    assert.match(invite.subject, /Set up your Holistic Health Hub account/);
    assert.match(invite.html, /Set your password/);

    const reset = renderEmailTemplate('pharmacy_password_reset', {
      actionLink: 'https://portal.holistichealthhub.cc/reset-password?oobCode=reset',
    });
    assert.match(reset.subject, /Reset your Holistic Health Hub password/);
    assert.match(reset.html, /Reset password/);

    const enabled = renderEmailTemplate('pharmacy_2fa_enabled', {});
    assert.match(enabled.subject, /Authenticator app added/);
    assert.match(enabled.html, /six-digit code/);

    const disabled = renderEmailTemplate('pharmacy_2fa_disabled', {});
    assert.match(disabled.subject, /Authenticator app removed/);
    assert.match(disabled.html, /set it up again/);
  });

  it('escapes interpolated HTML and drops non-http CTAs', () => {
    const rendered = renderEmailTemplate('patient_payment_request', {
      firstName: '<script>alert(1)</script>',
      orderNumber: 'ORD-1',
      paymentUrl: 'javascript:alert(1)',
    });
    assert.equal(rendered.html.includes('<script>alert(1)</script>'), false);
    assert.match(rendered.html, /&lt;script&gt;/);
    assert.equal(rendered.html.includes('javascript:alert'), false);
    assert.equal(rendered.html.includes('Pay now'), false);
  });
});
