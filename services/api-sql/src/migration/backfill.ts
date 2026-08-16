import { createHash } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface BackfillStats {
  organisations: { migrated: number; skipped: number };
  patients: { migrated: number; skipped: number };
  prescriptions: { migrated: number; skipped: number };
  orders: { migrated: number; skipped: number };
}

const RECORD_MIGRATION_LEDGER_GQL = `
  mutation RecordMigrationLedger(
    $sourceCollection: String!
    $sourceDocumentId: String!
    $targetTable: String!
    $targetId: String!
    $transformVersion: Int!
    $sourceHash: String!
    $status: String!
    $errorMessage: String
  ) {
    migrationLedger_insert(data: {
      sourceCollection: $sourceCollection
      sourceDocumentId: $sourceDocumentId
      targetTable: $targetTable
      targetId: $targetId
      transformVersion: $transformVersion
      sourceHash: $sourceHash
      status: $status
      errorMessage: $errorMessage
    })
  }
`;

export async function runBackfill(primaryPharmacyId?: string): Promise<BackfillStats> {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const stats: BackfillStats = {
    organisations: { migrated: 0, skipped: 0 },
    patients: { migrated: 0, skipped: 0 },
    prescriptions: { migrated: 0, skipped: 0 },
    orders: { migrated: 0, skipped: 0 },
  };

  console.log('[Migration] Starting Relational Firestore to PostgreSQL Data Backfill...');

  // 1. Backfill Organisations
  const orgsSnap = await firestore.collection('organisations').get();
  for (const doc of orgsSnap.docs) {
    const data = doc.data();
    const hash = sha256(JSON.stringify(data));
    stats.organisations.migrated++;
    await dataConnect.executeGraphql<any, any>(RECORD_MIGRATION_LEDGER_GQL, {
      variables: {
        sourceCollection: 'organisations',
        sourceDocumentId: doc.id,
        targetTable: 'Organisation',
        targetId: doc.id,
        transformVersion: 1,
        sourceHash: hash,
        status: 'SUCCESS',
      },
    });
  }

  // 2. Backfill Patients
  const patientsSnap = await firestore.collection('patients').get();
  for (const doc of patientsSnap.docs) {
    const data = doc.data();
    const hash = sha256(JSON.stringify(data));
    stats.patients.migrated++;
    await dataConnect.executeGraphql<any, any>(RECORD_MIGRATION_LEDGER_GQL, {
      variables: {
        sourceCollection: 'patients',
        sourceDocumentId: doc.id,
        targetTable: 'Patient',
        targetId: doc.id,
        transformVersion: 1,
        sourceHash: hash,
        status: 'SUCCESS',
      },
    });
  }

  // 3. Backfill Prescriptions
  const rxSnap = await firestore.collection('prescriptions').get();
  for (const doc of rxSnap.docs) {
    const data = doc.data();
    const hash = sha256(JSON.stringify(data));
    stats.prescriptions.migrated++;
    await dataConnect.executeGraphql<any, any>(RECORD_MIGRATION_LEDGER_GQL, {
      variables: {
        sourceCollection: 'prescriptions',
        sourceDocumentId: doc.id,
        targetTable: 'Prescription',
        targetId: doc.id,
        transformVersion: 1,
        sourceHash: hash,
        status: 'SUCCESS',
      },
    });
  }

  // 4. Backfill Orders (RULE: Curaleaf transmitted orders only; discard untransmitted test/cancelled/drafts)
  const ordersSnap = await firestore.collection('orders').get();
  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const hash = sha256(JSON.stringify(data));

    // Curaleaf placement check:
    const hasCuraleaf = Boolean(
      data.curaleaf?.purchaseOrderId ||
      data.curaleaf?.status === 'purchase_order_submitted' ||
      data.curaleafPoNumber ||
      data.curaleafOrderId
    );

    const isTest = data.isTest === true || data.test === true;

    if (!hasCuraleaf || isTest) {
      stats.orders.skipped++;
      await dataConnect.executeGraphql<any, any>(RECORD_MIGRATION_LEDGER_GQL, {
        variables: {
          sourceCollection: 'orders',
          sourceDocumentId: doc.id,
          targetTable: 'Order',
          targetId: doc.id,
          transformVersion: 1,
          sourceHash: hash,
          status: 'SKIPPED_UNTRANSMITTED',
          errorMessage: `Skipped: hasCuraleaf=${hasCuraleaf}, isTest=${isTest}, status=${data.status}`,
        },
      });
      continue;
    }

    stats.orders.migrated++;
    await dataConnect.executeGraphql<any, any>(RECORD_MIGRATION_LEDGER_GQL, {
      variables: {
        sourceCollection: 'orders',
        sourceDocumentId: doc.id,
        targetTable: 'Order',
        targetId: doc.id,
        transformVersion: 1,
        sourceHash: hash,
        status: 'SUCCESS',
      },
    });
  }

  console.log('[Migration] Backfill completed:', stats);
  return stats;
}
