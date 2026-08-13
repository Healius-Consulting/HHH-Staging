import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { app, auditLiveOrganisationGates } from './app.js';
import { config } from './config.js';
import { eventPollBackoffSeconds, pollCuraleafEvents } from './curaleaf-events.js';
import { reconcilePendingCuraleafOrders } from './curaleaf-reconciliation.js';
import { accrueAnnualPatientFees, updatePatientRetentionStates } from './patient-finance.js';
import { cleanupAbandonedPrescriptionFiles } from './prescription-file-cleanup.js';
import { reconcilePendingWorldpayPayments } from './worldpay-reconciliation.js';
import { syncConnectedCuraleafAccounts } from './curaleaf-mirror.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { processPendingPaymentLifecycle } from './payment-lifecycle.js';
import { maintainPaidOrderFlow } from './order-maintenance.js';
import { deliverPatientMessages } from './notification-delivery.js';

/** HHH cadence: 1 minute (Curaleaf recommends 10s; we poll slower to stay under ~1 req/s). */
const EVENT_POLL_INTERVAL_SECONDS = 60;
const eventPollingEnabled = config.CURALEAF_EVENT_POLLING_ENABLED === 'true';

async function enqueueCuraleafPoll(organisationId: string, delaySeconds: number) {
  const queue = getFunctions().taskQueue('pollCuraleafEventsLondon');
  await queue.enqueue({ organisationId }, { scheduleDelaySeconds: Math.max(0, Math.ceil(delaySeconds)), dispatchDeadlineSeconds: 120 });
}

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
  const reconciliation = await reconcilePendingCuraleafOrders();
  console.log('Curaleaf reconciliation complete', { reconciliation });
});

export const reconcileWorldpayPaymentsLondon = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const reconciliation = await reconcilePendingWorldpayPayments();
  console.log('Worldpay reconciliation complete', { reconciliation });
});

export const processPaymentLifecycleLondon = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 180,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  console.log('Payment lifecycle complete', await processPendingPaymentLifecycle());
});

export const maintainOrderFlowLondon = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  console.log('Paid order maintenance complete', await maintainPaidOrderFlow());
});

export const deliverPatientMessagesLondon = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  console.log('Patient message delivery complete', await deliverPatientMessages());
});

export const mirrorCuraleafAccountsLondon = onSchedule({
  schedule: 'every 60 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 300,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const accountMirror = await syncConnectedCuraleafAccounts();
  console.log('Curaleaf repair mirror complete', { accountMirror });
});

export const pollCuraleafEventsLondon = onTaskDispatched({
  region: 'europe-west2',
  timeoutSeconds: 180,
  memory: '256MiB',
  retryConfig: { maxAttempts: 1 },
  rateLimits: { maxConcurrentDispatches: 20 },
}, async request => {
  if (!eventPollingEnabled) return;
  const organisationId = typeof request.data?.organisationId === 'string' ? request.data.organisationId : '';
  if (!organisationId) throw new Error('A Curaleaf polling task requires an organisationId.');
  const stateDocument = firestore.collection('curaleafPollWorkers').doc(organisationId);
  const startedAt = Date.now();
  const acquired = await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateDocument);
    const leaseUntil = Number(snapshot.data()?.leaseUntil ?? 0);
    if (leaseUntil > startedAt) return false;
    transaction.set(stateDocument, { organisationId, leaseUntil: startedAt + 150_000, startedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return true;
  });
  if (!acquired) return;
  const priorSnapshot = await stateDocument.get();
  let failures = Number(priorSnapshot.data()?.consecutiveFailures ?? 0);
  let delaySeconds = EVENT_POLL_INTERVAL_SECONDS;
  try {
    const result = await pollCuraleafEvents(organisationId);
    failures = 0;
    delaySeconds = Math.max(1, EVENT_POLL_INTERVAL_SECONDS - (Date.now() - startedAt) / 1_000);
    await stateDocument.set({ lastSuccessAt: nowIso(), lastResult: result, lastError: null }, { merge: true });
  } catch (error) {
    failures += 1;
    delaySeconds = eventPollBackoffSeconds(error, failures);
    await stateDocument.set({ lastError: error instanceof Error ? error.message : 'Unknown Curaleaf polling error', lastFailureAt: nowIso() }, { merge: true });
  }
  const nextScheduledAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
  await stateDocument.set({ leaseUntil: 0, consecutiveFailures: failures, nextScheduledAt, updatedAt: nowIso() }, { merge: true });
  await enqueueCuraleafPoll(organisationId, delaySeconds);
});

export const watchCuraleafEventPollersLondon = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  if (!eventPollingEnabled) return;
  const connections = await firestore.collection('integrationConnections').where('integration', '==', 'curaleaf').get();
  for (const connection of connections.docs) {
    const data = connection.data();
    if (data.status !== 'connected' || typeof data.organisationId !== 'string') continue;
    const stateDocument = firestore.collection('curaleafPollWorkers').doc(data.organisationId);
    const state = (await stateDocument.get()).data();
    const nextScheduled = Date.parse(String(state?.nextScheduledAt ?? ''));
    const leaseUntil = Number(state?.leaseUntil ?? 0);
    if (leaseUntil > Date.now() || Number.isFinite(nextScheduled) && nextScheduled > Date.now() - 30_000) continue;
    await stateDocument.set({ organisationId: data.organisationId, watchdogSeededAt: nowIso(), nextScheduledAt: new Date(Date.now() + 1_000).toISOString() }, { merge: true });
    await enqueueCuraleafPoll(data.organisationId, 1);
  }
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

export const updatePatientRetentionLondon = onSchedule({
  schedule: '15 2 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  console.log('Patient retention update complete', await updatePatientRetentionStates());
});

export const auditGoLiveGatesLondon = onSchedule({
  schedule: '45 1 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 180,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  console.log('Go-live gate audit complete', await auditLiveOrganisationGates());
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
