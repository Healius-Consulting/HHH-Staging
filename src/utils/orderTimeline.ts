import type { PatientOrder, Prescription } from '../context/AppContext';

export type OrderTimelineEvent = {
  label: string;
  detail: string;
  date: Date | string | null;
};

function shortConsignmentId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function shipmentPackCount(shipment: NonNullable<Prescription['shipments']>[number]) {
  return (shipment.items ?? []).reduce((sum, item) => sum + Number(item.packCount || 0), 0);
}

function prescriptionPackTotals(prescription: Prescription) {
  const lines = prescription.fulfilmentLines ?? [];
  const fromLines = {
    ordered: lines.reduce((sum, line) => sum + (line.ordered ?? 0), 0),
    shipped: lines.reduce((sum, line) => sum + (line.shipped ?? 0), 0),
    received: lines.reduce((sum, line) => sum + (line.received ?? 0), 0),
    collected: lines.reduce((sum, line) => sum + (line.collected ?? 0), 0),
    remaining: lines.reduce((sum, line) => sum + (line.remaining ?? 0), 0),
  };
  if (fromLines.ordered > 0) return fromLines;
  const ordered = prescription.items.reduce((sum, item) => sum + item.qty, 0);
  return { ...fromLines, ordered };
}

function shipmentIdsFor(prescription: Prescription) {
  return prescription.shipmentIds?.length
    ? prescription.shipmentIds
    : prescription.shipmentId
      ? [prescription.shipmentId]
      : [];
}

export function buildPrescriptionTimelineEvents(
  prescription: Prescription,
  rxIndex: number,
  handoutAt?: Date | string | null,
): OrderTimelineEvent[] {
  const events: OrderTimelineEvent[] = [];
  const rxLabel = `Rx ${rxIndex + 1}`;
  const totals = prescriptionPackTotals(prescription);
  const shipmentIds = shipmentIdsFor(prescription);

  if (prescription.placed) {
    events.push({
      label: `${rxLabel} sent to Curaleaf`,
      detail: prescription.poRef ? `PO ${prescription.poRef}` : 'Awaiting supplier reference',
      date: prescription.placedAt ?? null,
    });
  }

  if (totals.shipped > 0) {
    if (shipmentIds.length) {
      for (const shipmentId of shipmentIds) {
        const shipment = prescription.shipments?.find(item => item.id === shipmentId);
        const packs = shipment ? shipmentPackCount(shipment) : 0;
        const state = prescription.shipmentStates?.[shipmentId];
        const dispatched = packs > 0
          || ['dispatched_to_pharmacy', 'partially_dispatched_to_pharmacy', 'partially_received', 'received', 'ready_for_collection', 'collected'].includes(String(state || ''));
        if (!dispatched) continue;
        events.push({
          label: totals.shipped < totals.ordered ? `${rxLabel} partial consignment dispatched` : `${rxLabel} consignment dispatched`,
          detail: `Consignment ${shortConsignmentId(shipmentId)} · ${packs || totals.shipped} pack${(packs || totals.shipped) === 1 ? '' : 's'}`,
          date: shipment?.createdAt ?? prescription.latestShipmentAt ?? prescription.placedAt ?? null,
        });
      }
    } else {
      events.push({
        label: totals.shipped < totals.ordered ? `${rxLabel} partial consignment dispatched` : `${rxLabel} consignment dispatched`,
        detail: `${totals.shipped} of ${totals.ordered} pack${totals.ordered === 1 ? '' : 's'} in transit`,
        date: prescription.latestShipmentAt ?? prescription.placedAt ?? null,
      });
    }
  }

  if (totals.received > 0) {
    const partialReceipt = totals.received < totals.ordered || totals.remaining > 0;
    const awaitingAtCuraleaf = totals.remaining > 0
      ? totals.remaining
      : Math.max(0, totals.ordered - totals.received);
    events.push({
      label: partialReceipt ? `${rxLabel} partially checked in` : `${rxLabel} delivered & checked in`,
      detail: partialReceipt
        ? `${totals.received} pack${totals.received === 1 ? '' : 's'} checked in; ${awaitingAtCuraleaf} remain with Curaleaf`
        : prescription.goodsInBy
          ? `Checked in by ${prescription.goodsInBy}`
          : 'Checked in at dispensary',
      date: prescription.goodsInAt ?? prescription.latestShipmentAt ?? null,
    });
  }

  for (const shipmentId of shipmentIds) {
    const state = prescription.shipmentStates?.[shipmentId];
    if (state !== 'ready_for_collection' && state !== 'collected') continue;
    const shipment = prescription.shipments?.find(item => item.id === shipmentId);
    const packs = shipment ? shipmentPackCount(shipment) : totals.received;
    events.push({
      label: `${rxLabel} ready to collect`,
      detail: `Consignment ${shortConsignmentId(shipmentId)} · ${packs} pack${packs === 1 ? '' : 's'} · collection email queued`,
      date: prescription.readyAt ?? prescription.goodsInAt ?? shipment?.createdAt ?? null,
    });
  }

  if (totals.collected > 0) {
    const partialHandout = totals.collected < totals.ordered;
    events.push({
      label: partialHandout ? `${rxLabel} partially handed to patient` : `${rxLabel} handed to patient`,
      detail: partialHandout
        ? `${totals.collected} of ${totals.ordered} pack${totals.ordered === 1 ? '' : 's'} collected; ${totals.ordered - totals.collected} remain on order`
        : handoutAt
          ? 'Dispensed and collected'
          : 'Dispensed and collected',
      date: handoutAt ?? prescription.readyAt ?? null,
    });
  } else if (prescription.status === 'collected') {
    events.push({
      label: `${rxLabel} handed to patient`,
      detail: 'Dispensed and collected',
      date: handoutAt ?? prescription.readyAt ?? null,
    });
  }

  return events;
}

export function buildOrderTimelineEvents(order: PatientOrder & { handoutAt?: Date | string | null }): OrderTimelineEvent[] {
  const events: OrderTimelineEvent[] = [
    {
      label: 'Order created',
      detail: `${order.prescriptions.length} prescription${order.prescriptions.length === 1 ? '' : 's'} prepared`,
      date: order.date,
    },
  ];

  if (order.payment.sentAt) {
    events.push({
      label: 'Payment requested',
      detail: order.payment.route === 'worldpay' ? 'Worldpay payment link created' : 'Pharmacy payment selected',
      date: order.payment.sentAt,
    });
  }
  if (order.payment.paidAt) {
    events.push({
      label: 'Payment cleared',
      detail: `£${order.payment.amount.toFixed(2)} received`,
      date: order.payment.paidAt,
    });
  }
  if (order.curaleafApprovedAt) {
    events.push({
      label: 'Curaleaf approved',
      detail: 'Delivery service window started',
      date: order.curaleafApprovedAt,
    });
  }
  if (order.cancellation) {
    events.push({
      label: 'Cancellation requested',
      detail: order.curaleafCancellation ? 'Curaleaf cancellation workflow opened' : 'Order cancellation recorded',
      date: order.cancellation.requestedAt,
    });
  }
  if (order.curaleafCancellation?.contactedAt) {
    events.push({
      label: 'Curaleaf contacted',
      detail: `Reference ${order.curaleafCancellation.contactReference ?? 'recorded'}`,
      date: order.curaleafCancellation.contactedAt,
    });
  }
  if (order.curaleafCancellation?.confirmedAt) {
    events.push({
      label: 'Curaleaf cancellation confirmed',
      detail: `Confirmation ${order.curaleafCancellation.confirmationReference ?? 'recorded'}`,
      date: order.curaleafCancellation.confirmedAt,
    });
  }

  order.prescriptions.forEach((prescription, index) => {
    events.push(...buildPrescriptionTimelineEvents(prescription, index, order.handoutAt));
  });

  if (order.handoutAt && !order.prescriptions.some(prescription => (prescription.fulfilmentLines ?? []).some(line => line.collected > 0))) {
    events.push({
      label: 'Medication handed out',
      detail: 'Collected by patient',
      date: order.handoutAt,
    });
  }

  return events.sort(
    (left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime(),
  );
}
