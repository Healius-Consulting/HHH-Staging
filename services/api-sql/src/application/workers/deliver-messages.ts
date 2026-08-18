import { isPatientMessageKind } from '../notifications/patient-messages.js';
import type { NotificationOutboxRecord, NotificationRepositoryPort } from '../../repositories/ports/notification.port.js';

export type MessageDeliveryDeps = {
  notificationRepo: NotificationRepositoryPort;
  fetchImpl?: typeof fetch;
};

function providerConfig() {
  const url = process.env.PATIENT_MESSAGE_PROVIDER_URL?.trim();
  const key = process.env.PATIENT_MESSAGE_PROVIDER_KEY?.trim();
  return url && key ? { url, key } : null;
}

async function deliverOne(
  record: NotificationOutboxRecord,
  deps: MessageDeliveryDeps,
  provider: { url: string; key: string },
) {
  if (record.status !== 'PENDING') return 'skipped' as const;
  if (!isPatientMessageKind(record.templateCode)) return 'deferred' as const;
  await deps.notificationRepo.markProcessing(record.id, record.attemptCount + 1);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(provider.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': record.id,
    },
    body: JSON.stringify({
      id: record.id,
      kind: record.templateCode,
      channel: record.channel.toLowerCase(),
      recipient: record.encryptedRecipient,
      templateData: record.payload,
    }),
  });
  if (!response.ok) throw new Error(`Message provider returned ${response.status}.`);
  const providerResponse = await response.json().catch(() => ({}));
  await deps.notificationRepo.markSent(record.id, providerResponse);
  return 'sent' as const;
}

export async function deliverPatientMessages(deps: MessageDeliveryDeps, limit = 100) {
  const provider = providerConfig();
  const pending = await deps.notificationRepo.listPending(limit);
  const summary = { checked: pending.length, sent: 0, deferred: 0, failed: 0 };
  if (!provider) {
    summary.deferred = pending.length;
    return summary;
  }
  for (const record of pending) {
    try {
      const result = await deliverOne(record, deps, provider);
      if (result === 'sent') summary.sent += 1;
      else summary.deferred += 1;
    } catch (error) {
      summary.failed += 1;
      await deps.notificationRepo.markFailed(
        record.id,
        error instanceof Error ? error.message : 'Unknown message delivery error',
      ).catch(() => undefined);
    }
  }
  return summary;
}
