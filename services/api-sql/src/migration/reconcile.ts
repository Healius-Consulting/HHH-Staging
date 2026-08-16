import { createHash } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface ReconciliationReport {
  totalSourceDocuments: number;
  totalMigratedRows: number;
  matchedCount: number;
  discrepancies: Array<{
    collection: string;
    docId: string;
    reason: string;
  }>;
  parityRatePercent: number;
}

const LIST_MIGRATION_LEDGER_GQL = `
  query ListMigrationLedger($limit: Int!) {
    migrationLedgers(limit: $limit) {
      id
      sourceCollection
      sourceDocumentId
      targetTable
      targetId
      sourceHash
      status
    }
  }
`;

export async function reconcileDataParity(): Promise<ReconciliationReport> {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const report: ReconciliationReport = {
    totalSourceDocuments: 0,
    totalMigratedRows: 0,
    matchedCount: 0,
    discrepancies: [],
    parityRatePercent: 100,
  };

  const ledgerResult = await dataConnect.executeGraphql<{
    migrationLedgers: Array<{
      id: string;
      sourceCollection: string;
      sourceDocumentId: string;
      targetTable: string;
      targetId: string;
      sourceHash: string;
      status: string;
    }>;
  }, any>(LIST_MIGRATION_LEDGER_GQL, { variables: { limit: 50_000 } });

  const ledgerMap = new Map<string, { status: string; hash: string }>();
  for (const entry of ledgerResult.data.migrationLedgers || []) {
    ledgerMap.set(`${entry.sourceCollection}:${entry.sourceDocumentId}`, {
      status: entry.status,
      hash: entry.sourceHash,
    });
  }

  // Check across authoritative collections
  const collectionsToCheck = ['organisations', 'patients', 'prescriptions'];
  for (const coll of collectionsToCheck) {
    const snap = await firestore.collection(coll).get();
    report.totalSourceDocuments += snap.size;

    for (const doc of snap.docs) {
      const currentHash = sha256(JSON.stringify(doc.data()));
      const key = `${coll}:${doc.id}`;
      const ledgerEntry = ledgerMap.get(key);

      if (!ledgerEntry) {
        report.discrepancies.push({ collection: coll, docId: doc.id, reason: 'MISSING_IN_SQL_LEDGER' });
      } else if (ledgerEntry.status === 'SUCCESS' && ledgerEntry.hash === currentHash) {
        report.matchedCount++;
      } else if (ledgerEntry.status === 'SUCCESS' && ledgerEntry.hash !== currentHash) {
        report.discrepancies.push({ collection: coll, docId: doc.id, reason: 'CHECKSUM_HASH_MISMATCH' });
      }
    }
  }

  report.totalMigratedRows = ledgerMap.size;
  report.parityRatePercent = report.totalSourceDocuments > 0
    ? Math.round((report.matchedCount / report.totalSourceDocuments) * 10000) / 100
    : 100;

  return report;
}
