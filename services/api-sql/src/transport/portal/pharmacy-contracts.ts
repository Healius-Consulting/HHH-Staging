import type { OrderDraftRecord, OrderRecord } from '../../repositories/ports/order.port.js';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import type { PatientRecord } from '../../repositories/ports/patient.port.js';

type PortalOrder = ReturnType<typeof toPortalOrder>;

const DAY_MS = 24 * 60 * 60 * 1000;

function lower(value: string) {
  return value.toLowerCase();
}

function timestamp(value: string | null | undefined, fallback: string) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback);
}

function ageDays(at: number, now: number) {
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

function maskPatientLabel(patient: PatientRecord | undefined) {
  if (!patient) return 'Patient record';
  return [patient.firstName, patient.surname]
    .filter(Boolean)
    .slice(0, 2)
    .map(part => `${part[0]!.toUpperCase()}${'•'.repeat(Math.min(5, Math.max(2, part.length - 1)))}`)
    .join(' ');
}

export function toPortalOrganisation(organisation: OrganisationRecord) {
  return {
    id: organisation.id,
    orgId: organisation.companyId ?? organisation.id,
    name: organisation.name,
    tradingName: organisation.tradingName,
    logoText: organisation.logoText,
    gphcNumber: organisation.gphcNumber,
    superintendent: organisation.superintendentName,
    mainContactName: organisation.mainContactName ?? undefined,
    mainContactPhone: organisation.mainContactPhone ?? undefined,
    mainContactEmail: organisation.mainContactEmail ?? undefined,
    address: organisation.address,
    primaryColour: organisation.primaryColour,
    status: lower(organisation.status),
    portalName: organisation.portalName,
    modules: {
      intake: organisation.intakeEnabled,
      rx: organisation.prescriptionEnabled,
      payments: organisation.paymentsEnabled,
      supplierOrders: organisation.supplierOrdersEnabled,
      patients: organisation.patientsEnabled,
      resources: organisation.resourcesEnabled,
    },
    worldpayEnabled: organisation.worldpayEnabled,
    defaultPaymentRoute: lower(organisation.defaultPaymentRoute),
    autoPlacementEnabled: organisation.autoPlacementEnabled,
    testAccount: organisation.classification === 'TRAINING',
    gdprExempt: !organisation.gdprComplianceFlag,
    workspaceClassification: lower(organisation.classification),
  };
}

export function toPortalPatient(patient: PatientRecord) {
  return {
    id: patient.id,
    organisationId: patient.organisationId,
    firstName: patient.firstName,
    surname: patient.surname,
    dob: patient.dob,
    email: patient.email,
    mobile: patient.mobile,
    address: patient.address ?? '',
    postcode: patient.postcode,
    status: lower(patient.status),
    conditions: [] as string[],
    primaryCondition: null,
    referralSource: null,
    marketingConsent: null,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };
}

export function toPortalOrder(order: OrderRecord) {
  const submittedToSupplier = order.status !== 'DRAFT';
  return {
    id: order.id,
    organisationId: order.organisationId,
    patientId: order.patientId,
    lineItems: [] as Array<{
      productId: string;
      formulaId: string;
      packId: string;
      name: string;
      quantity: number;
      unitPricePence: number;
    }>,
    dispensingFeePence: Number(order.dispensingFeePence),
    totalPence: Number(order.totalPence),
    currency: order.currency === 'GBP' ? 'GBP' as const : 'GBP' as const,
    paymentRoute: lower(order.paymentRoute) === 'worldpay' ? 'worldpay' as const : 'manual' as const,
    paymentStatus: lower(order.paymentStatus),
    fulfilmentStatus: lower(order.fulfilmentStatus),
    status: lower(order.status),
    autoPlacementEnabled: true,
    ...(submittedToSupplier ? {
      curaleaf: {
        status: 'purchase_order_submitted' as const,
        customerReference: order.orderNumber || order.id,
      },
    } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function toPortalOrderDraft(draft: OrderDraftRecord) {
  return {
    id: draft.id,
    organisationId: draft.organisationId,
    patientId: draft.patientId,
    status: 'draft' as const,
    payload: draft.payload && typeof draft.payload === 'object' && !Array.isArray(draft.payload)
      ? draft.payload as Record<string, unknown>
      : {},
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function isCancelled(order: PortalOrder) {
  return order.status === 'cancelled' || order.paymentStatus === 'cancelled';
}

function isAwaitingPayment(order: PortalOrder) {
  return ['pending', 'awaiting_manual_payment'].includes(order.paymentStatus);
}

function isSupplierFlow(order: PortalOrder) {
  return [
    'supplier_pending',
    'supplier_processing',
    'supplier_allocated',
    'partially_dispatched_to_pharmacy',
    'dispatched_to_pharmacy',
    'partially_received',
    'received',
  ].includes(order.fulfilmentStatus);
}

export function buildSqlPharmacyOverview(params: {
  organisation: OrganisationRecord;
  patients: PatientRecord[];
  orders: OrderRecord[];
  pendingEnquiries?: Array<{ submittedAt: string }>;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const patientById = new Map(params.patients.map(patient => [patient.id, patient]));
  const orders = params.orders.map(toPortalOrder);
  const pendingEnquiries = params.pendingEnquiries ?? [];
  const activeOrders = orders.filter(order => !isCancelled(order));
  const awaitingPayment = activeOrders.filter(isAwaitingPayment);
  const supplierOrders = activeOrders.filter(isSupplierFlow);
  const readyForCollection = activeOrders.filter(order => order.fulfilmentStatus === 'ready_for_collection');
  const priorityItems: Array<{
    id: string;
    kind: 'payment' | 'collection';
    ageDays: number;
    maskedPatientLabel: string;
    recordTarget: { kind: 'order'; id: string };
    summary: string;
  }> = [];

  for (const order of awaitingPayment) {
    const age = ageDays(timestamp(order.updatedAt, order.createdAt), now);
    if (age < 3) continue;
    priorityItems.push({
      id: `payment-${order.id}`,
      kind: 'payment',
      ageDays: age,
      maskedPatientLabel: maskPatientLabel(patientById.get(order.patientId)),
      recordTarget: { kind: 'order', id: order.id },
      summary: `Payment has been outstanding for ${age} day${age === 1 ? '' : 's'}.`,
    });
  }

  for (const order of readyForCollection) {
    const age = ageDays(timestamp(order.updatedAt, order.createdAt), now);
    if (age < 10) continue;
    priorityItems.push({
      id: `collection-${order.id}`,
      kind: 'collection',
      ageDays: age,
      maskedPatientLabel: maskPatientLabel(patientById.get(order.patientId)),
      recordTarget: { kind: 'order', id: order.id },
      summary: `Collection follow-up is overdue by ${age} day${age === 1 ? '' : 's'}.`,
    });
  }

  priorityItems.sort((left, right) => right.ageDays - left.ageDays);
  const organisation = params.organisation;
  const activePatients = params.patients.filter(patient => patient.status === 'ACTIVE').length;

  return {
    asOf: new Date(now).toISOString(),
    organisation: {
      id: organisation.id,
      tradingName: organisation.tradingName,
      status: lower(organisation.status),
      trainingMode: organisation.classification === 'TRAINING',
      allocationHoldingMode: organisation.classification === 'ALLOCATION_HOLDING',
    },
    enquiries: {
      pendingCount: pendingEnquiries.length,
      latestSubmittedAt: pendingEnquiries[0]?.submittedAt ?? null,
      state: pendingEnquiries.length ? 'hhh_reviewing' as const : 'none' as const,
    },
    summary: {
      activePatients,
      awaitingPayment: awaitingPayment.length,
      supplierFulfilment: supplierOrders.length,
      readyForCollection: readyForCollection.length,
      urgentTotal: priorityItems.length,
    },
    priorityItems,
    recentSessions: activeOrders
      .slice()
      .sort((left, right) => timestamp(right.updatedAt, right.createdAt) - timestamp(left.updatedAt, left.createdAt))
      .slice(0, 5)
      .map(order => ({
        orderId: order.id,
        maskedPatientLabel: maskPatientLabel(patientById.get(order.patientId)),
        occurredAt: order.updatedAt || order.createdAt,
        prescriptionCount: 0,
        status: order.status,
      })),
    handover: {
      activePatients,
      activePaymentLinks: awaitingPayment.length,
      supplierOrdersInProgress: supplierOrders.length,
      agedCollections: priorityItems.filter(item => item.kind === 'collection').length,
    },
    integrations: [
      { integration: 'curaleaf' as const, state: organisation.supplierOrdersEnabled ? 'unavailable' as const : 'not-configured' as const, checkedAt: null },
      { integration: 'worldpay' as const, state: organisation.worldpayEnabled ? 'unavailable' as const : 'not-configured' as const, checkedAt: null },
    ],
  };
}
