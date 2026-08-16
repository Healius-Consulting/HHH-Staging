import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './bootstrap/app.js';

const app = createApp();

export const apiLondon = onRequest({
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 10,
}, app);
