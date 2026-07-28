import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { app } from './app.js';
import { reconcilePendingCuraleafOrders } from './curaleaf-reconciliation.js';

export const api = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 2,
}, app);

export const reconcileCuraleafOrders = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'Europe/London',
  region: 'us-central1',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const summary = await reconcilePendingCuraleafOrders();
  console.log('Curaleaf reconciliation complete', summary);
});
