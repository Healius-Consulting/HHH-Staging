import { firestore, storage } from './firebase.js';
import { nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';

function stringIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const fileId = (item as Record<string, unknown>).fileId;
    return typeof fileId === 'string' ? [fileId] : [];
  });
}

export async function cleanupAbandonedPrescriptionFiles(asOf = new Date()) {
  const pendingCutoff = new Date(asOf.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const uploadedCutoff = new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [files, orders, scans] = await Promise.all([
    firestore.collection('prescriptionFiles').limit(1_000).get(),
    firestore.collection('orders').limit(2_000).get(),
    firestore.collection('curaleafPrescriptionScans').limit(2_000).get(),
  ]);
  const linked = new Set<string>();
  orders.docs.forEach(document => stringIds(document.data().prescriptions).forEach(id => linked.add(id)));
  scans.docs.forEach(document => {
    const fileId = document.data().fileId;
    if (typeof fileId === 'string') linked.add(fileId);
  });

  let deleted = 0;
  let retained = 0;
  let failed = 0;
  for (const document of files.docs) {
    const file = document.data();
    const createdAt = String(file.createdAt ?? '');
    const eligible = file.status === 'upload_pending'
      ? createdAt < pendingCutoff
      : file.status === 'uploaded'
        ? createdAt < uploadedCutoff
        : false;
    if (!eligible || linked.has(document.id)) {
      retained += 1;
      continue;
    }
    try {
      if (typeof file.storagePath === 'string') {
        await storage.bucket().file(file.storagePath).delete({ ignoreNotFound: true });
      }
      await document.ref.set({
        status: 'cleaned',
        storagePath: null,
        cleanedAt: nowIso(),
        updatedAt: nowIso(),
        cleanupReason: file.status === 'upload_pending' ? 'upload_abandoned' : 'unlinked_retention_expired',
      }, { merge: true });
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error('Prescription file cleanup failed', { fileId: document.id, error });
    }
  }
  if (deleted) invalidateCollectionCache('prescriptionFiles');
  return { checked: files.size, linked: linked.size, deleted, retained, failed };
}
