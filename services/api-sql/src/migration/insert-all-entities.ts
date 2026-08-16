import { createHash } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

function toDeterministicUuid(id: string): string {
  // If already standard UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id.toLowerCase();
  }
  // Otherwise MD5/SHA256 hex to valid UUID
  const hash = createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const CREATE_STAFF_USER_GQL = `
  mutation CreateStaffUserDirect(
    $uid: String!
    $organisationId: UUID
    $email: String!
    $displayName: String!
    $role: StaffRole!
    $status: StaffStatus!
    $disabled: Boolean!
  ) {
    staffUser_insert(data: {
      uid: $uid
      organisationId: $organisationId
      email: $email
      displayName: $displayName
      role: $role
      status: $status
      disabled: $disabled
    })
  }
`;

const CREATE_PATIENT_GQL = `
  mutation CreatePatientDirect(
    $id: UUID!
    $organisationId: UUID!
    $firstName: String!
    $surname: String!
    $dob: Date!
    $email: String!
    $mobile: String!
    $address: String
    $postcode: String!
    $status: PatientStatus!
  ) {
    patient_insert(data: {
      id: $id
      organisationId: $organisationId
      firstName: $firstName
      surname: $surname
      dob: $dob
      email: $email
      mobile: $mobile
      address: $address
      postcode: $postcode
      status: $status
      activatedAt_expr: "request.time"
    })
  }
`;

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

async function insertAll() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  console.log('Starting full direct database backfill into PostgreSQL...\n');

  // 1. Staff Users
  const staffSnap = await firestore.collection('staffUsers').get();
  console.log(`Found ${staffSnap.size} staff users in Firestore.`);
  for (const doc of staffSnap.docs) {
    const data = doc.data();
    try {
      const role = data.role === 'admin' || data.role === 'HHH_ADMIN' ? 'HHH_ADMIN' : 'PHARMACY_STAFF';
      const status = data.disabled ? 'DISABLED' : (data.status === 'invited' ? 'INVITED' : 'ACTIVE');
      await dataConnect.executeGraphql<any, any>(CREATE_STAFF_USER_GQL, {
        variables: {
          uid: doc.id,
          organisationId: data.organisationId || data.pharmacyId || null,
          email: data.email || `${doc.id}@example.com`,
          displayName: data.displayName || data.name || 'Staff User',
          role,
          status,
          disabled: Boolean(data.disabled),
        },
      });
      console.log(`✔ Inserted StaffUser: ${doc.id} (${data.email})`);
    } catch (e: any) {
      console.warn(`  - Staff user ${doc.id} already exists`);
    }
  }

  // 2. Patients
  const patientsSnap = await firestore.collection('patients').get();
  console.log(`\nFound ${patientsSnap.size} patients in Firestore.`);
  for (const doc of patientsSnap.docs) {
    const data = doc.data();
    const patientUuid = toDeterministicUuid(doc.id);
    try {
      const status = data.status === 'archived' ? 'ARCHIVED' : (data.status === 'suspended' ? 'SUSPENDED' : 'ACTIVE');
      await dataConnect.executeGraphql<any, any>(CREATE_PATIENT_GQL, {
        variables: {
          id: patientUuid,
          organisationId: data.organisationId || data.pharmacyId || '70913a30-71c3-4a41-952e-d532927af58c',
          firstName: data.firstName || 'Patient',
          surname: data.surname || data.lastName || 'User',
          dob: data.dob || '1990-01-01',
          email: data.email || `${doc.id}@example.com`,
          mobile: data.mobile || '+447000000000',
          address: data.address || 'London, UK',
          postcode: data.postcode || 'SW1A 1AA',
          status,
        },
      });
      console.log(`✔ Inserted Patient: ${patientUuid} (${data.firstName} ${data.surname})`);
    } catch (e: any) {
      console.warn(`  - Patient ${patientUuid} already exists`);
    }
  }

  // 3. Orders (Curaleaf Purchase Orders)
  const ordersSnap = await firestore.collection('orders').get();
  console.log(`\nFound ${ordersSnap.size} total orders in Firestore.`);
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
          createdByUid: data.createdByUid || data.primaryContactUid || 'system:migration',
        },
      });
      countOrders++;
      console.log(`✔ Inserted Curaleaf Order: ${orderUuid} (PO: ${data.curaleaf?.purchaseOrderId})`);
    } catch (e: any) {
      console.warn(`  - Order ${orderUuid} error:`, e?.message);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Direct database population complete! Total Curaleaf Orders inserted: ${countOrders}`);
  console.log(`==================================================`);
}

void insertAll();
