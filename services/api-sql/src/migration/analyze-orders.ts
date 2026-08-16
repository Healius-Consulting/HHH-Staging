import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';

async function analyze() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const snap = await firestore.collection('orders').get();
  console.log(`Total orders in Firestore: ${snap.size}\n`);

  let countWithCuraleaf = 0;
  let countCancelled = 0;
  let countOpen = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasCuraleaf = Boolean(data.curaleaf?.purchaseOrderId || data.curaleaf?.status || data.curaleafPoNumber || data.curaleafOrderId);
    const isCancelled = data.status === 'cancelled' || data.status === 'CANCELLED' || data.status === 'rejected' || data.status === 'REJECTED';
    const isOpen = data.status === 'open' || data.status === 'OPEN' || data.status === 'submitted' || data.status === 'SUBMITTED' || data.status === 'completed' || data.status === 'COMPLETED';

    if (hasCuraleaf) countWithCuraleaf++;
    if (isCancelled) countCancelled++;
    if (isOpen) countOpen++;

    console.log(`[Order ${doc.id}] status=${data.status}, paymentStatus=${data.paymentStatus}, fulfilmentStatus=${data.fulfilmentStatus}, hasCuraleaf=${hasCuraleaf}, PO=${data.curaleaf?.purchaseOrderId || 'none'}, PO_State=${data.curaleaf?.purchaseOrderState || 'none'}`);
  }

  console.log(`\nSummary: Total=${snap.size}, With Curaleaf PO/Submission=${countWithCuraleaf}, Open=${countOpen}, Cancelled/Refunded=${countCancelled}`);
}

void analyze();
