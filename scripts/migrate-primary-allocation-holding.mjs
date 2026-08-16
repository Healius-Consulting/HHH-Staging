import { randomUUID } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PRIMARY_ORGANISATION_ID = '70913a30-71c3-4a41-952e-d532927af58c';
const POLICY_VERSION = 'primary-allocation-holding-v1';
const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project');
const projectId = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
const apply = args.includes('--apply');

if (!projectId) throw new Error('Pass the exact Firebase project with --project <project-id>.');

initializeApp({ credential: applicationDefault(), projectId });
const firestore = getFirestore();
const organisationRef = firestore.collection('organisations').doc(PRIMARY_ORGANISATION_ID);
const organisationSnapshot = await organisationRef.get();

if (!organisationSnapshot.exists) throw new Error('Primary Branch organisation was not found. No writes were made.');
const organisation = organisationSnapshot.data();
if (organisation?.tradingName !== 'Primary Branch'
  || organisation?.status !== 'live'
  || organisation?.testAccount !== true
  || organisation?.gdprExempt !== true
  || !/^TRAINING-[A-Z0-9_-]+$/i.test(String(organisation?.gphcNumber ?? ''))) {
  throw new Error('Primary Branch no longer matches the protected TEST-integration baseline. No writes were made.');
}
if (organisation.workspaceClassification
  && !['training', 'allocation_holding'].includes(String(organisation.workspaceClassification))) {
  throw new Error(`Primary Branch has an unexpected workspace classification: ${organisation.workspaceClassification}. No writes were made.`);
}

const countedCollections = ['eligibilitySubmissions', 'patients', 'orders', 'prescriptions', 'payments'];
const counts = Object.fromEntries(await Promise.all(countedCollections.map(async collection => [
  collection,
  (await firestore.collection(collection).where('organisationId', '==', PRIMARY_ORGANISATION_ID).count().get()).data().count,
])));
const activeTokens = (await firestore.collection('referralTokens')
  .where('organisationId', '==', PRIMARY_ORGANISATION_ID)
  .where('revokedAt', '==', null)
  .count().get()).data().count;
const alreadyApplied = organisation.workspaceClassification === 'allocation_holding'
  && organisation.allocationHoldingPolicyVersion === POLICY_VERSION;

console.log(JSON.stringify({
  projectId,
  organisationId: PRIMARY_ORGANISATION_ID,
  currentClassification: organisation.workspaceClassification ?? null,
  targetClassification: 'allocation_holding',
  preservedRecordCounts: counts,
  activeReferralTokens: activeTokens,
  alreadyApplied,
}, null, 2));

if (!apply) {
  console.log('Dry run only. Re-run with --apply to classify Primary Branch without rewriting any patient, submission, order, prescription, payment or token.');
  process.exit(0);
}
if (alreadyApplied) {
  console.log('Primary Branch already has this allocation-holding policy. No writes were made.');
  process.exit(0);
}

const occurredAt = new Date().toISOString();
await firestore.runTransaction(async transaction => {
  const fresh = await transaction.get(organisationRef);
  if (!fresh.exists || fresh.data()?.testAccount !== true || fresh.data()?.status !== 'live') {
    throw new Error('Primary Branch changed after validation. No writes were made.');
  }
  transaction.set(organisationRef, {
    workspaceClassification: 'allocation_holding',
    allocationHoldingPolicyVersion: POLICY_VERSION,
    allocationHoldingEnabledAt: occurredAt,
    updatedAt: occurredAt,
  }, { merge: true });
  const auditId = randomUUID();
  transaction.create(firestore.collection('auditLogs').doc(auditId), {
    id: auditId,
    schemaVersion: 1,
    event: 'organisation.allocation_holding_enabled',
    actorUid: 'migration:primary-allocation-holding',
    actorEmail: null,
    actorRole: 'system',
    organisationId: PRIMARY_ORGANISATION_ID,
    requestId: null,
    ipHash: null,
    policyVersion: POLICY_VERSION,
    preservedRecordCounts: counts,
    activeReferralTokens: activeTokens,
    occurredAt,
  });
});

console.log('Primary Branch is now an allocation-holding workspace. Existing records and referral-token documents were not modified.');
