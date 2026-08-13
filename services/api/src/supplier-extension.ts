import { createHash } from 'node:crypto';
import { config } from './config.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { readIntegrationSecret } from './secrets.js';

type ExtensionKind = 'hold' | 'renewal' | 'line_exclusion';

const templates: Record<ExtensionKind, string | undefined> = {
  hold: config.CURALEAF_HOLD_URL_TEMPLATE,
  renewal: config.CURALEAF_RENEWAL_ATTACH_URL_TEMPLATE,
  line_exclusion: config.CURALEAF_LINE_EXCLUSION_URL_TEMPLATE,
};

function render(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, encodeURIComponent(replacement)), template);
}

export async function callCuraleafExtension(
  organisationId: string,
  kind: ExtensionKind,
  values: Record<string, string>,
  body: Record<string, unknown>,
) {
  const template = templates[kind];
  if (!template) return { configured: false as const, completed: false as const };
  const idempotencyKey = createHash('sha256').update(JSON.stringify({ organisationId, kind, values, body })).digest('hex');
  const callRef = firestore.collection('supplierExtensionCalls').doc(idempotencyKey);
  const prior = await callRef.get();
  if (prior.data()?.status === 'completed') return { configured: true as const, completed: true as const, result: prior.data()?.response, idempotent: true as const };
  const secret = await readIntegrationSecret<Record<string, string>>(organisationId, 'curaleaf_live');
  const apiKey = secret.writeApiKey ?? secret.apiKey;
  if (!apiKey) throw new Error('The LIVE Curaleaf write key is unavailable.');
  await callRef.set({ id: idempotencyKey, schemaVersion: 1, organisationId, kind, values, request: body, status: 'started', attempts: Number(prior.data()?.attempts ?? 0) + 1, lastAttemptAt: nowIso(), createdAt: prior.data()?.createdAt ?? nowIso(), updatedAt: nowIso() }, { merge: true });
  try {
    const response = await fetch(render(template, values), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Curaleaf ${kind} extension returned ${response.status}.`);
    const result = await response.json().catch(() => ({}));
    await callRef.set({ status: 'completed', response: result, completedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return { configured: true as const, completed: true as const, result, idempotent: false as const };
  } catch (error) {
    await callRef.set({ status: 'failed', lastError: error instanceof Error ? error.message : 'Unknown extension error', failedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    throw error;
  }
}
