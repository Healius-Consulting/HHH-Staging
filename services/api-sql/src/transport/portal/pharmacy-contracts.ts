import {
  advanceFulfilmentStatus,
  dispatchStatusFromLines,
  latestShipmentCreatedAt,
  mergePriorPharmacyLines,
  normalisedFulfilmentLines,
  supplierFulfilmentStatus,
} from '../../application/orders/curaleaf-fulfilment.js';
import type { OrderDraftRecord, OrderRecord } from '../../repositories/ports/order.port.js';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import type { PatientRecord } from '../../repositories/ports/patient.port.js';
import type { TenantPendingEnquiryRecord } from '../../repositories/ports/intake.port.js';
import { sqlIntakeCaseReference } from './intake-contracts.js';
import { pendingEnquiryDisplayStatus, portalSourceType } from './intake-source.js';

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
    worldpayEnabled: organisation.worldpayEnabled,
    defaultPaymentRoute: lower(organisation.defaultPaymentRoute),
    autoPlacementEnabled: organisation.autoPlacementEnabled,
    testAccount: organisation.classification === 'TRAINING',
    gdprExempt: !organisation.gdprComplianceFlag,
    workspaceClassification: lower(organisation.classification),
  };
}

export function toPortalPendingEnquiry(record: TenantPendingEnquiryRecord) {
  const sourceType = portalSourceType(record.sourceType);
  return {
    id: record.id,
    submittedAt: record.submittedAt,
    caseReference: sqlIntakeCaseReference(record.id, record.submittedAt),
    displayStatus: pendingEnquiryDisplayStatus(record.followUpStatus),
    sourceType: sourceType ?? 'legacy_pharmacy_qr' as const,
  };
}

export function toPortalPatient(patient: PatientRecord) {
  const conditions = patient.conditions.map(condition => condition.conditionCode);
  const primaryCondition = patient.conditions.find(condition => condition.primary)?.conditionCode ?? conditions[0] ?? null;
  const source = patient.sourceSubmission;
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
    conditions,
    primaryCondition,
    referralSource: source?.sourceType ? portalSourceType(source.sourceType) : null,
    triedTwoTreatments: source?.triedTwoTreatments ?? null,
    psychiatricExclusion: source?.psychiatricExclusion ?? null,
    heardAbout: source?.heardAbout ?? null,
    marketingConsent: source?.marketingConsent ?? null,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };
}

export function buildPharmacyPatientDirectory(input: {
  patients: PatientRecord[];
  pendingEnquiries: TenantPendingEnquiryRecord[];
}) {
  return {
    patients: input.patients.map(toPortalPatient),
    enquiries: input.pendingEnquiries.map(toPortalPendingEnquiry),
    counts: {
      patients: input.patients.length,
      pendingEnquiries: input.pendingEnquiries.length,
      referred: input.patients.filter(patient => patient.status === 'REFERRED').length,
      active: input.patients.filter(patient => patient.status === 'ACTIVE').length,
    },
  };
}

export function toPortalOrder(order: OrderRecord & { curaleaf?: any }) {
  const snapshot = (order.quoteSnapshot ?? {}) as any;
  const persistedCuraleaf = snapshot?.curaleaf && typeof snapshot.curaleaf === 'object' ? snapshot.curaleaf : null;
  const po = order.curaleaf || persistedCuraleaf;
  const isCancelledOrder = order.status === 'CANCELLED' || po?.state === 'CANCELLED' || po?.purchaseOrderState === 'CANCELLED';
  const isPaid = !isCancelledOrder && (order.paymentStatus === 'PAID' || Boolean(order.paidAt));
  const hasCuraleafRecord = Boolean(po?.id || po?.purchaseOrderId || po?.customerReference || po?.items?.length || po?.shipments?.length);
  const isSupplierFlowActive = isPaid && (hasCuraleafRecord || ['SUPPLIER_PROCESSING', 'SUPPLIER_ALLOCATED', 'PARTIALLY_DISPATCHED_TO_PHARMACY', 'DISPATCHED_TO_PHARMACY', 'PARTIALLY_RECEIVED', 'RECEIVED', 'READY_FOR_COLLECTION', 'COLLECTED'].includes(order.fulfilmentStatus));

  const poItems = (po?.items && Array.isArray(po.items)) ? po.items : [];
  const poItemMap = new Map<string, any>(poItems.map((it: any) => [String(it.productId || it.formulaId || ''), it]));

  const rawLines = snapshot?.lineItems || snapshot?.items || [];
  const pricingQuote = snapshot?.pricingQuote || snapshot?.quote || null;
  const quoteItems = new Map((pricingQuote?.items || []).map((it: any) => [it.packId || it.productId, it]));

  const lineItems = Array.isArray(rawLines) && rawLines.length > 0 ? rawLines.map((item: any, idx: number) => {
    const packId = String(item.packId || item.productId || item.id || '');
    const quote = quoteItems.get(packId) as any;
    const poItem = poItemMap.get(packId);
    const itemQty = Number(item.quantity ?? item.qty ?? item.count ?? (poItem?.packsOrderedCount ? Number(poItem.packsOrderedCount) : 1));
    const rawTotal = order.totalPence ? Math.max(0, order.totalPence - (order.dispensingFeePence || 0)) : 0;
    const unitPricePence = Number(
      item.unitPricePence ||
      item.retailPence ||
      item.patientPackPricePence ||
      (quote ? Math.round(Number(quote.patientPackPrice || quote.patientPrice || 0) * 100) : 0) ||
      (rawTotal && rawLines.length === 1 && itemQty > 0 ? Math.round(rawTotal / itemQty) : 0)
    );

    return {
      productId: String(item.productId || item.packId || item.id || ''),
      formulaId: String(item.formulaId || poItem?.formulaId || ''),
      packId,
      name: String(item.name || item.formulaName || (quote ? 'Curaleaf medication' : 'Curaleaf prescription item')),
      quantity: itemQty,
      unitPricePence,
    };
  }) : poItems.map((poIt: any) => ({
    productId: poIt.productId,
    formulaId: poIt.formulaId,
    packId: poIt.productId,
    name: 'Curaleaf medication',
    quantity: Number(poIt.packsOrderedCount || 1),
    unitPricePence: Number(poIt.packsOrderedCount ? Math.round(Number(order.totalPence || 0) / Number(poIt.packsOrderedCount)) : Number(order.totalPence || 0)),
  }));

  const rawPrescriptions = snapshot?.prescriptions || [];
  const prescriptions = Array.isArray(rawPrescriptions) && rawPrescriptions.length > 0 ? rawPrescriptions.map((rx: any) => ({
    ...rx,
    items: lineItems,
  })) : (lineItems.length > 0 ? [{
    id: `rx-${order.id.slice(0, 8)}`,
    fileId: `rx-${order.id.slice(0, 8)}`,
    serialNumber: `RX-${order.orderNumber || order.id.slice(0, 8)}`,
    issueDate: order.submittedAt ? order.submittedAt.split('T')[0] : new Date().toISOString().split('T')[0],
    prescriber: {
      id: 'prescriber-default',
      name: 'Dr. S. Patel',
      gphcNumber: '2078912',
    },
    items: lineItems,
  }] : []);

  // Build prescriptionFlow with live pack quantities (ordered, allocated, shipped, awaiting shipment)
  const shipments = Array.isArray(po?.shipments) ? po.shipments : (Array.isArray(persistedCuraleaf?.shipments) ? persistedCuraleaf.shipments : []);
  const requestedItems = lineItems.map((item: { packId: string; productId: string; quantity: number }) => ({ packId: item.packId || item.productId, productId: item.productId, quantity: item.quantity }));
  const priorLines = mergePriorPharmacyLines(
    po?.lines,
    persistedCuraleaf?.lines,
    Object.values(snapshot?.prescriptionFlow || {}).flatMap((flow: any) => Array.isArray(flow?.lines) ? flow.lines : []),
  );
  const lines = isSupplierFlowActive ? normalisedFulfilmentLines({
    purchaseOrder: po,
    shipments,
    requestedItems,
    priorLines,
  }) : [];
  const dispatchStatus = dispatchStatusFromLines(shipments, lines);
  const hasCheckedInPacks = lines.some(line => line.received > 0 || line.collected > 0);
  const hasInTransitPacks = lines.some(line => line.shipped > line.received);
  const supplierComputed = supplierFulfilmentStatus({ purchaseOrder: po, shipments, lines });
  const rawComputedFulfilment = advanceFulfilmentStatus(
    order.fulfilmentStatus,
    supplierComputed,
  );
  const computedFulfilment = !hasCheckedInPacks && hasInTransitPacks
    ? (lines.some(line => line.remaining > 0) ? 'PARTIALLY_DISPATCHED_TO_PHARMACY' : 'DISPATCHED_TO_PHARMACY')
    : rawComputedFulfilment;
  const remainingOpenAfterGoodsIn = hasCheckedInPacks
    && lines.some(line => line.remaining > 0 || line.received < line.ordered || line.collected < line.ordered);
  const shipmentIds = (po?.shipmentIds ?? persistedCuraleaf?.shipmentIds ?? shipments.map((s: any) => s.id)).filter(Boolean);
  const shipmentStates = {
    ...(persistedCuraleaf?.shipmentStates && typeof persistedCuraleaf.shipmentStates === 'object' ? persistedCuraleaf.shipmentStates : {}),
    ...(po?.shipmentStates && typeof po.shipmentStates === 'object' ? po.shipmentStates : {}),
  };
  const placedAt = po?.createdAt || po?.issuedDate || order.paidAt || order.submittedAt || order.createdAt;
  const latestShipmentAt = latestShipmentCreatedAt(shipments);
  const prescriptionFlow: Record<string, any> = {};
  for (const rx of prescriptions) {
    const rxKey = String(rx.id || rx.fileId || `rx-${order.id.slice(0, 8)}`);
    prescriptionFlow[rxKey] = {
      id: rxKey,
      orderId: rxKey,
      state: isCancelledOrder ? 'CANCELLED_PURCHASE_ORDER'
        : remainingOpenAfterGoodsIn ? 'PARTIALLY_RECEIVED'
        : hasCheckedInPacks && order.fulfilmentStatus === 'COLLECTED' ? 'COLLECTED'
        : hasCheckedInPacks && order.fulfilmentStatus === 'READY_FOR_COLLECTION' ? 'READY_FOR_COLLECTION'
        : hasCheckedInPacks && order.fulfilmentStatus === 'RECEIVED' ? 'RECEIVED'
        : hasCheckedInPacks && (order.fulfilmentStatus === 'PARTIALLY_RECEIVED' || computedFulfilment === 'PARTIALLY_RECEIVED') ? 'PARTIALLY_RECEIVED'
        : isSupplierFlowActive ? 'PLACED' : 'AWAITING_PAYMENT',
      lines,
      shipmentIds,
      shipmentStates,
      dispatchStatus,
      quantityMismatch: lines.some(line => line.quantityMismatch),
      purchaseOrderId: po?.id || po?.purchaseOrderId || null,
      placedAt,
      latestShipmentAt,
    };
  }

  const portalFulfilment = isCancelledOrder
    ? 'cancelled'
    : remainingOpenAfterGoodsIn ? 'partially_received'
    : hasCheckedInPacks && order.fulfilmentStatus === 'READY_FOR_COLLECTION' ? 'ready_for_collection'
    : hasCheckedInPacks && order.fulfilmentStatus === 'RECEIVED' ? 'received'
    : hasCheckedInPacks && (order.fulfilmentStatus === 'PARTIALLY_RECEIVED' || computedFulfilment === 'PARTIALLY_RECEIVED') ? 'partially_received'
    : computedFulfilment === 'PARTIALLY_DISPATCHED_TO_PHARMACY' ? 'partially_dispatched_to_pharmacy'
    : computedFulfilment === 'DISPATCHED_TO_PHARMACY' ? 'dispatched_to_pharmacy'
    : computedFulfilment === 'PARTIALLY_RECEIVED' && hasCheckedInPacks ? 'partially_received'
    : computedFulfilment === 'SUPPLIER_ALLOCATED' ? 'supplier_allocated'
    : !hasCheckedInPacks && hasInTransitPacks
      ? (lines.some(line => line.remaining > 0) ? 'partially_dispatched_to_pharmacy' : 'dispatched_to_pharmacy')
    : !hasCheckedInPacks && ['ready_for_collection', 'received', 'partially_received'].includes(lower(order.fulfilmentStatus))
      ? (lines.some(line => line.remaining > 0) ? 'partially_dispatched_to_pharmacy' : 'dispatched_to_pharmacy')
    : lower(order.fulfilmentStatus);

  return {
    id: order.id,
    organisationId: order.organisationId,
    patientId: order.patientId,
    lineItems,
    prescriptions,
    prescriptionFlow,
    pricingQuote: pricingQuote ?? undefined,
    dispensingFeePence: Number(order.dispensingFeePence),
    totalPence: Number(order.totalPence),
    currency: order.currency === 'GBP' ? 'GBP' as const : 'GBP' as const,
    paymentRoute: lower(order.paymentRoute) === 'worldpay' ? 'worldpay' as const : 'manual' as const,
    paymentStatus: isCancelledOrder ? 'cancelled' : isPaid ? 'paid' : lower(order.paymentStatus),
    fulfilmentStatus: portalFulfilment,
    status: isCancelledOrder ? 'cancelled' : isPaid && order.status === 'SUBMITTED' ? 'processing' : lower(order.status),
    paymentTransactionReference: order.orderNumber,
    paidAt: order.paidAt,
    curaleafApprovedAt: po?.createdAt || po?.issuedDate || undefined,
    autoPlacementEnabled: true,
    ...(isSupplierFlowActive && hasCuraleafRecord ? {
      curaleaf: {
        status: 'purchase_order_submitted' as const,
        customerReference: po?.customerReference || order.orderNumber || order.id,
        purchaseOrderId: po?.id || po?.purchaseOrderId || order.orderNumber || order.id,
        purchaseOrderState: po?.state || po?.purchaseOrderState || 'CREATED',
        courier: po?.courier || 'POLAR_SPEED',
        issuedDate: po?.issuedDate ?? null,
        createdAt: po?.createdAt ?? null,
        shipments,
        shipmentIds,
        shipmentStates,
        dispatchStatus,
        quantityMismatch: lines.some(line => line.quantityMismatch),
        lines,
        supplierItems: po?.supplierItems || poItems.map((item: any) => ({
          productId: item.productId ?? null,
          packsOrderedCount: Number(item.packsOrderedCount || item.count || 0),
          packsAllocatedCount: Number(item.packsAllocatedCount || 0),
          packsReturnedCount: Number(item.packsReturnedCount || 0),
        })),
        quote: pricingQuote ?? undefined,
        items: po?.items,
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
      { integration: 'curaleaf' as const, state: 'not-configured' as const, checkedAt: null },
      { integration: 'worldpay' as const, state: 'not-configured' as const, checkedAt: null },
    ],
  };
}
