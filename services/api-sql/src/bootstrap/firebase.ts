import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDataConnect } from 'firebase-admin/data-connect';
import { config } from './config.js';

export const app: App = getApps().length === 0
  ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID })
  : getApps()[0]!;

export const auth = getAuth(app);

export const dataConnect = getDataConnect({
  serviceId: config.DATA_CONNECT_SERVICE_ID,
  location: config.DATA_CONNECT_LOCATION,
});
