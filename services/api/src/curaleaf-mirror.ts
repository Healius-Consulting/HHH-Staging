import { config } from './config.js';
import { curaleafList } from './curaleaf.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';

type CuraleafRecord = Record<string, unknown> & { id: string };

export type CuraleafAccountSnapshot = {
  environment: 'test' | 'production';
  fetchedAt: string;
  prescribers: CuraleafRecord[];
  prescriptions: CuraleafRecord[];
  purchaseOrders: CuraleafRecord[];
  shipments: CuraleafRecord[];
  prescriberTotal: number;
  prescriptionTotal: number;
  purchaseOrderTotal: number;
  shipmentTotal: number;
};

const mirrorCollections = {
  prescribers: 'curaleafPrescribers',
  prescriptions: 'curaleafPrescriptions',
  purchaseOrders: 'curaleafPurchaseOrders',
  shipments: 'curaleafShipments',
} as const;

function authenticRecords(records: Array<Record<string, unknown>>, label: string): CuraleafRecord[] {
  return records.map(record => {
    if (typeof record.id !== 'string' || !record.id) {
      throw new Error(`Curaleaf returned a ${label} record without an id.`);
    }
    return record as CuraleafRecord;
  });
}

export async function persistCuraleafAccountSnapshot(
  organisationId: string,
  snapshot: CuraleafAccountSnapshot,
) {
  const writer = firestore.bulkWriter();
  for (const [key, collection] of Object.entries(mirrorCollections) as Array<
    [keyof typeof mirrorCollections, string]
  >) {
    for (const record of snapshot[key]) {
      writer.set(firestore.collection(collection).doc(record.id), {
        ...record,
        organisationId,
        source: 'curaleaf',
        sourceEnvironment: snapshot.environment,
        syncedAt: snapshot.fetchedAt,
        schemaVersion: 1,
      });
    }
  }
  writer.set(firestore.collection('curaleafSyncState').doc(organisationId), {
    organisationId,
    environment: snapshot.environment,
    lastSyncedAt: snapshot.fetchedAt,
    prescriberTotal: snapshot.prescriberTotal,
    prescriptionTotal: snapshot.prescriptionTotal,
    purchaseOrderTotal: snapshot.purchaseOrderTotal,
    shipmentTotal: snapshot.shipmentTotal,
    source: 'curaleaf',
    schemaVersion: 1,
  });
  await writer.close();
}

export async function fetchCuraleafAccountSnapshot(
  organisationId: string,
): Promise<CuraleafAccountSnapshot> {
  const [prescriberPage, prescriptionPage, purchaseOrderPage, shipmentPage] = await Promise.all([
    curaleafList<Record<string, unknown>>(organisationId, '/v1/prescribers/', 'prescribers'),
    curaleafList<Record<string, unknown>>(organisationId, '/v1/prescriptions/', 'prescriptions'),
    curaleafList<Record<string, unknown>>(organisationId, '/v1/purchase-orders/', 'purchaseOrders'),
    curaleafList<Record<string, unknown>>(organisationId, '/v1/shipments/', 'shipments'),
  ]);
  const snapshot: CuraleafAccountSnapshot = {
    environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production',
    fetchedAt: nowIso(),
    prescribers: authenticRecords(prescriberPage.records, 'prescriber'),
    prescriptions: authenticRecords(prescriptionPage.records, 'prescription'),
    purchaseOrders: authenticRecords(purchaseOrderPage.records, 'purchase order'),
    shipments: authenticRecords(shipmentPage.records, 'shipment'),
    prescriberTotal: prescriberPage.totalRecordCount,
    prescriptionTotal: prescriptionPage.totalRecordCount,
    purchaseOrderTotal: purchaseOrderPage.totalRecordCount,
    shipmentTotal: shipmentPage.totalRecordCount,
  };
  await persistCuraleafAccountSnapshot(organisationId, snapshot);
  return snapshot;
}

export async function syncConnectedCuraleafAccounts() {
  const connections = await firestore.collection('integrationConnections')
    .where('integration', '==', 'curaleaf')
    .get();
  let synced = 0;
  let failed = 0;
  for (const connection of connections.docs) {
    const data = connection.data();
    if (data.status !== 'connected' || typeof data.organisationId !== 'string') continue;
    try {
      await fetchCuraleafAccountSnapshot(data.organisationId);
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error('Curaleaf account mirror failed', {
        organisationId: data.organisationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return { synced, failed };
}
