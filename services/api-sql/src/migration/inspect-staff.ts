import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../bootstrap/config.js';

async function inspectStaff() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);
  const auth = getAuth(app);

  const snap = await firestore.collection('staffUsers').get();
  console.log(`Total staff users in Firestore: ${snap.size}\n`);

  for (const doc of snap.docs) {
    const data = doc.data();
    let authUser = null;
    try {
      authUser = await auth.getUser(doc.id);
    } catch {
      // ignore
    }

    console.log(`[Staff ${doc.id}]:`, JSON.stringify({
      email: data.email,
      displayName: data.displayName || data.name,
      role: data.role,
      organisationId: data.organisationId || data.pharmacyId,
      status: data.status,
      disabled: data.disabled,
      customClaims: authUser?.customClaims,
      firestoreKeys: Object.keys(data),
    }, null, 2));
  }
}

void inspectStaff();
