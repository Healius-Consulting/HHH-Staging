import assert from 'node:assert/strict';
import test from 'node:test';
import type { PatientOrder, Prescription } from '../src/context/AppContext.tsx';
import { buildOrderTimelineEvents, buildPrescriptionTimelineEvents } from '../src/utils/orderTimeline.ts';

const tenPackPrescription: Prescription = {
  id: 101,
  entryMode: 'manual',
  prescriber: 'Dr Prescriber',
  copyFileName: null,
  items: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', name: 'Medication', qty: 10, cost: 68, retail: 120 }],
  placed: true,
  placedAt: '2026-08-13T09:23:29.241487Z',
  poRef: 'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
  status: 'partially-received',
  invoiceRef: null,
  trackingNumber: null,
  carrier: 'POLAR_SPEED',
  shipmentId: '796adea9-f2d9-43b2-ad5c-ccfc4184ee62',
  shipmentIds: ['796adea9-f2d9-43b2-ad5c-ccfc4184ee62'],
  shipmentStates: {
    '796adea9-f2d9-43b2-ad5c-ccfc4184ee62': 'collected',
  },
  fulfilmentLines: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    ordered: 10,
    requested: 10,
    sent: 10,
    supplierReportedOrdered: 10,
    allocated: 1,
    shipped: 1,
    remaining: 9,
    received: 1,
    collected: 1,
    returned: 0,
    backordered: true,
    quantityMismatch: false,
  }],
  shipments: [{
    id: '796adea9-f2d9-43b2-ad5c-ccfc4184ee62',
    createdAt: '2026-08-17T08:50:45.621344Z',
    items: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', packCount: 1 }],
  }],
  latestShipmentAt: '2026-08-17T08:50:45.621344Z',
  goodsInAt: '2026-08-17T08:50:45.621344Z',
  readyAt: '2026-08-17T10:00:00.000Z',
};

const partialOrder: PatientOrder & { handoutAt?: string } = {
  id: 12,
  organisationId: '70913a3071c34a41952ed532927af58c',
  patientId: 'patient-1',
  date: new Date('2026-08-13T09:00:00.000Z'),
  dispensingFee: 0,
  payment: {
    status: 'paid',
    route: 'pharmacy',
    amount: 1200,
    ref: 'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
    sentAt: new Date('2026-08-13T09:00:00.000Z'),
    paidAt: new Date('2026-08-13T09:05:00.000Z'),
    manualTender: 'epos-card',
    manualReference: 'EPOS-1',
    manualNotes: null,
    manualRecordedBy: null,
  },
  prescriptions: [tenPackPrescription],
  curaleafApprovedAt: '2026-08-13T09:23:29.241487Z',
  handoutAt: '2026-08-17T11:00:00.000Z',
};

test('partial check-in uses pack counts instead of full delivery wording', () => {
  const events = buildPrescriptionTimelineEvents(tenPackPrescription, 0);
  const checkIn = events.find(event => event.label.includes('checked in'));
  assert.ok(checkIn);
  assert.match(checkIn!.label, /partially checked in/i);
  assert.match(checkIn!.detail, /1 pack checked in; 9 remain with Curaleaf/);
  assert.notEqual(new Date(checkIn!.date as string).toISOString(), partialOrder.payment.paidAt!.toISOString());
});

test('ready to collect names the consignment shipment id', () => {
  const events = buildPrescriptionTimelineEvents(tenPackPrescription, 0);
  const ready = events.find(event => event.label.includes('ready to collect'));
  assert.ok(ready);
  assert.match(ready!.detail, /Consignment 796adea9/);
  assert.match(ready!.detail, /1 pack/);
});

test('partial handover records collected pack counts', () => {
  const events = buildPrescriptionTimelineEvents(tenPackPrescription, 0, partialOrder.handoutAt);
  const handout = events.find(event => event.label.includes('handed to patient'));
  assert.ok(handout);
  assert.match(handout!.label, /partially handed to patient/i);
  assert.match(handout!.detail, /1 of 10 packs collected; 9 remain on order/);
});

test('order timeline keeps payment and goods-in events on distinct timestamps', () => {
  const events = buildOrderTimelineEvents(partialOrder);
  const payment = events.find(event => event.label === 'Payment cleared');
  const checkIn = events.find(event => event.label.includes('partially checked in'));
  assert.ok(payment);
  assert.ok(checkIn);
  assert.notEqual(
    new Date(payment!.date as Date).getTime(),
    new Date(checkIn!.date as string).getTime(),
  );
});
