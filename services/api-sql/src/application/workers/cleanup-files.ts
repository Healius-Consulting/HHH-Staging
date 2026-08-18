import { isAbandonedPrescriptionFile } from '../prescriptions/prescription-file-cleanup.js';
import { prescriptionFileIdsFromSnapshot } from '../prescriptions/prescription-file-purge.js';
import { StorageProvider } from '../../providers/storage/storage.provider.js';
import type { OrderRepositoryPort } from '../../repositories/ports/order.port.js';
import type { PrescriptionRepositoryPort } from '../../repositories/ports/prescription.port.js';

export type FileCleanupDeps = {
  prescriptionRepo: PrescriptionRepositoryPort;
  orderRepo: OrderRepositoryPort;
  storage?: StorageProvider;
};

export async function cleanupAbandonedPrescriptionFiles(deps: FileCleanupDeps, asOf = new Date()) {
  const [files, linkedFromPrescriptions, paidOrders] = await Promise.all([
    deps.prescriptionRepo.listCleanupCandidateFiles(1_000),
    deps.prescriptionRepo.listLinkedPrescriptionFileIds(2_000),
    deps.orderRepo.listPaidOpenOrders(2_000),
  ]);
  const linked = new Set(linkedFromPrescriptions);
  for (const order of paidOrders) {
    for (const fileId of prescriptionFileIdsFromSnapshot(order.quoteSnapshot)) linked.add(fileId);
  }

  const storage = deps.storage ?? new StorageProvider();
  let deleted = 0;
  let retained = 0;
  let failed = 0;
  for (const file of files) {
    if (!isAbandonedPrescriptionFile({
      status: file.status,
      createdAt: file.createdAt ?? '',
      deletedAt: file.deletedAt,
    }, asOf) || linked.has(file.id)) {
      retained += 1;
      continue;
    }
    try {
      if (file.storagePath) await storage.deleteFile(file.storagePath);
      await deps.prescriptionRepo.markFileDeleted(file.id, file.organisationId);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error('Prescription file cleanup failed', { fileId: file.id, error });
    }
  }
  return { checked: files.length, linked: linked.size, deleted, retained, failed };
}
