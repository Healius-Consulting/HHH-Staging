import {
  applyCancelledPurchaseOrderSnapshot,
  applyShipmentSnapshot,
  curaleafEntityRecord,
  curaleafEventKey,
  curaleafEventKinds,
  cursorAfterIso,
  eventPollBackoffSeconds,
  orderMatchesCancelledPurchaseOrder,
  shipmentBelongsToOrder,
  type CuraleafEventKind,
} from '../integrations/curaleaf-events.js';
import { listPharmacyRecipients, queueEmailToRecipients } from '../notifications/email-outbox.js';
import { curaleafApiRequest } from '../integrations/curaleaf.service.js';
import type { CuraleafPurchaseOrderLike, CuraleafShipmentLike } from '../orders/curaleaf-fulfilment.js';
import type { IdentityRepositoryPort } from '../../repositories/ports/identity.port.js';
import type { IntegrationConnectionRecord } from '../../repositories/ports/integration.port.js';
import type { NotificationRepositoryPort } from '../../repositories/ports/notification.port.js';
import type { OrganisationRepositoryPort } from '../../repositories/ports/organisation.port.js';
import type { OrderRepositoryPort } from '../../repositories/ports/order.port.js';
import { SqlWorkerEventRepository } from '../../repositories/sql/worker-event.sql.js';

export type CuraleafPollDeps = {
  orderRepo: OrderRepositoryPort;
  notificationRepo: NotificationRepositoryPort;
  identityRepo: IdentityRepositoryPort;
  organisationRepo: OrganisationRepositoryPort;
  events?: SqlWorkerEventRepository;
};

async function pollKind(
  connection: IntegrationConnectionRecord,
  kind: CuraleafEventKind,
  deps: CuraleafPollDeps,
) {
  const events = deps.events ?? new SqlWorkerEventRepository();
  const cursorKey = `worker:curaleaf-cursor:${connection.organisationId}:${kind}`;
  const cursor = await events.find(cursorKey);
  const after = cursorAfterIso(cursor?.transactionReference ?? cursor?.payloadHash);
  const page = await curaleafApiRequest<{ events?: Array<Record<string, unknown>> }>(
    connection,
    `${curaleafEventKinds[kind].route}?${new URLSearchParams({ after })}`,
  );
  if (!Array.isArray(page.events)) throw new Error(`Curaleaf returned an invalid ${kind} event page.`);
  let newest = Date.parse(after);
  let processed = 0;
  for (const event of page.events) {
    const entityId = event[curaleafEventKinds[kind].idField];
    const lastUpdated = event.lastUpdated;
    if (typeof entityId !== 'string' || typeof lastUpdated !== 'string' || !Number.isFinite(Date.parse(lastUpdated))) {
      throw new Error(`Curaleaf returned an invalid ${kind} event.`);
    }
    newest = Math.max(newest, Date.parse(lastUpdated));
    const eventKey = curaleafEventKey(connection.organisationId, kind, entityId, lastUpdated);
    if (await events.find(eventKey)) {
      newest = Math.max(newest, Date.parse(lastUpdated));
      continue;
    }
    if (kind !== 'product') {
      const raw = await curaleafApiRequest<unknown>(
        connection,
        `${curaleafEventKinds[kind].detailRoute}${encodeURIComponent(entityId)}/`,
      );
      const record = curaleafEntityRecord(raw, kind);
      if (kind === 'purchaseOrder' && record.state === 'CANCELLED') {
        const orders = await deps.orderRepo.listTenantOrders(connection.organisationId, 500);
        for (const order of orders) {
          if (!orderMatchesCancelledPurchaseOrder(order, record as CuraleafPurchaseOrderLike)) continue;
          await deps.orderRepo.updateQuoteSnapshot({
            id: order.id,
            organisationId: order.organisationId,
            quoteSnapshot: applyCancelledPurchaseOrderSnapshot(order.quoteSnapshot, record as CuraleafPurchaseOrderLike),
            fulfilmentStatus: 'EXCEPTION',
          });
        }
      }
      if (kind === 'shipment') {
        const orders = await deps.orderRepo.listTenantOrders(connection.organisationId, 500);
        for (const order of orders) {
          if (!shipmentBelongsToOrder(order, record as CuraleafShipmentLike)) continue;
          const next = applyShipmentSnapshot(order, record as CuraleafShipmentLike);
          await deps.orderRepo.updateQuoteSnapshot({
            id: order.id,
            organisationId: order.organisationId,
            quoteSnapshot: next.snapshot,
            fulfilmentStatus: next.fulfilmentStatus,
          });
          if (
            next.fulfilmentStatus !== order.fulfilmentStatus &&
            ['PARTIALLY_DISPATCHED_TO_PHARMACY', 'DISPATCHED_TO_PHARMACY'].includes(next.fulfilmentStatus)
          ) {
            const recipients = await listPharmacyRecipients(order.organisationId, deps);
            await queueEmailToRecipients(
              deps.notificationRepo,
              recipients,
              'pharmacy_order_dispatched',
              {
                orderNumber: order.orderNumber,
                summary: next.fulfilmentStatus === 'PARTIALLY_DISPATCHED_TO_PHARMACY'
                  ? 'A partial order has been dispatched.'
                  : 'An order has been dispatched.',
              },
              ['pharmacy-order-dispatched', order.id, (record as CuraleafShipmentLike).id, next.fulfilmentStatus],
              { organisationId: order.organisationId, patientId: order.patientId, orderId: order.id },
            );
          }
        }
      }
    }
    await events.remember({
      eventKey,
      integration: 'CURALEAF',
      organisationId: connection.organisationId,
      payloadHash: lastUpdated,
      status: 'SUCCEEDED',
    });
    processed += 1;
  }
  await events.upsertCursor({
    eventKey: cursorKey,
    integration: 'CURALEAF',
    organisationId: connection.organisationId,
    cursorAt: new Date(Number.isFinite(newest) ? newest : Date.now()).toISOString(),
  });
  return { kind, events: page.events.length, processed };
}

export async function pollCuraleafEvents(
  connection: IntegrationConnectionRecord,
  deps: CuraleafPollDeps,
) {
  const results = [];
  for (const kind of Object.keys(curaleafEventKinds) as CuraleafEventKind[]) {
    results.push(await pollKind(connection, kind, deps));
  }
  return { organisationId: connection.organisationId, results, completedAt: new Date().toISOString() };
}

export { eventPollBackoffSeconds };
