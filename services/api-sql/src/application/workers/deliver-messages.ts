import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../../bootstrap/config.js';
import { isEmailTemplateCode } from '../notifications/message-kinds.js';
import { renderEmailTemplate } from '../notifications/email-renderer.js';
import type { NotificationOutboxRecord, NotificationRepositoryPort } from '../../repositories/ports/notification.port.js';

export type MessageDeliveryDeps = {
  notificationRepo: NotificationRepositoryPort;
  fetchImpl?: typeof fetch;
};

type ProviderConfig =
  | { kind: 'resend'; apiKey: string; from: string; replyTo: string | null }
  | { kind: 'webhook'; url: string; key: string };

const secretClient = new SecretManagerServiceClient();
let cachedResendApiKey: string | null = null;

async function readResendApiKey() {
  if (process.env.RESEND_API_KEY?.trim()) return process.env.RESEND_API_KEY.trim();
  if (cachedResendApiKey) return cachedResendApiKey;
  const resourceName = process.env.RESEND_API_KEY_SECRET_RESOURCE_NAME?.trim()
    || `projects/${config.FIREBASE_PROJECT_ID}/secrets/hhh-resend-api-key-europe-west2`;
  try {
    const [version] = await secretClient.accessSecretVersion({ name: `${resourceName}/versions/latest` });
    const value = version.payload?.data?.toString('utf8').trim();
    if (value) {
      cachedResendApiKey = value;
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

async function providerConfig(): Promise<ProviderConfig | null> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const resendFrom = process.env.EMAIL_FROM_ADDRESS?.trim();
  const resolvedResendApiKey = resendApiKey || await readResendApiKey();
  if (resolvedResendApiKey && resendFrom) {
    return { kind: 'resend' as const, apiKey: resolvedResendApiKey, from: resendFrom, replyTo: process.env.EMAIL_REPLY_TO_ADDRESS?.trim() || null };
  }
  const url = process.env.PATIENT_MESSAGE_PROVIDER_URL?.trim();
  const key = process.env.PATIENT_MESSAGE_PROVIDER_KEY?.trim();
  const genericUrl = process.env.EMAIL_PROVIDER_URL?.trim();
  const genericKey = process.env.EMAIL_PROVIDER_KEY?.trim();
  if (genericUrl && genericKey) return { kind: 'webhook' as const, url: genericUrl, key: genericKey };
  return url && key ? { kind: 'webhook' as const, url, key } : null;
}

async function deliverOne(
  record: NotificationOutboxRecord,
  deps: MessageDeliveryDeps,
  provider: ProviderConfig,
) {
  if (record.status !== 'PENDING') return 'skipped' as const;
  if (!isEmailTemplateCode(record.templateCode)) return 'deferred' as const;
  await deps.notificationRepo.markProcessing(record.id, record.attemptCount + 1);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = provider.kind === 'resend'
    ? await (() => {
      const rendered = renderEmailTemplate(record.templateCode, record.payload);
      return fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': record.id,
        },
        body: JSON.stringify({
          from: provider.from,
          to: [record.encryptedRecipient],
          reply_to: provider.replyTo || undefined,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: 'template', value: record.templateCode },
            { name: 'channel', value: record.channel.toLowerCase() },
          ],
        }),
      });
    })()
    : await fetchImpl(provider.url, {
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
  const provider = await providerConfig();
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
