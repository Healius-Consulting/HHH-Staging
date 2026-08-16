import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';

async function checkFirestore() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const collections = await firestore.listCollections();
  console.log(`Remaining Firestore collections: ${collections.length}`);
  for (const coll of collections) {
    console.log(`- ${coll.id}`);
  }
}

void checkFirestore();
