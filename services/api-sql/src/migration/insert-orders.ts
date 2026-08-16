import { createHash } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id.toLowerCase();
  }
  const hash = createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const CREATE_ORDER_GQL = `
  mutation CreateOrderDirect(
    $id: UUID!
    $organisationId: UUID!
    $patientId: UUID!
    $orderNumber: String
    $status: OrderStatus!
    $paymentStatus: PaymentStatus!
    $fulfilmentStatus: FulfilmentStatus!
    $paymentRoute: PaymentRoute!
    $currency: String!
    $medicineTotalPence: Int64!
    $dispensingFeePence: Int64!
    $deliveryPence: Int64!
    $taxPence: Int64!
    $totalPence: Int64!
    $quoteSnapshot: Any
    $createdByUid: String!
  ) {
    order_insert(data: {
      id: $id
      organisationId: $organisationId
      patientId: $patientId
      orderNumber: $orderNumber
      status: $status
      paymentStatus: $paymentStatus
      fulfilmentStatus: $fulfilmentStatus
      paymentRoute: $paymentRoute
      currency: $currency
      medicineTotalPence: $medicineTotalPence
      dispensingFeePence: $dispensingFeePence
      deliveryPence: $deliveryPence
      taxPence: $taxPence
      totalPence: $totalPence
      quoteSnapshot: $quoteSnapshot
      createdByUid: $createdByUid
      submittedAt_expr: "request.time"
    })
  }
`;

async function insertOrders() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const fallbackStaffUid = '0kDU33LMi5VSCF8GKegfH8b9E1z1'; // Valid migrated staff user

  const ordersSnap = await firestore.collection('orders').get();
  let countOrders = 0;

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const hasCuraleaf = Boolean(
      data.curaleaf?.purchaseOrderId ||
      data.curaleaf?.status === 'purchase_order_submitted' ||
      data.curaleafPoNumber ||
      data.curaleafOrderId
    );

    if (!hasCuraleaf) continue;

    const statusMap: Record<string, string> = {
      open: 'SUBMITTED',
      submitted: 'SUBMITTED',
      completed: 'COMPLETED',
      cancelled: 'CANCELLED',
      rejected: 'CANCELLED',
    };

    const paymentStatusMap: Record<string, string> = {
      paid: 'PAID',
      pending: 'PENDING',
      refunded: 'REFUNDED',
      expired: 'CANCELLED',
      failed: 'FAILED',
    };

    const fulfilmentStatusMap: Record<string, string> = {
      supplier_processing: 'SUPPLIER_PROCESSING',
      supplier_allocated: 'SUPPLIER_PROCESSING',
      supplier_pending: 'SUPPLIER_PENDING',
      dispatched: 'DISPATCHED_TO_PHARMACY',
      received: 'RECEIVED',
      exception: 'EXCEPTION',
    };

    const status = statusMap[data.status] || 'SUBMITTED';
    const paymentStatus = paymentStatusMap[data.paymentStatus] || 'PAID';
    const fulfilmentStatus = fulfilmentStatusMap[data.fulfilmentStatus] || 'SUPPLIER_PROCESSING';
    const paymentRoute = data.paymentRoute === 'worldpay' ? 'WORLDPAY' : 'MANUAL';
    const patientUuid = toDeterministicUuid(data.patientId || 'patient-placeholder');
    const orderUuid = toDeterministicUuid(doc.id);
    const createdByUid = data.createdByUid || data.primaryContactUid || fallbackStaffUid;

    try {
      await dataConnect.executeGraphql<any, any>(CREATE_ORDER_GQL, {
        variables: {
          id: orderUuid,
          organisationId: data.organisationId || data.pharmacyId || '70913a30-71c3-4a41-952e-d532927af58c',
          patientId: patientUuid,
          orderNumber: data.orderNumber || data.curaleaf?.customerReference || `ORD-${doc.id.slice(0, 8)}`,
          status,
          paymentStatus,
          fulfilmentStatus,
          paymentRoute,
          currency: data.currency || 'GBP',
          medicineTotalPence: data.medicineTotalPence || data.totalPence || 0,
          dispensingFeePence: data.dispensingFeePence || 0,
          deliveryPence: data.deliveryPence || 0,
          taxPence: data.taxPence || 0,
          totalPence: data.totalPence || 0,
          quoteSnapshot: data.pricingQuote || data.curaleaf?.quote || null,
          createdByUid: fallbackStaffUid,
        },
      });
      countOrders++;
      console.log(`✔ Inserted Curaleaf Order: ${orderUuid} (PO: ${data.curaleaf?.purchaseOrderId})`);
    } catch (e: any) {
      console.warn(`  - Order ${orderUuid} error:`, e?.message);
    }
  }

  console.log(`\nSuccessfully populated ${countOrders} Curaleaf orders in PostgreSQL Order table!`);
}

void insertOrders();
