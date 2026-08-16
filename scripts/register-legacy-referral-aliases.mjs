import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const repairs = [
  { pharmacy: 'K-Chem Pharmacy', gphcNumber: '1099224', token: 'kchem-7x4p9k' },
  { pharmacy: 'Eastwood Health Pharmacy', gphcNumber: '9012726', token: 'eastwood-3m8q2v' },
];

const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project');
const projectId = projectFlag >= 0 ? args[projectFlag + 1] : undefined;
const apply = args.includes('--apply');

if (!projectId) {
  throw new Error('Pass the exact Firebase project with --project <project-id>.');
}

initializeApp({ credential: applicationDefault(), projectId });
const firestore = getFirestore();
const now = new Date().toISOString();
const planned = [];

for (const repair of repairs) {
  const organisations = await firestore.collection('organisations')
    .where('gphcNumber', '==', repair.gphcNumber)
    .get();
  const eligibleOrganisations = organisations.docs.filter(document => {
    const data = document.data();
    return ['live', 'paused'].includes(String(data.status)) && data.testAccount !== true;
  });

  if (eligibleOrganisations.length !== 1) {
    throw new Error(
      `${repair.pharmacy}: expected one live or paused non-training organisation for GPhC ${repair.gphcNumber}; found ${eligibleOrganisations.length}.`,
    );
  }

  const organisation = eligibleOrganisations[0];
  const tokenHash = createHash('sha256').update(repair.token).digest('hex');
  const existing = await firestore.collection('referralTokens')
    .where('tokenHash', '==', tokenHash)
    .get();
  const active = existing.docs.filter(document => document.data().revokedAt == null);

  if (active.some(document => document.data().organisationId !== organisation.id)) {
    throw new Error(`${repair.pharmacy}: the legacy token is already assigned to another organisation.`);
  }

  if (active.some(document => document.data().organisationId === organisation.id)) {
    console.log(`${repair.pharmacy}: alias already active.`);
    continue;
  }

  const id = `legacy-${tokenHash.slice(0, 32)}`;
  planned.push({ id, organisationId: organisation.id, tokenHash, repair });
  console.log(`${repair.pharmacy}: alias ready for ${organisation.data().status} organisation ${organisation.id}.`);
}

if (!apply) {
  console.log(`Dry run only. ${planned.length} alias(es) would be registered. Re-run with --apply to write them.`);
  process.exit(0);
}

const batch = firestore.batch();
for (const item of planned) {
  const reference = firestore.collection('referralTokens').doc(item.id);
  batch.create(reference, {
    id: item.id,
    schemaVersion: 1,
    organisationId: item.organisationId,
    tokenHash: item.tokenHash,
    revokedAt: null,
    createdBy: 'migration:legacy-printed-qr-2026-08-16',
    createdAt: now,
    updatedAt: now,
  });
}
await batch.commit();
console.log(`Registered ${planned.length} legacy QR alias(es) in ${projectId}.`);
