import { createHash } from 'node:crypto';
import { firestore } from './firebase.js';
import { FLOW_CONFIG } from './flow-config.js';
import { nowIso } from './http.js';
import { messageId } from './order-flow.js';
import { queuePatientMessage } from './notification-outbox.js';
import { callCuraleafExtension } from './supplier-extension.js';

function count(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function staffTask(input: { organisationId: string; orderId: string; prescriptionId: string; type: string; priority: 'normal' | 'urgent'; detail: string; dueAt: string }) {
  const id = createHash('sha256').update(`${input.organisationId}:${input.orderId}:${input.prescriptionId}:${input.type}`).digest('hex');
  await firestore.collection('staffTasks').doc(id).set({ id, schemaVersion: 1, ...input, status: 'open', updatedAt: nowIso(), createdAt: nowIso() }, { merge: true });
  return id;
}

export async function maintainPaidOrderFlow(now = new Date()) {
  const snapshot = await firestore.collection('orders').where('paymentStatus', '==', 'paid').limit(1000).get();
  const summary = { checked: snapshot.size, delayed: 0, renewalHeld: 0, renewalEscalated: 0, errors: 0 };
  for (const document of snapshot.docs) {
    try {
      const order = document.data();
      const organisationId = String(order.organisationId ?? '');
      const patientId = String(order.patientId ?? '');
      if (!organisationId || !patientId || order.status === 'cancelled') continue;
      const patient = (await firestore.collection('patients').doc(patientId).get()).data();
      const flow = order.prescriptionFlow && typeof order.prescriptionFlow === 'object' ? order.prescriptionFlow as Record<string, Record<string, unknown>> : {};
      const nextFlow = { ...flow };
      let changed = false;
      for (const [prescriptionId, prescription] of Object.entries(flow)) {
        if (['COLLECTED', 'CANCELLED_REFUNDED'].includes(String(prescription.state))) continue;
        const lines = Array.isArray(prescription.lines) ? prescription.lines as Array<Record<string, unknown>> : [];
        const unfulfilled = lines.some(line => Math.max(0, count(line.shipped) - count(line.returned)) < count(line.ordered));
        const currentEpisode = prescription.delayEpisode && typeof prescription.delayEpisode === 'object' ? prescription.delayEpisode as Record<string, unknown> : {};
        const episodeClosed = Boolean(currentEpisode.closedAt);
        if (unfulfilled && episodeClosed) {
          const episodeId = createHash('sha256').update(`${document.id}:${prescriptionId}:${now.toISOString()}`).digest('hex').slice(0, 24);
          nextFlow[prescriptionId] = { ...prescription, delayEpisode: { id: episodeId, startedAt: now.toISOString() }, updatedAt: now.toISOString() };
          changed = true;
        } else {
          const episodeStartedAt = Date.parse(String(currentEpisode.startedAt ?? prescription.placedAt ?? order.updatedAt ?? ''));
          const delayAt = episodeStartedAt + FLOW_CONFIG.delayNotifyHours * 60 * 60 * 1_000;
          if (unfulfilled && Number.isFinite(delayAt) && now.getTime() >= delayAt && !currentEpisode.notifiedAt) {
            const episodeId = String(currentEpisode.id ?? createHash('sha256').update(`${document.id}:${prescriptionId}:${episodeStartedAt}`).digest('hex').slice(0, 24));
          if (typeof patient?.email === 'string') await queuePatientMessage({ id: messageId([document.id, prescriptionId, episodeId, 'delay']), organisationId, orderId: document.id, kind: 'patient_fulfilment_delay', recipient: patient.email, channel: 'email', deliveryOwner: 'platform', episodeId, templateData: { firstName: String(patient.firstName ?? 'Patient'), message: 'Part of your order is delayed — no action needed.' } });
            nextFlow[prescriptionId] = { ...prescription, delayEpisode: { id: episodeId, startedAt: String(currentEpisode.startedAt ?? new Date(episodeStartedAt).toISOString()), notifiedAt: now.toISOString() }, updatedAt: now.toISOString() };
            changed = true;
            summary.delayed += 1;
          } else if (!unfulfilled && currentEpisode.id && !currentEpisode.closedAt) {
            nextFlow[prescriptionId] = { ...prescription, delayEpisode: { ...currentEpisode, closedAt: now.toISOString() }, updatedAt: now.toISOString() };
            changed = true;
          }
        }
        const expiryAt = Date.parse(`${String(prescription.expiryDate ?? '')}T23:59:59.999Z`);
        if (!unfulfilled || !Number.isFinite(expiryAt)) continue;
        const boundaryAt = expiryAt - FLOW_CONFIG.stockBoundaryDays * 24 * 60 * 60 * 1_000;
        const renewal = prescription.renewal && typeof prescription.renewal === 'object' ? prescription.renewal as Record<string, unknown> : {};
        if (now.getTime() >= boundaryAt && !['boundary_alerted', 'expired_alerted', 'attaching', 'attached', 'manual_resolution'].includes(String(renewal.state))) {
          const purchaseOrderId = String(prescription.purchaseOrderId ?? '');
          const extension = purchaseOrderId ? await callCuraleafExtension(organisationId, 'hold', { purchaseOrderId, prescriptionId }, { reason: 'awaiting_renewed_prescription', orderId: document.id }) : { configured: false as const, completed: false as const };
          const taskId = await staffTask({ organisationId, orderId: document.id, prescriptionId, type: 'renewal_boundary', priority: 'normal', detail: extension.completed ? 'Curaleaf hold requested. Attach a valid renewed prescription.' : 'Renewal boundary reached. Contact Curaleaf if a supplier hold is required, then attach the renewal.', dueAt: new Date(expiryAt).toISOString() });
          nextFlow[prescriptionId] = { ...nextFlow[prescriptionId], state: 'HELD_FOR_RENEWAL', renewal: { state: 'boundary_alerted', boundaryAt: new Date(boundaryAt).toISOString(), taskId, extensionConfigured: extension.configured, holdRequestedAt: extension.completed ? now.toISOString() : null }, updatedAt: now.toISOString() };
          changed = true;
          summary.renewalHeld += 1;
        }
        const currentRenewal = nextFlow[prescriptionId]?.renewal && typeof nextFlow[prescriptionId]!.renewal === 'object' ? nextFlow[prescriptionId]!.renewal as Record<string, unknown> : renewal;
        if (now.getTime() >= expiryAt && currentRenewal.state === 'boundary_alerted') {
          const taskId = await staffTask({ organisationId, orderId: document.id, prescriptionId, type: 'renewal_expired', priority: 'urgent', detail: 'Prescription expired with unfulfilled lines. Attach a valid renewal or start Curaleaf CS cancellation and refund.', dueAt: now.toISOString() });
          nextFlow[prescriptionId] = { ...nextFlow[prescriptionId], state: 'HELD_FOR_RENEWAL', renewal: { ...currentRenewal, state: 'expired_alerted', expiredTaskId: taskId, expiredAlertedAt: now.toISOString() }, updatedAt: now.toISOString() };
          changed = true;
          summary.renewalEscalated += 1;
        }
      }
      if (changed) await document.ref.set({ prescriptionFlow: nextFlow, updatedAt: now.toISOString() }, { merge: true });
    } catch (error) {
      summary.errors += 1;
      await document.ref.set({ maintenanceError: error instanceof Error ? error.message : 'Unknown maintenance error', maintenanceCheckedAt: nowIso() }, { merge: true }).catch(() => undefined);
    }
  }
  return summary;
}
