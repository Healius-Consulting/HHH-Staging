import { randomUUID } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { cached, invalidateCache } from './cache.js';
import { firestore } from './firebase.js';
import { HttpError, nowIso } from './http.js';

const RECORD_TTL_MS = 15_000;
const LIST_TTL_MS = 10_000;

export function invalidateCollectionCache(collection: string, id?: string) {
  invalidateCache(`list:${collection}:`, ...(id ? [`record:${collection}:${id}`] : [`record:${collection}:`]));
}

export async function createRecord(collection: string, data: DocumentData, id = randomUUID()) {
  const record = { ...data, id, schemaVersion: 1, createdAt: nowIso(), updatedAt: nowIso() };
  await firestore.collection(collection).doc(id).create(record);
  invalidateCollectionCache(collection, id);
  return record;
}

export async function getRecord(collection: string, id: string) {
  return cached(`record:${collection}:${id}`, RECORD_TTL_MS, async () => {
    const snapshot = await firestore.collection(collection).doc(id).get();
    if (!snapshot.exists) throw new HttpError(404, `${collection} record not found.`, 'NOT_FOUND');
    return snapshot.data()!;
  });
}

export async function getTenantRecord(collection: string, id: string, pharmacyId: string) {
  const record = await getRecord(collection, id);
  let recordTenant = record.pharmacyId ?? record.organisationId;
  if (collection === 'eligibilitySubmissions') {
    if (record.schemaVersion === 2 || record.intakeVersion === 'v2') {
      recordTenant = record.assignedOrganisationId;
    } else {
      const overlay = await firestore.collection('eligibilityAllocationOverlays').doc(id).get();
      if (overlay.exists) recordTenant = overlay.data()?.assignedOrganisationId;
    }
  }
  if (collection === 'patients' && typeof record.sourceReferralId === 'string') {
    const [submission, overlay] = await Promise.all([
      firestore.collection('eligibilitySubmissions').doc(record.sourceReferralId).get(),
      firestore.collection('eligibilityAllocationOverlays').doc(record.sourceReferralId).get(),
    ]);
    if (submission.exists) {
      const source = submission.data()!;
      const isV2 = source.schemaVersion === 2 || source.intakeVersion === 'v2';
      const workflow = isV2 ? source : (overlay.data() ?? source);
      recordTenant = isV2 ? source.assignedOrganisationId : (overlay.data()?.assignedOrganisationId ?? source.organisationId);
      if (isV2 && (
        workflow.assignmentStatus !== 'confirmed'
        || workflow.pharmacyAccessStatus !== 'activated'
        || workflow.programmeOnboardingDecision !== 'approved'
      )) {
        throw new HttpError(409, 'HHH allocation and onboarding approval are required before this action.', 'ASSIGNMENT_NOT_CONFIRMED');
      }
    }
  }
  if (recordTenant !== pharmacyId) throw new HttpError(404, `${collection} record not found.`, 'NOT_FOUND');
  return record;
}

export async function updateTenantRecord(collection: string, id: string, pharmacyId: string, updates: DocumentData) {
  await getTenantRecord(collection, id, pharmacyId);
  const patch = { ...updates, updatedAt: nowIso() };
  await firestore.collection(collection).doc(id).update(patch);
  invalidateCollectionCache(collection, id);
  return { ...(await getRecord(collection, id)) };
}

export async function listTenantRecords(collection: string, pharmacyId: string, limit = 200) {
  return cached(`list:${collection}:${pharmacyId}:${limit}`, LIST_TTL_MS, async () => {
    if (collection === 'eligibilitySubmissions') {
      const [original, assignedV2, movedLegacy] = await Promise.all([
        firestore.collection(collection).where('organisationId', '==', pharmacyId).limit(limit).get(),
        firestore.collection(collection).where('assignedOrganisationId', '==', pharmacyId).limit(limit).get(),
        firestore.collection('eligibilityAllocationOverlays').where('assignedOrganisationId', '==', pharmacyId).limit(limit).get(),
      ]);
      const candidates = new Map(original.docs.concat(assignedV2.docs).map(document => [document.id, document.data()]));
      await Promise.all(movedLegacy.docs.map(async overlay => {
        if (candidates.has(overlay.id)) return;
        const submission = await firestore.collection(collection).doc(overlay.id).get();
        if (submission.exists) candidates.set(submission.id, submission.data()!);
      }));
      const effective = await Promise.all([...candidates].map(async ([id, item]) => {
        if (item.schemaVersion === 2 || item.intakeVersion === 'v2') return item.assignedOrganisationId === pharmacyId ? item : null;
        const overlay = await firestore.collection('eligibilityAllocationOverlays').doc(id).get();
        const owner = overlay.exists ? overlay.data()?.assignedOrganisationId : item.organisationId;
        return owner === pharmacyId ? item : null;
      }));
      return effective.filter((item): item is DocumentData => Boolean(item)).slice(0, limit)
        .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
    }
    // Try querying by pharmacyId first, fallback to organisationId
    const snapshotByPharmacy = await firestore.collection(collection).where('pharmacyId', '==', pharmacyId).limit(limit).get();
    let docs = snapshotByPharmacy.docs;
    if (docs.length === 0) {
      const snapshotByOrg = await firestore.collection(collection).where('organisationId', '==', pharmacyId).limit(limit).get();
      docs = snapshotByOrg.docs;
    }
    return docs.map(document => document.data()).sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  });
}

/** Tenant list filtered by a single equality field (e.g. orders by patientId). */
export async function listTenantRecordsByField(
  collection: string,
  pharmacyId: string,
  field: string,
  value: string,
  limit = 200,
) {
  const cacheKey = `list:${collection}:${pharmacyId}:${field}:${value}:${limit}`;
  return cached(cacheKey, LIST_TTL_MS, async () => {
    const byOrg = await firestore
      .collection(collection)
      .where('organisationId', '==', pharmacyId)
      .where(field, '==', value)
      .limit(limit)
      .get();
    let docs = byOrg.docs;
    if (docs.length === 0) {
      const byPharmacy = await firestore
        .collection(collection)
        .where('pharmacyId', '==', pharmacyId)
        .where(field, '==', value)
        .limit(limit)
        .get();
      docs = byPharmacy.docs;
    }
    return docs
      .map(document => document.data())
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  });
}
