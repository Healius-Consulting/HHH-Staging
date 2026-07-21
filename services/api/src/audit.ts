import type { Request } from 'express';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';

export async function audit(request: Request, event: string, details: Record<string, unknown> = {}) {
  const actor = request.identity;
  await firestore.collection('auditLogs').add({
    schemaVersion: 1,
    event,
    actorUid: actor?.uid ?? null,
    actorEmail: actor?.email ?? null,
    actorRole: actor?.role ?? 'public',
    organisationId: details.organisationId ?? actor?.organisationId ?? null,
    requestId: request.get('x-request-id') ?? null,
    ipHash: null,
    occurredAt: nowIso(),
    ...details,
  });
}
