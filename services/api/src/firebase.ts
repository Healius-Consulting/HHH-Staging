import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { config } from './config.js';

const projectId = config.FIREBASE_PROJECT_ID
  ?? process.env.GCLOUD_PROJECT
  ?? process.env.GOOGLE_CLOUD_PROJECT;
const storageBucket = config.FIREBASE_STORAGE_BUCKET
  ?? (projectId ? `${projectId}.firebasestorage.app` : undefined);

const firebaseApp = getApps()[0] ?? initializeApp({
  credential: applicationDefault(),
  projectId,
  storageBucket,
});

export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const appCheck = getAppCheck(firebaseApp);

firestore.settings({ ignoreUndefinedProperties: true });
