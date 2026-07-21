import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.js';

export const api = onRequest({
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '512MiB',
  maxInstances: 20,
}, app);
