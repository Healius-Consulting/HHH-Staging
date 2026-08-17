#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCuraleafSnapshot,
  normalisedFulfilmentLines,
  supplierFulfilmentStatus,
  syncSnapshotLineItemsFromPurchaseOrder,
} from '../services/api-sql/src/application/orders/curaleaf-fulfilment.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const refs = [
  'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
  'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
];

function runDataconnect(gqlFile, operation, variables) {
  const varsPath = join(root, 'tmp-repair-vars.json');
  writeFileSync(varsPath, JSON.stringify(variables));
  const output = execFileSync('firebase', [
    'dataconnect:execute', gqlFile, operation,
    '--service', 'hhh-platform-service',
    '--location', 'europe-west2',
    '--project', 'hhh26-4ebd2',
    '--variables', `@${varsPath}`,
    '--no-debug-details',
  ], { cwd: root, encoding: 'utf8' });
  return JSON.parse(output.slice(output.indexOf('{')));
}

const listResult = runDataconnect('tmp-audit-orders.gql', 'AuditOrdersByReference', { limit: 500 });
const orders = (listResult.data?.orders || []).filter(order => refs.includes(order.orderNumber));

for (const order of orders) {
  const snapshot = structuredClone(order.quoteSnapshot || {});
  const priorCuraleaf = snapshot.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : {};
  const purchaseOrder = {
    id: priorCuraleaf.purchaseOrderId,
    state: priorCuraleaf.purchaseOrderState,
    customerReference: priorCuraleaf.customerReference || order.orderNumber,
    items: priorCuraleaf.items || priorCuraleaf.supplierItems || [],
  };
  const alignedSnapshot = syncSnapshotLineItemsFromPurchaseOrder(snapshot, purchaseOrder, order);
  const requestedItems = (alignedSnapshot.lineItems || alignedSnapshot.items || []).map((item) => ({
    packId: item.packId || item.productId,
    productId: item.productId || item.packId,
    quantity: item.quantity || item.qty,
  }));
  const shipments = Array.isArray(priorCuraleaf.shipments) ? priorCuraleaf.shipments : [];
  const lines = normalisedFulfilmentLines({
    purchaseOrder,
    shipments,
    requestedItems,
    priorLines: [],
  });
  const nextStatus = supplierFulfilmentStatus({ purchaseOrder, shipments, lines });
  const nextSnapshot = {
    ...alignedSnapshot,
    curaleaf: {
      ...buildCuraleafSnapshot({
        purchaseOrder,
        shipments,
        lines,
        shipmentStates: {},
        order,
      }),
      lines,
      shipmentStates: {},
    },
  };

  console.log('Repairing', order.orderNumber, '->', nextStatus);
  runDataconnect('tmp-repair-order.gql', 'RepairOrderSnapshot', {
    id: order.id,
    quoteSnapshot: nextSnapshot,
    fulfilmentStatus: nextStatus,
    collectedAt: null,
  });
}

console.log('Done.');
