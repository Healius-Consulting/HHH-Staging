import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { app } from './app.js';
import { reconcilePendingCuraleafOrders } from './curaleaf-reconciliation.js';
import { accrueAnnualPatientFees } from './patient-finance.js';
import { cleanupAbandonedPrescriptionFiles } from './prescription-file-cleanup.js';

export const apiLondon = onRequest({
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 2,
}, app);

export const reconcileCuraleafOrdersLondon = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const summary = await reconcilePendingCuraleafOrders();
  console.log('Curaleaf reconciliation complete', summary);
});

export const accrueAnnualPatientFeesLondon = onSchedule({
  schedule: '30 2 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  const summary = await accrueAnnualPatientFees();
  console.log('Annual patient fee accrual complete', summary);
});

export const cleanupPrescriptionFilesLondon = onSchedule({
  schedule: '30 3 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  const summary = await cleanupAbandonedPrescriptionFiles();
  console.log('Prescription file cleanup complete', summary);
});
