import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';

async function inspect() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const snap = await firestore.collection('orders').get();
  console.log(`Total orders in Firestore: ${snap.size}\n`);

  for (const doc of snap.docs) {
    const data = doc.data();
    console.log(`[Order ${doc.id}]:`, JSON.stringify({
      orderNumber: data.orderNumber,
      status: data.status,
      paymentStatus: data.paymentStatus,
      fulfilmentStatus: data.fulfilmentStatus,
      organisationId: data.organisationId || data.pharmacyId,
      curaleafPoNumber: data.curaleafPoNumber,
      curaleafOrderId: data.curaleafOrderId,
      curaleaf: data.curaleaf,
      integration: data.integration,
      supplierPurchaseOrderId: data.supplierPurchaseOrderId,
      supplierStatus: data.supplierStatus,
      isTest: data.isTest || data.test,
      keys: Object.keys(data),
    }, null, 2));
  }
}

void inspect();
