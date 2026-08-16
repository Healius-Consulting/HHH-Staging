import { config } from './config.js';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import type { PatientMessageKind } from './order-flow.js';

const allowedKinds = new Set<PatientMessageKind>([
  'patient_payment_request',
  'patient_payment_confirmation',
  'patient_ready_for_collection',
  'patient_fulfilment_delay',
]);

export async function deliverPatientMessages(limit = 100) {
  const snapshot = await firestore.collection('notificationOutbox').where('status', '==', 'pending').limit(limit).get();
  const summary = { checked: snapshot.size, sent: 0, deferred: 0, failed: 0 };
  for (const document of snapshot.docs) {
    const record = document.data();
    try {
      if (!allowedKinds.has(record.kind as PatientMessageKind)) {
        // This worker owns only the four order-flow patient templates. Other
        // notification records may be handled by their existing delivery path.
        summary.deferred += 1;
        continue;
      }
      if (!config.PATIENT_MESSAGE_PROVIDER_URL || !config.PATIENT_MESSAGE_PROVIDER_KEY) {
        summary.deferred += 1;
        continue;
      }
      const claimed = await firestore.runTransaction(async transaction => {
        const current = await transaction.get(document.ref);
        if (current.data()?.status !== 'pending') return false;
        transaction.set(document.ref, { status: 'sending', attempts: Number(current.data()?.attempts ?? 0) + 1, lastAttemptAt: nowIso(), updatedAt: nowIso() }, { merge: true });
        return true;
      });
      if (!claimed) continue;
      const response = await fetch(config.PATIENT_MESSAGE_PROVIDER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.PATIENT_MESSAGE_PROVIDER_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': document.id },
        body: JSON.stringify({ id: document.id, kind: record.kind, channel: record.channel, recipient: record.recipient, templateData: record.templateData }),
      });
      if (!response.ok) throw new Error(`Message provider returned ${response.status}.`);
      const provider = await response.json().catch(() => ({})) as Record<string, unknown>;
      await document.ref.set({ status: 'sent', providerMessageId: provider.id ?? provider.messageId ?? null, providerResponse: provider, sentAt: nowIso(), updatedAt: nowIso() }, { merge: true });
      summary.sent += 1;
    } catch (error) {
      await document.ref.set({ status: 'pending', lastError: error instanceof Error ? error.message : 'Unknown message delivery error', updatedAt: nowIso() }, { merge: true }).catch(() => undefined);
      summary.failed += 1;
    }
  }
  return summary;
}
