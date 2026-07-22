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

export async function getTenantRecord(collection: string, id: string, organisationId: string) {
  const record = await getRecord(collection, id);
  if (record.organisationId !== organisationId) throw new HttpError(404, `${collection} record not found.`, 'NOT_FOUND');
  return record;
}

export async function updateTenantRecord(collection: string, id: string, organisationId: string, updates: DocumentData) {
  await getTenantRecord(collection, id, organisationId);
  const patch = { ...updates, updatedAt: nowIso() };
  await firestore.collection(collection).doc(id).update(patch);
  invalidateCollectionCache(collection, id);
  return { ...(await getRecord(collection, id)) };
}

export async function listTenantRecords(collection: string, organisationId: string, limit = 200) {
  return cached(`list:${collection}:${organisationId}:${limit}`, LIST_TTL_MS, async () => {
    const snapshot = await firestore.collection(collection).where('organisationId', '==', organisationId).limit(limit).get();
    return snapshot.docs.map(document => document.data()).sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  });
}
