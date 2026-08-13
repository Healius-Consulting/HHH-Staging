import assert from 'node:assert/strict';
import test from 'node:test';
import { compareQuotes, draftHasPaymentBoundary, normaliseStockStatus, prescriptionFileRemovalAllowed, quoteFingerprint, resolveOrderPaymentRoute, validPrescriptionSignature } from './app.js';
import { clinicPrescriptionReadyForPurchaseOrder, CuraleafRequestError } from './curaleaf.js';
import { eventPollBackoffSeconds } from './curaleaf-events.js';

const baseline = {
  shippingPrice: '5.00',
  taxRate: '20',
  items: [{ packId: 'pack-a', quantity: 1, inStock: true, wholesalePackPrice: '40.00', patientPackPrice: '60.00' }],
};

test('prescription signatures match only supported declared file types', () => {
  assert.equal(validPrescriptionSignature('application/pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(validPrescriptionSignature('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(validPrescriptionSignature('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(validPrescriptionSignature('application/pdf', Buffer.from([0xff, 0xd8, 0xff])), false);
});

test('quote comparison separates supplier costs, patient prices and stock', () => {
  assert.deepEqual(compareQuotes(baseline, baseline), []);
  assert.equal(compareQuotes(baseline, { ...baseline, shippingPrice: '6.00' })[0]?.category, 'supplier_cost');
  assert.equal(compareQuotes(baseline, { ...baseline, items: [{ ...baseline.items[0]!, patientPackPrice: '61.00' }] })[0]?.category, 'patient_price');
  assert.equal(compareQuotes(baseline, { ...baseline, items: [{ ...baseline.items[0]!, inStock: false }] })[0]?.category, 'stock');
});

test('low stock is advisory while false availability is always out of stock', () => {
  assert.equal(normaliseStockStatus(true, 'low_stock'), 'low_stock');
  assert.equal(normaliseStockStatus(true), 'in_stock');
  assert.equal(normaliseStockStatus(false, 'low_stock'), 'out_of_stock');
});

test('an explicit order payment route overrides the pharmacy default', () => {
  assert.equal(resolveOrderPaymentRoute('manual', 'worldpay'), 'manual');
  assert.equal(resolveOrderPaymentRoute('worldpay', 'manual'), 'worldpay');
  assert.equal(resolveOrderPaymentRoute(undefined, 'worldpay'), 'worldpay');
});

test('draft deletion locks at Worldpay generation or manual-payment entry', () => {
  assert.equal(draftHasPaymentBoundary({ paymentRoute: 'worldpay', paymentStatus: 'pending' }, false), false);
  assert.equal(draftHasPaymentBoundary({ paymentRoute: 'worldpay', paymentStatus: 'pending', paymentId: 'pay-1' }, false), true);
  assert.equal(draftHasPaymentBoundary({ paymentRoute: 'manual', paymentStatus: 'awaiting_manual_payment' }, false), true);
});

test('prescription copies can only be removed while uploaded and unlinked', () => {
  assert.equal(prescriptionFileRemovalAllowed('uploaded', false), true);
  assert.equal(prescriptionFileRemovalAllowed('uploaded', true), false);
  assert.equal(prescriptionFileRemovalAllowed('removed', false), false);
});

test('quote fingerprints are insensitive to item order', () => {
  const second = { packId: 'pack-b', quantity: 2, inStock: true, wholesalePackPrice: '10.00', patientPackPrice: '20.00' };
  assert.equal(quoteFingerprint({ ...baseline, items: [baseline.items[0]!, second] }), quoteFingerprint({ ...baseline, items: [second, baseline.items[0]!] }));
});

test('event polling honours Curaleaf retry-after and caps exponential backoff', () => {
  assert.equal(eventPollBackoffSeconds(new CuraleafRequestError(429, 'limited', false, 37), 1), 37);
  assert.equal(eventPollBackoffSeconds(new Error('offline'), 10), 300);
});

test('Clinic prescription purchase ordering waits for ACTIVE supplier state', () => {
  assert.equal(clinicPrescriptionReadyForPurchaseOrder('PENDING'), false);
  assert.equal(clinicPrescriptionReadyForPurchaseOrder('ACTIVE'), true);
  assert.equal(clinicPrescriptionReadyForPurchaseOrder('FULFILLED'), false);
  assert.equal(clinicPrescriptionReadyForPurchaseOrder('EXPIRED'), false);
  assert.equal(clinicPrescriptionReadyForPurchaseOrder('CANCELLED'), false);
});
