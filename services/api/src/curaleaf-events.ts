import { createHash } from 'node:crypto';
import { CuraleafRequestError, curaleafRequest } from './curaleaf.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { invalidateCache } from './cache.js';

const CURSOR_OVERLAP_MS = 2_000;
const INITIAL_LOOKBACK_MS = 5 * 60_000;

const eventKinds = {
  product: { route: '/v1/product-events/', idField: 'productId', detailRoute: '/v1/products/', collection: 'curaleafProducts' },
  prescription: { route: '/v1/prescription-events/', idField: 'prescriptionId', detailRoute: '/v1/prescriptions/', collection: 'curaleafPrescriptions' },
  purchaseOrder: { route: '/v1/purchase-order-events/', idField: 'purchaseOrderId', detailRoute: '/v1/purchase-orders/', collection: 'curaleafPurchaseOrders' },
  shipment: { route: '/v1/shipment-events/', idField: 'shipmentId', detailRoute: '/v1/shipments/', collection: 'curaleafShipments' },
} as const;

type EventKind = keyof typeof eventKinds;

function documentId(...parts: string[]) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function entityRecord(value: unknown, kind: EventKind) {
  if (!value || typeof value !== 'object') throw new Error(`Curaleaf returned an invalid ${kind} detail response.`);
  const record = value as Record<string, unknown>;
  const singular = kind === 'purchaseOrder' ? 'purchaseOrder' : kind;
  const nested = record[singular];
  const result = nested && typeof nested === 'object' ? nested as Record<string, unknown> : record;
  if (typeof result.id !== 'string') throw new Error(`Curaleaf returned a ${kind} record without an id.`);
  return result;
}

async function pollEventKind(organisationId: string, kind: EventKind) {
  const definition = eventKinds[kind];
  const cursorDocument = firestore.collection('curaleafEventCursors').doc(`${organisationId}--${kind}`);
  const cursorSnapshot = await cursorDocument.get();
  const cursorValue = Date.parse(String(cursorSnapshot.data()?.cursorAt ?? ''));
  const after = new Date((Number.isFinite(cursorValue) ? cursorValue : Date.now() - INITIAL_LOOKBACK_MS) - CURSOR_OVERLAP_MS).toISOString();
  const page = await curaleafRequest<{ events?: Array<Record<string, unknown>> }>(organisationId, `${definition.route}?${new URLSearchParams({ after })}`);
  if (!Array.isArray(page.events)) throw new Error(`Curaleaf returned an invalid ${kind} event page.`);
  let newest = Number.isFinite(cursorValue) ? cursorValue : Date.parse(after);
  let processed = 0;
  for (const event of page.events) {
    const entityId = event[definition.idField];
    const lastUpdated = event.lastUpdated;
    if (typeof entityId !== 'string' || typeof lastUpdated !== 'string' || !Number.isFinite(Date.parse(lastUpdated))) {
      throw new Error(`Curaleaf returned an invalid ${kind} event.`);
    }
    const eventId = documentId(organisationId, kind, entityId, lastUpdated);
    const eventDocument = firestore.collection('curaleafEvents').doc(eventId);
    if (!(await eventDocument.get()).exists) {
      const raw = await curaleafRequest<unknown>(organisationId, `${definition.detailRoute}${encodeURIComponent(entityId)}/`);
      const record = entityRecord(raw, kind);
      await firestore.collection(definition.collection).doc(documentId(organisationId, String(record.id))).set({
        ...record,
        organisationId,
        supplierId: record.id,
        source: 'curaleaf',
        syncedAt: nowIso(),
        schemaVersion: 1,
      }, { merge: true });
      await eventDocument.create({ organisationId, kind, entityId, lastUpdated, processedAt: nowIso(), schemaVersion: 1 });
      processed += 1;
    }
    newest = Math.max(newest, Date.parse(lastUpdated));
  }
  await cursorDocument.set({ organisationId, kind, cursorAt: new Date(newest).toISOString(), lastPolledAt: nowIso(), schemaVersion: 1 }, { merge: true });
  if (kind === 'product' && processed > 0) invalidateCache(`curaleaf:catalog:${organisationId}`);
  return { kind, events: page.events.length, processed };
}

export async function pollCuraleafEvents(organisationId: string) {
  const results = [];
  // Keep poll lightweight — full order reconciliation runs on the 5-minute schedule.
  for (const kind of Object.keys(eventKinds) as EventKind[]) results.push(await pollEventKind(organisationId, kind));
  return { organisationId, results, completedAt: nowIso() };
}

export function eventPollBackoffSeconds(error: unknown, priorFailures: number) {
  if (error instanceof CuraleafRequestError && error.status === 429) return error.retryAfterSeconds ?? Math.min(300, 10 * 2 ** Math.min(priorFailures, 5));
  return Math.min(300, 10 * 2 ** Math.min(priorFailures, 5));
}
