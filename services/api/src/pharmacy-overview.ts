import { firestore } from './firebase.js';
import { getRecord, listTenantRecords } from './repository.js';

type RecordData = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function object(value: unknown): RecordData { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {}; }
function array(value: unknown): RecordData[] { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as RecordData[] : []; }
function timestamp(record: RecordData, ...fields: string[]) {
  for (const field of fields) {
    const parsed = Date.parse(text(record[field]));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
function ageDays(at: number, now: number) { return Math.max(0, Math.floor((now - at) / DAY_MS)); }

export function maskPatientLabel(name: unknown) {
  const parts = text(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Patient record';
  return parts.slice(0, 2).map(part => `${part[0]!.toUpperCase()}${'•'.repeat(Math.min(5, Math.max(2, part.length - 1)))}`).join(' ');
}

function patientName(record: RecordData) {
  return text(record.name) || [text(record.firstName), text(record.surname)].filter(Boolean).join(' ') || 'Patient record';
}

function orderPayment(order: RecordData) {
  return object(order.payment);
}

function orderPrescriptions(order: RecordData) {
  return array(order.prescriptions);
}

function cancelled(order: RecordData) {
  return text(order.lifecycleStatus) === 'cancelled' || Boolean(order.cancellation) || text(order.status) === 'cancelled';
}

function readyForCollection(order: RecordData) {
  const fulfilment = text(order.fulfilmentStatus);
  if (fulfilment === 'ready_for_collection') return true;
  const prescriptions = orderPrescriptions(order);
  return prescriptions.length > 0 && prescriptions.every(rx => ['ready', 'ready_for_collection'].includes(text(rx.status)));
}

function inSupplierFlow(order: RecordData) {
  if (cancelled(order) || readyForCollection(order)) return false;
  return ['supplier_pending', 'supplier_processing', 'supplier_allocated', 'partially_dispatched_to_pharmacy', 'dispatched_to_pharmacy', 'partially_received', 'received']
    .includes(text(order.fulfilmentStatus));
}

export async function buildPharmacyOverview(organisationId: string, now = Date.now()) {
  const [organisation, submissions, orders, patients, integrationsSnapshot] = await Promise.all([
    getRecord('organisations', organisationId),
    listTenantRecords('eligibilitySubmissions', organisationId, 500),
    listTenantRecords('orders', organisationId, 500),
    listTenantRecords('patients', organisationId, 500),
    firestore.collection('integrationConnections').where('organisationId', '==', organisationId).limit(20).get(),
  ]);
  return composePharmacyOverview({
    organisationId,
    organisation,
    submissions,
    orders,
    patients,
    integrations: integrationsSnapshot.docs.map(document => ({ id: document.id, data: document.data() })),
  }, now);
}

export function composePharmacyOverview(input: {
  organisationId: string;
  organisation: RecordData;
  submissions: RecordData[];
  orders: RecordData[];
  patients: RecordData[];
  integrations: Array<{ id: string; data: RecordData }>;
}, now = Date.now()) {
  const { organisationId, organisation, submissions, orders, patients } = input;
  const patientById = new Map(patients.map(patient => [text(patient.id), patient]));
  const activeOrders = orders.filter(order => !cancelled(order));
  const reviewSubmissions = submissions.filter(submission => ['new', 'under_hhh_review', 'under review', 'New', 'Under HHH review'].includes(text(submission.status)));
  const awaitingPaymentOrders = activeOrders.filter(order => ['sent', 'pending', 'awaiting_payment'].includes(text(orderPayment(order).status) || text(order.paymentStatus)));
  const supplierOrders = activeOrders.filter(inSupplierFlow);
  const collectionOrders = activeOrders.filter(readyForCollection);

  const priorityItems: Array<Record<string, unknown>> = [];
  for (const submission of reviewSubmissions) {
    const submittedAt = timestamp(submission, 'lastSubmittedAt', 'submittedAt', 'createdAt');
    const days = ageDays(submittedAt, now);
    if (now - submittedAt < 48 * 60 * 60 * 1000) continue;
    priorityItems.push({
      id: `eligibility-${text(submission.id)}`,
      kind: 'eligibility', ageDays: days,
      maskedPatientLabel: maskPatientLabel(patientName(submission)),
      recordTarget: { kind: 'submission', id: text(submission.id) },
      summary: `Eligibility decision pending for ${days} day${days === 1 ? '' : 's'}.`,
    });
  }
  for (const order of awaitingPaymentOrders) {
    const payment = orderPayment(order);
    const sentAt = timestamp(payment, 'sentAt', 'createdAt');
    const days = ageDays(sentAt, now);
    if (now - sentAt < 3 * DAY_MS) continue;
    const patient = patientById.get(text(order.patientId));
    priorityItems.push({
      id: `payment-${text(order.id)}`, kind: 'payment', ageDays: days,
      maskedPatientLabel: maskPatientLabel(patientName(patient ?? {})),
      recordTarget: { kind: 'order', id: text(order.id) },
      summary: `Payment has been outstanding for ${days} day${days === 1 ? '' : 's'}.`,
    });
  }
  for (const order of collectionOrders) {
    const prescriptions = orderPrescriptions(order);
    const readyAt = Math.min(...prescriptions.map(rx => timestamp(rx, 'readyAt', 'updatedAt')), timestamp(order, 'readyAt', 'updatedAt'));
    const days = ageDays(readyAt, now);
    if (now - readyAt < 10 * DAY_MS) continue;
    const patient = patientById.get(text(order.patientId));
    priorityItems.push({
      id: `collection-${text(order.id)}`, kind: 'collection', ageDays: days,
      maskedPatientLabel: maskPatientLabel(patientName(patient ?? {})),
      recordTarget: { kind: 'order', id: text(order.id) },
      summary: `Collection follow-up is overdue by ${days} day${days === 1 ? '' : 's'}.`,
    });
  }
  for (const order of orders.filter(item => Boolean(item.cancellation) || text(item.cancellationStatus) === 'refund_required')) {
    const patient = patientById.get(text(order.patientId));
    priorityItems.push({
      id: `cancellation-${text(order.id)}`, kind: 'cancellation', ageDays: ageDays(timestamp(order, 'updatedAt', 'createdAt'), now),
      maskedPatientLabel: maskPatientLabel(patientName(patient ?? {})),
      recordTarget: { kind: 'order', id: text(order.id) },
      summary: 'Cancellation or refund resolution requires attention.',
    });
  }
  priorityItems.sort((left, right) => Number(right.ageDays) - Number(left.ageDays));

  const recentSessions = [...activeOrders]
    .sort((left, right) => timestamp(right, 'updatedAt', 'date', 'createdAt') - timestamp(left, 'updatedAt', 'date', 'createdAt'))
    .slice(0, 5)
    .map(order => ({
      orderId: text(order.id),
      maskedPatientLabel: maskPatientLabel(patientName(patientById.get(text(order.patientId)) ?? {})),
      occurredAt: new Date(timestamp(order, 'updatedAt', 'date', 'createdAt')).toISOString(),
      prescriptionCount: orderPrescriptions(order).length,
      status: text(order.lifecycleStatus) || text(orderPayment(order).status) || text(order.status) || 'draft',
    }));

  const integrations = ['curaleaf', 'worldpay'].map(integration => {
    const document = input.integrations.find(item => item.data.integration === integration || item.id.endsWith(`--${integration}`));
    const data = document?.data ?? {};
    const rawState = text(data.status);
    const state = rawState === 'connected' ? 'connected'
      : ['error', 'degraded'].includes(rawState) ? 'degraded'
        : document ? 'unavailable' : 'not-configured';
    return { integration, state, checkedAt: text(data.lastCheckedAt) || text(data.updatedAt) || null };
  });

  return {
    asOf: new Date(now).toISOString(),
    organisation: {
      id: organisationId,
      tradingName: text(organisation.tradingName) || text(organisation.name),
      status: ['onboarding', 'live', 'paused'].includes(text(organisation.status)) ? text(organisation.status) : 'onboarding',
      trainingMode: Boolean(organisation.testAccount) || text(organisation.status) !== 'live',
    },
    summary: {
      patientReview: reviewSubmissions.length,
      awaitingPayment: awaitingPaymentOrders.length,
      supplierFulfilment: supplierOrders.length,
      readyForCollection: collectionOrders.length,
      urgentTotal: priorityItems.length,
    },
    priorityItems,
    recentSessions,
    handover: {
      onboardingWaiting: reviewSubmissions.length,
      activePaymentLinks: awaitingPaymentOrders.length,
      supplierOrdersInProgress: supplierOrders.length,
      agedCollections: priorityItems.filter(item => item.kind === 'collection').length,
    },
    integrations,
  };
}
