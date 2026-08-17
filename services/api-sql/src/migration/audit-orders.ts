import { initializeApp, getApps } from 'firebase-admin/app';
import { dataConnect } from '../bootstrap/firebase.js';

const REFS = [
  'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
  'HHH-93eea688-3a39-4b1d-b998-e43cc16acf4b-c10dbf6885',
  'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
];

const LIST_ORDERS_GQL = `
  query ListOrders($limit: Int!) {
    orders(limit: $limit, orderBy: { createdAt: DESC }) {
      id
      organisationId
      orderNumber
      paymentStatus
      paymentRoute
      fulfilmentStatus
      paidAt
      collectedAt
      quoteSnapshot
    }
  }
`;

async function main() {
  if (!getApps().length) initializeApp({ projectId: 'hhh26-4ebd2' });

  const result = await dataConnect.executeGraphql<{ orders: Array<Record<string, unknown>> }, { limit: number }>(
    LIST_ORDERS_GQL,
    { variables: { limit: 500 } },
  );
  const orders = result.data.orders || [];

  for (const ref of REFS) {
    const match = orders.find(order => {
      const snap = (order.quoteSnapshot ?? {}) as Record<string, unknown>;
      const curaleaf = (snap.curaleaf ?? {}) as Record<string, unknown>;
      return order.orderNumber === ref
        || curaleaf.customerReference === ref
        || JSON.stringify(order.quoteSnapshot || {}).includes(ref);
    });

    if (!match) {
      console.log(JSON.stringify({ ref, found: false }));
      continue;
    }

    const snap = (match.quoteSnapshot ?? {}) as Record<string, unknown>;
    const cl = (snap.curaleaf ?? {}) as Record<string, unknown>;
    console.log(JSON.stringify({
      ref,
      found: true,
      id: match.id,
      organisationId: match.organisationId,
      orderNumber: match.orderNumber,
      paymentStatus: match.paymentStatus,
      paymentRoute: match.paymentRoute,
      fulfilmentStatus: match.fulfilmentStatus,
      paidAt: match.paidAt,
      collectedAt: match.collectedAt,
      curaleafId: cl.id || cl.purchaseOrderId,
      customerReference: cl.customerReference,
      poState: cl.state,
      shipments: Array.isArray(cl.shipments)
        ? cl.shipments.map((shipment: any) => ({ id: shipment.id, items: shipment.items }))
        : [],
      lines: cl.lines,
      shipmentStates: cl.shipmentStates,
    }, null, 2));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
