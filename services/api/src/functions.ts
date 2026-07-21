import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.js';

export const api = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 2,
}, app);
