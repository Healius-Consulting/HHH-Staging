import { initializeApp, getApps } from 'firebase-admin/app';
import { dataConnect } from '../bootstrap/firebase.js';
import { SqlIntegrationRepository } from '../repositories/sql/integration.sql.js';
import { fetchCuraleafPurchaseOrders, fetchCuraleafShipments } from '../application/integrations/curaleaf.service.js';
import {
  advanceFulfilmentStatus,
  buildCuraleafSnapshot,
  matchShipments,
  mergePriorPharmacyLines,
  normalisedFulfilmentLines,
  pharmacyCountsKey,
  priorPurchaseOrderMatchesOrder,
  resolveLivePurchaseOrder,
  supplierFulfilmentStatus,
  syncSnapshotLineItemsFromPurchaseOrder,
} from '../application/orders/curaleaf-fulfilment.js';

const LIST_ORDERS_GQL = `
  query ListOrdersForCuraleafRepair($limit: Int!) {
    orders(limit: $limit) {
      id
      organisationId
      orderNumber
      paymentStatus
      fulfilmentStatus
      quoteSnapshot
    }
  }
`;

const UPDATE_ORDER_SNAPSHOT_GQL = `
  mutation UpdateOrderSnapshotForRepair(
    $id: UUID!
    $quoteSnapshot: Any
    $fulfilmentStatus: FulfilmentStatus
  ) {
    order_update(
      key: { id: $id }
      data: {
        quoteSnapshot: $quoteSnapshot
        fulfilmentStatus: $fulfilmentStatus
        updatedAt_expr: "request.time"
      }
    )
  }
`;

type OrderRow = {
  id: string;
  organisationId: string;
  orderNumber: string | null;
  paymentStatus: string;
  fulfilmentStatus: string | null;
  quoteSnapshot: Record<string, unknown> | null;
};

async function repair(apply: boolean) {
  if (!getApps().length) initializeApp({ projectId: 'hhh26-4ebd2' });

  const integrationRepo = new SqlIntegrationRepository();
  const connections = await integrationRepo.listConnections();
  const curaleafConnections = connections.filter(connection => connection.integration === 'CURALEAF' && connection.status === 'ACTIVE');
  if (!curaleafConnections.length) throw new Error('No connected Curaleaf integrations found.');

  const posByOrg = new Map<string, Awaited<ReturnType<typeof fetchCuraleafPurchaseOrders>>>();
  const shipmentsByOrg = new Map<string, Awaited<ReturnType<typeof fetchCuraleafShipments>>>();
  for (const connection of curaleafConnections) {
    posByOrg.set(connection.organisationId, await fetchCuraleafPurchaseOrders(connection));
    shipmentsByOrg.set(connection.organisationId, await fetchCuraleafShipments(connection));
  }

  const result = await dataConnect.executeGraphql<{ orders: OrderRow[] }, { limit: number }>(
    LIST_ORDERS_GQL,
    { variables: { limit: 500 } },
  );
  const orders = (result.data.orders || []).filter(order => {
    const status = String(order.paymentStatus || '').toUpperCase();
    return status === 'PAID' || status === 'AUTHORIZED' || status === 'CAPTURED';
  });

  const report: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const order of orders) {
    const purchaseOrders = posByOrg.get(order.organisationId) || [];
    const shipments = shipmentsByOrg.get(order.organisationId) || [];
    const snapshot = (order.quoteSnapshot && typeof order.quoteSnapshot === 'object' ? order.quoteSnapshot : {}) as Record<string, unknown>;
    const prior = snapshot.curaleaf && typeof snapshot.curaleaf === 'object'
      ? snapshot.curaleaf as Record<string, unknown>
      : {};

    const matchedPO = resolveLivePurchaseOrder(order, purchaseOrders, prior);
    const matchedShipments = matchShipments(order, matchedPO, shipments);
    const alignedSnapshot = syncSnapshotLineItemsFromPurchaseOrder(snapshot, matchedPO, order);
    const requestedItems = (alignedSnapshot.lineItems || alignedSnapshot.items || []) as Array<{
      packId?: string;
      productId?: string;
      quantity?: number;
      qty?: number;
      count?: number;
    }>;
    const liveShipments = matchedShipments.length
      ? matchedShipments
      : (Array.isArray(prior.shipments) ? prior.shipments as typeof matchedShipments : []);
    const priorValid = priorPurchaseOrderMatchesOrder(prior, order);
    const lines = normalisedFulfilmentLines({
      purchaseOrder: matchedPO,
      shipments: liveShipments,
      requestedItems,
      priorLines: mergePriorPharmacyLines(
        prior.lines,
        Object.values((alignedSnapshot.prescriptionFlow || {}) as Record<string, unknown>).flatMap(flow => {
          if (!flow || typeof flow !== 'object') return [];
          const typed = flow as Record<string, unknown>;
          return Array.isArray(typed.lines) ? typed.lines : [];
        }),
      ),
    });

    const shouldClear = !matchedPO && !priorValid && (prior.purchaseOrderId || prior.id);
    const shouldAttach = Boolean(matchedPO || (priorValid && liveShipments.length));
    if (!shouldAttach && !shouldClear) continue;

    const nextStatus = shouldAttach
      ? advanceFulfilmentStatus(
        order.fulfilmentStatus,
        supplierFulfilmentStatus({ purchaseOrder: matchedPO, shipments: liveShipments, lines }),
      )
      : order.fulfilmentStatus;
    const nextSnapshot = shouldAttach
      ? {
        ...alignedSnapshot,
        curaleaf: {
          ...buildCuraleafSnapshot({
            purchaseOrder: matchedPO,
            shipments: liveShipments,
            lines,
            shipmentStates: (prior.shipmentStates || {}) as Record<string, string>,
            order,
          }),
          lines,
          shipmentStates: prior.shipmentStates || {},
        },
      }
      : (() => {
        const { curaleaf: _removed, ...rest } = alignedSnapshot;
        return rest;
      })();

    report.push({
      orderNumber: order.orderNumber,
      orderId: order.id,
      action: shouldClear ? 'clear-stale-curaleaf' : 'resync',
      matchedPo: matchedPO?.customerReference || matchedPO?.id || null,
      priorPo: prior.customerReference || prior.purchaseOrderId || null,
      lines: lines.map(line => ({
        requested: line.requested,
        supplierOrdered: line.supplierReportedOrdered,
        shipped: line.shipped,
        mismatch: line.quantityMismatch,
      })),
    });

    if (apply) {
      await dataConnect.executeGraphql(UPDATE_ORDER_SNAPSHOT_GQL, {
        variables: {
          id: order.id,
          quoteSnapshot: nextSnapshot,
          fulfilmentStatus: nextStatus,
        },
      });
      updated += 1;
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: orders.length, candidates: report.length, updated, report }, null, 2));
}

const apply = process.argv.includes('--apply');
void repair(apply);
