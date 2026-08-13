import { createHash } from 'node:crypto';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { calculatePrescriptionExpiry } from './placement-engine.js';

export async function migrateMasterFlowV2() {
  const snapshot = await firestore.collection('orders').limit(5_000).get();
  const summary = { checked: snapshot.size, migrated: 0, skipped: 0 };
  for (const document of snapshot.docs) {
    const order = document.data();
    if (order.masterFlowVersion === 2 || !Array.isArray(order.prescriptions)) {
      summary.skipped += 1;
      continue;
    }
    const existingFlow = order.prescriptionFlow && typeof order.prescriptionFlow === 'object' ? order.prescriptionFlow as Record<string, Record<string, unknown>> : {};
    const prescriptions: Array<Record<string, unknown> & { id: string }> = (order.prescriptions as Array<Record<string, unknown>>).map((prescription, index) => {
      const id = typeof prescription.id === 'string'
        ? prescription.id
        : typeof prescription.fileId === 'string'
          ? prescription.fileId
          : createHash('sha256').update(`${document.id}:${prescription.serialNumber ?? index}`).digest('hex').slice(0, 32);
      return { ...prescription, id, expiryDate: typeof prescription.issueDate === 'string' ? calculatePrescriptionExpiry(prescription.issueDate, typeof prescription.expiryDate === 'string' ? prescription.expiryDate : undefined) : prescription.expiryDate, payable: prescription.payable !== false };
    });
    const prescriptionFlow = Object.fromEntries(prescriptions.map(prescription => {
      const current = existingFlow[String(prescription.id)] ?? {};
      const curaleaf = order.curaleafSubOrders && typeof order.curaleafSubOrders === 'object' ? (order.curaleafSubOrders as Record<string, Record<string, unknown>>)[String(prescription.id)] : null;
      const state = order.paymentStatus !== 'paid' ? 'AWAITING_PAYMENT'
        : order.fulfilmentStatus === 'collected' ? 'COLLECTED'
          : order.fulfilmentStatus === 'ready_for_collection' ? 'READY_FOR_COLLECTION'
            : curaleaf?.purchaseOrderId ? 'PLACED' : 'PAID';
      return [prescription.id, {
        id: prescription.id,
        state: current.state ?? state,
        payable: current.payable ?? prescription.payable !== false,
        expiryDate: current.expiryDate ?? prescription.expiryDate,
        purchaseOrderId: current.purchaseOrderId ?? curaleaf?.purchaseOrderId ?? null,
        shipmentIds: current.shipmentIds ?? curaleaf?.shipmentIds ?? [],
        lines: current.lines ?? (Array.isArray(prescription.items) ? prescription.items.map((item: Record<string, unknown>, index: number) => ({ lineId: createHash('sha256').update(`${document.id}:${prescription.id}:${item.packId ?? index}`).digest('hex').slice(0, 32), productId: item.packId, ordered: Number(item.quantity ?? 0), allocated: 0, shipped: 0, returned: 0, received: 0, collected: 0, backordered: false })) : []),
        renewal: current.renewal ?? { state: 'none' },
        collectedAt: current.collectedAt ?? (state === 'COLLECTED' ? order.collectedAt ?? order.updatedAt : null),
        updatedAt: nowIso(),
      }];
    }));
    await document.ref.set({ prescriptions, prescriptionFlow, masterFlowVersion: 2, masterFlowMigratedAt: nowIso(), updatedAt: order.updatedAt ?? nowIso() }, { merge: true });
    summary.migrated += 1;
  }
  return summary;
}
