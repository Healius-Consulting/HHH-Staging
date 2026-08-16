import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import type { PatientMessageKind } from './order-flow.js';

type QueuePatientMessageInput = {
  id: string;
  organisationId: string;
  orderId: string;
  kind: PatientMessageKind;
  recipient: string;
  channel: 'email' | 'sms';
  deliveryOwner: 'platform' | 'worldpay';
  templateData: Record<string, unknown>;
  paymentId?: string;
  shipmentId?: string;
  episodeId?: string;
};

export async function queuePatientMessage(input: QueuePatientMessageInput) {
  const reference = firestore.collection('notificationOutbox').doc(input.id);
  const existing = await reference.get();
  if (existing.exists) return { created: false, record: existing.data()! };
  const record = {
    ...input,
    schemaVersion: 2,
    status: input.deliveryOwner === 'worldpay' ? 'provider_owned' : 'pending',
    attempts: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    await reference.create(record);
    return { created: true, record };
  } catch (error) {
    const code = (error as { code?: number | string } | null)?.code;
    if (code !== 6 && code !== 'already-exists') throw error;
    return { created: false, record: (await reference.get()).data()! };
  }
}
