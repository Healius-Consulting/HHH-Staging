import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';

async function purgeNonCuraleafOrders() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const snap = await firestore.collection('orders').get();
  console.log(`Checking ${snap.size} Firestore orders...\n`);

  let deletedCount = 0;
  let preservedCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasCuraleaf = Boolean(
      data.curaleaf?.purchaseOrderId ||
      data.curaleaf?.status === 'purchase_order_submitted' ||
      data.curaleafPoNumber ||
      data.curaleafOrderId
    );

    if (!hasCuraleaf) {
      await firestore.collection('orders').doc(doc.id).delete();
      deletedCount++;
      console.log(`🗑 Deleted draft/test order: ${doc.id} (Status: ${data.status})`);
    } else {
      preservedCount++;
      console.log(`✔ Preserved Curaleaf order: ${doc.id} (PO: ${data.curaleaf?.purchaseOrderId})`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Cleanup complete! Deleted: ${deletedCount}, Preserved in Firestore: ${preservedCount}`);
  console.log(`==================================================`);
}

void purgeNonCuraleafOrders();
