import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';

async function dumpOrgs() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const snap = await firestore.collection('organisations').get();
  console.log(`Total organisations in Firestore: ${snap.size}\n`);

  for (const doc of snap.docs) {
    console.log(`[Org ${doc.id}]:`, JSON.stringify(doc.data(), null, 2));
  }
}

void dumpOrgs();
