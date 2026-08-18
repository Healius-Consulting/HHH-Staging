import { StorageProvider } from '../../providers/storage/storage.provider.js';
import type { PrescriptionRepositoryPort } from '../../repositories/ports/prescription.port.js';
import { SqlPrescriptionRepository } from '../../repositories/sql/prescription.sql.js';

const UUID_LIKE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function prescriptionFileIdsFromSnapshot(snapshot: unknown): string[] {
  const root = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {};
  const prescriptions = Array.isArray(root.prescriptions) ? root.prescriptions : [];
  const ids = new Set<string>();
  for (const entry of prescriptions) {
    if (!entry || typeof entry !== 'object') continue;
    const fileId = (entry as { fileId?: unknown }).fileId;
    if (typeof fileId === 'string' && UUID_LIKE.test(fileId)) ids.add(fileId);
  }
  return [...ids];
}

export async function purgePrescriptionFile(
  organisationId: string,
  fileId: string,
  deps?: {
    prescriptionRepo?: PrescriptionRepositoryPort;
    storage?: StorageProvider;
  },
) {
  const prescriptionRepo = deps?.prescriptionRepo ?? new SqlPrescriptionRepository();
  const storage = deps?.storage ?? new StorageProvider();
  const record = await prescriptionRepo.findFileById(fileId, organisationId);
  if (!record) return { purged: false, reason: 'not_found' as const };
  if (record.status === 'DELETED' || record.deletedAt) {
    if (record.storagePath) await storage.deleteFile(record.storagePath);
    return { purged: true, reason: 'already_deleted' as const };
  }
  if (record.storagePath) await storage.deleteFile(record.storagePath);
  await prescriptionRepo.markFileDeleted(fileId, organisationId);
  return { purged: true, reason: 'deleted' as const };
}

export async function purgeOrderPrescriptionFiles(
  organisationId: string,
  snapshot: unknown,
  deps?: {
    prescriptionRepo?: PrescriptionRepositoryPort;
    storage?: StorageProvider;
  },
) {
  const fileIds = prescriptionFileIdsFromSnapshot(snapshot);
  const results = [];
  for (const fileId of fileIds) {
    try {
      results.push({ fileId, ...(await purgePrescriptionFile(organisationId, fileId, deps)) });
    } catch (error) {
      console.warn('[Prescription file] Purge failed:', { organisationId, fileId, error });
      results.push({ fileId, purged: false, reason: 'failed' as const });
    }
  }
  return results;
}
