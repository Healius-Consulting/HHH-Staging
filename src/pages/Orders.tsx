import { useEffect, useMemo, useRef, useState } from 'react';
import { curaleafDeliveryGuidance } from '@hhh/domain/delivery';
import {
  AlertTriangle,
  Archive,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  Copy,
  CreditCard,
  FileCode2,
  FileText,
  Info,
  Layers2,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  Truck,
  UserRound,
  X,
  XCircle,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';
import {
  money,
  orderReference,
  rxRevenue,
  useApp,
  type CRMPatient,
  type ManualTender,
  type PatientOrder,
  type Prescription,
} from '../context/AppContext';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { confirmPortalOrderRefund, createPortalOrderRefund, handoutPortalOrder, placePrescriptionManually, recordCuraleafRejection, recordPortalCuraleafCancellation, recordPortalGoodsReceipt, recordPortalManualPayment, requestPortalOrderCancellation, resendWorldpayPaymentLink, updatePortalShipmentStatus } from '../shared/api';
import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';
import {
  orderAwaitingSupplierShipmentProductNames,
  orderCancellationResolution,
  orderHasInTransitPacks,
  orderHasPartialCollection,
  orderHasPartialPharmacyReceipt,
  orderHasUncollectedReceivedPacks,
  orderInTransitProductNames,
  orderPackTotals,
  orderStage,
  prescriptionStatusLabel,
  stageMatchesFilter,
  type OrderStage,
  type StageFilter,
} from '../utils/orderStage';
import { buildOrderTimelineEvents } from '../utils/orderTimeline';
import {
  collectOrderConsignments,
  orderCourierLabel,
  orderDeliveryDestination,
  orderFinancialTotal,
  shortConsignmentId,
} from '../utils/orderDetailsLedger';
type ManualPaymentForm = { tender: ManualTender; reference: string; notes: string; confirmed: boolean };
type GoodsReceiptDraft = { quantities: Record<string, number>; batches: Record<string, string>; expiries: Record<string, string>; note: string };

interface OrderRecord {
  order: PatientOrder;
  patient: CRMPatient | null;
  stage: OrderStage;
  unresolvedReason: ReturnType<typeof orderStage>['unresolvedReason'];
}

const DEFAULT_MANUAL_FORM: ManualPaymentForm = { tender: 'epos-card', reference: '', notes: '', confirmed: false };

const STAGE_META: Record<OrderStage, { label: string; description: string; tone: string; icon: LucideIcon }> = {
  'awaiting-payment': { label: 'Awaiting payment', description: 'Payment link active with patient', tone: 'warning', icon: Clock3 },
  paid: { label: 'Paid · Queued', description: 'Payment cleared; ready for Curaleaf placement', tone: 'paid', icon: CreditCard },
  'curaleaf-pending': { label: 'Curaleaf review', description: 'Prescription in pharmacist validation queue', tone: 'curaleaf-review', icon: CircleDot },
  'curaleaf-approved': { label: 'Curaleaf dispensing', description: 'Order approved; Curaleaf dispensary technicians allocating packs', tone: 'curaleaf-picking', icon: Package },
  dispatched: { label: 'In delivery', description: 'Dispatched with courier to the pharmacy', tone: 'dispatched', icon: Truck },
  delivered: { label: 'Delivered', description: 'Received at pharmacy; ready for check-in', tone: 'delivered', icon: PackageCheck },
  ready: { label: 'Ready to collect', description: 'Verified by pharmacy; patient notified', tone: 'ready', icon: Package },
  collected: { label: 'Collected', description: 'Medication handed out to patient', tone: 'collected', icon: Check },
  rejected: { label: 'Curaleaf exception', description: 'Order requires prescription or recipe fix', tone: 'danger', icon: ShieldAlert },
  archived: { label: 'Archived cycle', description: 'Prescription 28-day window expired', tone: 'neutral', icon: Archive },
  cancelled: { label: 'Cancelled', description: 'Cancellation recorded for audit', tone: 'danger', icon: XCircle },
};

const PRIMARY_FILTERS: Array<{ key: StageFilter; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: 'awaiting-payment', label: 'Awaiting payment' },
  { key: 'awaiting-fulfilment', label: 'Awaiting fulfilment' },
  { key: 'ready', label: 'Ready to collect' },
];

const SECONDARY_FILTERS: Array<{ key: StageFilter; label: string }> = [
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancellations' },
  { key: 'all', label: 'All history' },
];

function orderRecordPriority(record: OrderRecord) {
  const cancellationResolution = orderCancellationResolution(record.order);
  if (cancellationResolution === 'needs-action') return 0;
  if (record.stage === 'rejected') return 1;
  if (record.stage === 'ready') return 10;
  if (record.stage === 'delivered') return 20;

  const isDeliveryOrPartial = record.stage === 'dispatched' || record.order.prescriptions.some(rx =>
    rx.status === 'partially-received' || rx.dispatchStatus === 'partial' || rx.status === 'dispatched' || rx.shipmentIds?.length
  );
  if (isDeliveryOrPartial) return 30;

  const isPicking = record.stage === 'curaleaf-approved' || record.order.prescriptions.some(rx =>
    rx.purchaseOrderState === 'PROCESSING' || rx.purchaseOrderState === 'FULLY_ALLOCATED' || (rx.supplierItems ?? []).some(si => (si.packsAllocatedCount ?? 0) > 0)
  );
  if (isPicking) return 40;

  if (record.stage === 'curaleaf-pending' || record.stage === 'paid') return 50;
  if (record.stage === 'awaiting-payment') return 60;
  if (record.stage === 'collected') return 90;
  if (cancellationResolution !== 'none' || record.stage === 'archived' || record.stage === 'cancelled') return 99;
  return 70;
}

function recordMatchesFilter(record: OrderRecord, filter: StageFilter) {
  const cancellationResolution = orderCancellationResolution(record.order);
  if (cancellationResolution !== 'none') {
    if (filter === 'current') return cancellationResolution === 'needs-action';
    if (filter === 'cancelled' || filter === 'all') return true;
    return false;
  }
  return stageMatchesFilter(record.stage, filter);
}

function recordStageMeta(record: OrderRecord) {
  const resolution = orderCancellationResolution(record.order);
  if (record.stage === 'cancelled' && record.order.prescriptions.some(prescription => prescription.purchaseOrderState === 'CANCELLED' || prescription.status === 'cancelled')) {
    return {
      label: 'Cancelled purchase order',
      description: resolution === 'needs-action'
        ? 'Curaleaf cancelled the supplier purchase order. Review the pharmacy call or case notes and complete the refund follow-up.'
        : 'Curaleaf cancelled the supplier purchase order; its pharmacy call or case context remains in the audit trail.',
      tone: resolution === 'needs-action' ? 'warning' : 'neutral',
      icon: XCircle,
    };
  }
  if (resolution === 'needs-action') return { label: 'Cancellation action', description: 'Cancellation requires supplier or refund follow-up', tone: 'warning', icon: AlertTriangle };
  if (resolution === 'refunded') return { label: 'Refunded', description: 'Cancellation closed and patient refund completed', tone: 'refunded', icon: Banknote };
  if (resolution === 'resolved') return { label: 'Resolved', description: 'Cancellation closed with no action outstanding', tone: 'resolved', icon: CheckCircle2 };
  if (orderHasPartialCollection(record.order) && !orderHasInTransitPacks(record.order) && !orderHasUncollectedReceivedPacks(record.order)) {
    return {
      label: 'Part collected',
      description: 'Arrived packs handed out; remainder still with Curaleaf',
      tone: 'partial',
      icon: Layers2,
    };
  }
  if (orderHasPartialPharmacyReceipt(record.order) && !orderHasInTransitPacks(record.order)) {
    return {
      label: 'Part delivered',
      description: 'First consignment checked in; remainder still with Curaleaf',
      tone: 'partial',
      icon: Layers2,
    };
  }
  return STAGE_META[record.stage];
}

function formatDate(value: Date | string | null | undefined, includeTime = false) {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString('en-GB', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDeliveryDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export default function Orders() {
  const { state, dispatch } = useApp();
  const [activeFilter, setActiveFilter] = useState<StageFilter>('current');
  const [query, setQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [manualForms, setManualForms] = useState<Record<number, ManualPaymentForm>>({});
  const [submittingOrderId, setSubmittingOrderId] = useState<number | null>(null);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<number, GoodsReceiptDraft>>({});
  const [paymentLinkBusyOrderId, setPaymentLinkBusyOrderId] = useState<number | null>(null);
  const [fulfilmentBusyRxId, setFulfilmentBusyRxId] = useState<number | null>(null);
  const [refundBusyOrderId, setRefundBusyOrderId] = useState<number | null>(null);
  const [refundReferences, setRefundReferences] = useState<Record<number, string>>({});
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<'added_in_error' | 'patient_request' | 'other'>('added_in_error');
  const [cancelNote, setCancelNote] = useState('');
  const [cancellationReference, setCancellationReference] = useState('');
  const [cancellationContactNote, setCancellationContactNote] = useState('');
  const [cancellationBusyOrderId, setCancellationBusyOrderId] = useState<number | null>(null);
  const [callCuraleafModalOrder, setCallCuraleafModalOrder] = useState<PatientOrder | null>(null);
  const [chaseDeliveryModal, setChaseDeliveryModal] = useState<{ order: PatientOrder; prescription?: Prescription; shipmentId?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [handoutOrderId, setHandoutOrderId] = useState<number | null>(null);
  const [handoutPartial, setHandoutPartial] = useState(false);
  const [handoutShipmentId, setHandoutShipmentId] = useState<string | undefined>(undefined);
  const [handoutBusy, setHandoutBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [placementConfirmation, setPlacementConfirmation] = useState<{ orderId: number; message: string } | null>(null);
  const observedPlacements = useRef<Map<number, Set<number>> | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const current = new Map(state.orders.map(order => [order.id, new Set(order.prescriptions.filter(prescription => prescription.placed).map(prescription => prescription.id))]));
    if (!observedPlacements.current) {
      observedPlacements.current = current;
      return;
    }
    for (const order of state.orders) {
      const previous = observedPlacements.current.get(order.id);
      if (!previous) continue;
      const newlyPlaced = order.prescriptions.filter(prescription => prescription.placed && !previous.has(prescription.id));
      const placement = newlyPlaced.find(prescription => prescription.placedAt)?.placedAt;
      const guidance = placement ? curaleafDeliveryGuidance(placement) : null;
      if (guidance) {
        const message = `Order placed with Curaleaf ✓ Expected at the pharmacy ${formatDeliveryDate(guidance.windowStart)} – ${formatDeliveryDate(guidance.windowEnd)}. We'll tell the patient it's ready only once your team books it in — no action needed until it arrives.`;
        setPlacementConfirmation({ orderId: order.id, message });
      }
    }
    observedPlacements.current = current;
  }, [state.orders]);

  useEffect(() => {
    if (!placementConfirmation) return;
    const timer = window.setTimeout(() => setPlacementConfirmation(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [placementConfirmation]);

  const records = useMemo<OrderRecord[]>(() => state.orders
    .filter(order => order.organisationId === state.currentOrganisationId && order.payment.status !== 'none')
    .map(order => {
      const patient = order.patientId
        ? state.crm.find(candidate => candidate.organisationId === state.currentOrganisationId && candidate.id === order.patientId) ?? null
        : null;
      const resolvedStage = orderStage(order);
      return { order, patient, ...resolvedStage };
    })
    .sort((left, right) => {
      const priorityDifference = orderRecordPriority(left) - orderRecordPriority(right);
      return priorityDifference || right.order.date.getTime() - left.order.date.getTime();
    }), [state.crm, state.currentOrganisationId, state.orders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter(record => {
      if (!recordMatchesFilter(record, activeFilter)) return false;
      if (!needle) return true;
      const order = record.order;
      return [
        record.patient?.name,
        record.patient?.dob,
        record.patient?.email,
        record.patient?.mobile,
        order.id,
        order.backendId,
        ...order.prescriptions.flatMap(prescription => [prescription.poRef, prescription.serialNumber]),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
  }, [activeFilter, query, records]);

  useEffect(() => {
    if (!filtered.some(record => record.order.id === selectedOrderId)) setSelectedOrderId(filtered[0]?.order.id ?? null);
  }, [filtered, selectedOrderId]);

  useEffect(() => {
    const target = state.navigationTarget;
    if (target?.kind !== 'order') return;
    const orderId = Number(target.key.split('-')[0]);
    const targetRecord = records.find(record => record.order.id === orderId);
    if (targetRecord) {
      setActiveFilter(['resolved', 'refunded'].includes(orderCancellationResolution(targetRecord.order)) ? 'cancelled' : 'current');
      setQuery('');
      setSelectedOrderId(orderId);
    }
    dispatch({ type: 'CLEAR_NAVIGATION_TARGET' });
  }, [dispatch, records, state.navigationTarget]);

  const selected = filtered.find(record => record.order.id === selectedOrderId) ?? filtered[0] ?? null;
  const outstandingValue = records.filter(record => orderCancellationResolution(record.order) === 'none' && record.stage === 'awaiting-payment').reduce((sum, record) => sum + record.order.payment.amount, 0);
  const needsAction = records.filter(record => {
    const cancellationResolution = orderCancellationResolution(record.order);
    return cancellationResolution === 'needs-action'
      || cancellationResolution === 'none' && ['awaiting-payment', 'paid', 'rejected', 'delivered'].includes(record.stage);
  }).length;
  const readyCount = records.filter(record => orderCancellationResolution(record.order) === 'none' && record.stage === 'ready').length;
  const activeCount = records.filter(record => orderCancellationResolution(record.order) === 'none' && !['collected', 'archived', 'rejected', 'cancelled'].includes(record.stage)).length;

  const filterCount = (filter: StageFilter) => records.filter(record => recordMatchesFilter(record, filter)).length;
  const cancellationNeedsAction = activeFilter === 'cancelled' ? filtered.filter(record => orderCancellationResolution(record.order) === 'needs-action') : [];
  const cancellationClosed = activeFilter === 'cancelled' ? filtered.filter(record => ['resolved', 'refunded'].includes(orderCancellationResolution(record.order))) : [];

  const currentActionRequired = activeFilter === 'current' ? filtered.filter(record => {
    const resolution = orderCancellationResolution(record.order);
    return resolution === 'needs-action' || record.stage === 'rejected';
  }) : [];

  const currentReady = activeFilter === 'current' ? filtered.filter(record =>
    record.stage === 'ready'
  ) : [];

  const currentDelivery = activeFilter === 'current' ? filtered.filter(record => {
    if (record.stage === 'ready') return false;
    const isDeliveryOrPartial = record.stage === 'dispatched' || record.stage === 'delivered' || record.order.prescriptions.some(rx =>
      rx.status === 'partially-received' || rx.dispatchStatus === 'partial' || rx.status === 'dispatched' || Boolean(rx.shipmentIds?.length)
    );
    return isDeliveryOrPartial;
  }) : [];

  const currentPicking = activeFilter === 'current' ? filtered.filter(record => {
    if (['ready', 'dispatched', 'delivered'].includes(record.stage)) return false;
    const isDeliveryOrPartial = record.order.prescriptions.some(rx =>
      rx.status === 'partially-received' || rx.dispatchStatus === 'partial' || rx.status === 'dispatched' || Boolean(rx.shipmentIds?.length)
    );
    if (isDeliveryOrPartial) return false;
    const isPicking = record.stage === 'curaleaf-approved' || record.order.prescriptions.some(rx =>
      rx.purchaseOrderState === 'PROCESSING' || rx.purchaseOrderState === 'FULLY_ALLOCATED' || (rx.supplierItems ?? []).some(si => (si.packsAllocatedCount ?? 0) > 0)
    );
    return isPicking;
  }) : [];

  const currentProcessing = activeFilter === 'current' ? filtered.filter(record => {
    if (['ready', 'dispatched', 'delivered', 'awaiting-payment'].includes(record.stage)) return false;
    const isDeliveryOrPartial = record.order.prescriptions.some(rx =>
      rx.status === 'partially-received' || rx.dispatchStatus === 'partial' || rx.status === 'dispatched' || Boolean(rx.shipmentIds?.length)
    );
    if (isDeliveryOrPartial) return false;
    const isPicking = record.stage === 'curaleaf-approved' || record.order.prescriptions.some(rx =>
      rx.purchaseOrderState === 'PROCESSING' || rx.purchaseOrderState === 'FULLY_ALLOCATED' || (rx.supplierItems ?? []).some(si => (si.packsAllocatedCount ?? 0) > 0)
    );
    if (isPicking) return false;
    return ['paid', 'curaleaf-pending'].includes(record.stage);
  }) : [];

  const currentAwaitingPayment = activeFilter === 'current' ? filtered.filter(record =>
    record.stage === 'awaiting-payment'
  ) : [];

  const applyCancellationResponse = (order: PatientOrder, record: Awaited<ReturnType<typeof requestPortalOrderCancellation>>) => {
    if (!record.cancellation) return;
    dispatch({
      type: 'SET_ORDER_CANCELLATION',
      orderId: order.id,
      cancellation: record.cancellation,
      curaleafCancellation: record.curaleafCancellation,
      lifecycleStatus: record.status,
      paymentStatus: record.paymentStatus === 'cancelled' ? 'cancelled' : ['paid', 'refund_required', 'refunded'].includes(record.paymentStatus) ? 'paid' : 'sent',
    });
  };

  const requestCancellation = async (order: PatientOrder) => {
    if (cancellationBusyOrderId) return;
    setCancellationBusyOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live' && order.backendId) {
        const result = await requestPortalOrderCancellation(order.backendId, {
          organisationId: state.currentOrganisationId,
          reason: cancelReason,
          note: cancelNote.trim() || undefined,
        });
        applyCancellationResponse(order, result);
      } else {
        dispatch({ type: 'REQUEST_ORDER_CANCELLATION', orderId: order.id, reason: cancelReason, note: cancelNote });
      }
      if (order.patientId) dispatch({ type: 'LOG_INTERACTION', patientId: order.patientId, interactionType: 'Order cancellation requested', detail: `Cancellation requested for ${orderReference(order)}. ${order.payment.status === 'paid' ? 'Paid order requires pharmacy action.' : 'No settled patient payment recorded.'}` });
      const hasCuraleafOrder = order.payment.status === 'paid' && order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
      dispatch({ type: 'ADD_TOAST', message: hasCuraleafOrder ? 'Cancellation opened. Contact Curaleaf and record their confirmation before refunding or reordering.' : order.payment.status === 'paid' ? 'Paid cancellation flagged for pharmacy refund action.' : 'Order cancelled and its payment link retired in the platform.', toastType: hasCuraleafOrder || order.payment.status === 'paid' ? 'warning' : 'success' });
      setCancelOrderId(null);
      setCancelNote('');
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The cancellation could not be recorded.', toastType: 'error' });
    } finally { setCancellationBusyOrderId(null); }
  };

  const recordCuraleafCancellationStep = async (order: PatientOrder, action: 'contacted' | 'confirmed') => {
    if (cancellationBusyOrderId || cancellationReference.trim().length < 3) return;
    setCancellationBusyOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live' && order.backendId) {
        const result = await recordPortalCuraleafCancellation(order.backendId, {
          organisationId: state.currentOrganisationId,
          action,
          reference: cancellationReference.trim(),
          note: cancellationContactNote.trim() || undefined,
        });
        applyCancellationResponse(order, result);
      } else if (action === 'contacted') {
        dispatch({ type: 'RECORD_CURALEAF_CANCELLATION_CONTACT', orderId: order.id, reference: cancellationReference.trim(), note: cancellationContactNote });
      } else {
        dispatch({ type: 'CONFIRM_CURALEAF_CANCELLATION', orderId: order.id, reference: cancellationReference.trim() });
      }
      dispatch({ type: 'ADD_TOAST', message: action === 'contacted' ? 'Curaleaf contact recorded. Refund and replacement remain locked until cancellation is confirmed.' : 'Curaleaf cancellation confirmed. The paid-order refund action is now unlocked.', toastType: action === 'contacted' ? 'info' : 'success' });
      setCancellationReference('');
      setCancellationContactNote('');
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The Curaleaf cancellation step could not be recorded.', toastType: 'error' });
    } finally { setCancellationBusyOrderId(null); }
  };

  const handleConfirmCuraleafCancellationDirect = async (order: PatientOrder) => {
    setCancellationBusyOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live' && order.backendId) {
        const result = await requestPortalOrderCancellation(order.backendId, {
          organisationId: state.currentOrganisationId,
          reason: 'added_in_error',
          note: 'Cancelled by Curaleaf following phone support request',
        });
        applyCancellationResponse(order, result);
      } else {
        dispatch({ type: 'REQUEST_ORDER_CANCELLATION', orderId: order.id, reason: 'added_in_error', note: 'Cancelled via Curaleaf telephone support' });
        dispatch({ type: 'CONFIRM_CURALEAF_CANCELLATION', orderId: order.id, reference: 'Curaleaf phone confirmation' });
      }
      if (order.patientId) {
        dispatch({
          type: 'LOG_INTERACTION',
          patientId: order.patientId,
          interactionType: 'Curaleaf cancellation confirmed',
          detail: `Curaleaf cancellation confirmed for ${orderReference(order)}. Moved to Unresolved list for refund or replacement.`,
        });
      }
      dispatch({
        type: 'ADD_TOAST',
        message: `Curaleaf cancellation confirmed for ${orderReference(order)}. Moved to Unresolved.`,
        toastType: 'warning',
      });
      setActiveFilter('unresolved');
    } catch (error) {
      dispatch({
        type: 'ADD_TOAST',
        message: error instanceof Error ? error.message : 'The cancellation could not be recorded.',
        toastType: 'error',
      });
    } finally {
      setCancellationBusyOrderId(null);
    }
  };

  const requestRefund = async (order: PatientOrder, reason: 'patient_cancelled' | 'replacement_price_changed', resolution: 'cancel' | 'replace_new_payment') => {
    if (order.refund || refundBusyOrderId) return;
    setRefundBusyOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live' && order.backendId) {
        const refund = await createPortalOrderRefund(order.backendId, { organisationId: state.currentOrganisationId, reason, resolution });
        dispatch({ type: 'SET_ORDER_REFUND', orderId: order.id, refund });
      } else {
        dispatch({ type: 'START_ORDER_REFUND', orderId: order.id, reason, resolution });
      }
      dispatch({ type: 'ADD_TOAST', message: `Refund task created for ${orderReference(order)}. Complete it in ${order.payment.route === 'worldpay' ? 'Worldpay' : 'the pharmacy payment system'}, then record the confirmation.`, toastType: 'warning' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The refund task could not be created.', toastType: 'error' });
    } finally { setRefundBusyOrderId(null); }
  };

  const confirmRefund = async (order: PatientOrder) => {
    const externalReference = refundReferences[order.id]?.trim();
    if (!order.refund || !externalReference || refundBusyOrderId) return;
    setRefundBusyOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live' && order.backendId) {
        const refund = await confirmPortalOrderRefund(order.backendId, order.refund.id, { organisationId: state.currentOrganisationId, externalReference });
        dispatch({ type: 'SET_ORDER_REFUND', orderId: order.id, refund });
      } else {
        dispatch({ type: 'CONFIRM_ORDER_REFUND', orderId: order.id, externalReference });
      }
      dispatch({ type: 'ADD_TOAST', message: `Refund confirmed for ${orderReference(order)}.`, toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The refund could not be confirmed.', toastType: 'error' });
    } finally { setRefundBusyOrderId(null); }
  };
  const updateManualForm = (orderId: number, patch: Partial<ManualPaymentForm>) => setManualForms(current => ({
    ...current,
    [orderId]: { ...(current[orderId] ?? DEFAULT_MANUAL_FORM), ...patch },
  }));
  const receiptDraftFor = (prescription: Prescription): GoodsReceiptDraft => receiptDrafts[prescription.id] ?? {
    quantities: Object.fromEntries(prescription.items.map(item => [
      item.productId,
      prescription.receivedItems?.find(received => received.productId === item.productId)?.quantityReceived ?? 0,
    ])),
    batches: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
    expiries: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
    note: prescription.goodsInNote ?? '',
  };
  const updateReceiptDraft = (prescription: Prescription, patch: Partial<GoodsReceiptDraft>) => setReceiptDrafts(current => ({
    ...current,
    [prescription.id]: { ...receiptDraftFor(prescription), ...current[prescription.id], ...patch },
  }));

  const handleRecordManualPayment = async (order: PatientOrder) => {
    const form = manualForms[order.id] ?? DEFAULT_MANUAL_FORM;
    if (!form.confirmed) return;
    setSubmittingOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!order.backendId) throw new Error('This order has not finished saving. Refresh and try again.');
        if (!form.reference.trim()) throw new Error('Enter the pharmacy receipt reference before recording a live payment.');
        const tender = ({ 'epos-card': 'epos', cash: 'cash', 'bank-transfer': 'bank_transfer', other: 'other' } as const)[form.tender];
        await recordPortalManualPayment(order.backendId, {
          organisationId: state.currentOrganisationId,
          amountPence: Math.round(order.payment.amount * 100),
          tender,
          reference: form.reference.trim(),
          notes: form.notes.trim() || undefined,
        });
        dispatch({ type: 'RECORD_MANUAL_PAYMENT', orderId: order.id, tender: form.tender, reference: form.reference, notes: form.notes });
        dispatch({ type: 'ADD_TOAST', message: 'Payment recorded. Order processing will continue.', toastType: 'success' });
      } else {
        dispatch({ type: 'RECORD_MANUAL_PAYMENT', orderId: order.id, tender: form.tender, reference: form.reference, notes: form.notes });
        dispatch({ type: 'ADD_TOAST', message: 'Training payment recorded locally.', toastType: 'info' });
      }
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Payment could not be recorded.', toastType: 'error' });
    } finally {
      setSubmittingOrderId(null);
    }
  };

  const handleGoodsReceipt = async (order: PatientOrder, prescription: Prescription, complete: boolean, shipmentId?: string) => {
    const draft = receiptDraftFor(prescription);
    const selectedConsignment = (shipmentId ?? prescription.shipmentId ?? prescription.shipmentIds?.[0])
      ? prescription.shipments?.find(shipment => shipment.id === (shipmentId ?? prescription.shipmentId ?? prescription.shipmentIds?.[0]))
      : prescription.shipments?.[0];
    const consignmentPacksFor = (productId: string) => {
      const fromShipment = selectedConsignment?.items?.filter(item => item.productId === productId).reduce((sum, item) => sum + Number(item.packCount || 0), 0) ?? 0;
      if (fromShipment > 0) return fromShipment;
      return prescription.fulfilmentLines?.find(line => line.productId === productId)?.shipped ?? 0;
    };
    const lines = prescription.items.map(item => {
      const shipped = consignmentPacksFor(item.productId);
      const accepted = complete ? shipped : Math.max(0, Math.min(shipped || item.qty, Math.floor(draft.quantities[item.productId] ?? 0)));
      return {
        productId: item.productId,
        quantityReceived: accepted,
      };
    });
    const anyReceived = lines.some(line => line.quantityReceived > 0);
    const consignmentTotal = prescription.items.reduce((sum, item) => sum + consignmentPacksFor(item.productId), 0);
    const allConsignmentReceived = consignmentTotal > 0 && prescription.items.every(item =>
      (lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0) >= consignmentPacksFor(item.productId),
    );
    if (!complete && !anyReceived) {
      dispatch({ type: 'ADD_TOAST', message: 'Enter at least one received pack before saving a partial delivery.', toastType: 'warning' });
      return;
    }
    if (!complete && allConsignmentReceived) {
      dispatch({ type: 'ADD_TOAST', message: 'All arriving packs are present. Use Accept Delivery instead.', toastType: 'info' });
      return;
    }
    setFulfilmentBusyRxId(prescription.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        const targetShipmentId = shipmentId ?? prescription.shipmentId ?? prescription.shipmentIds?.[0];
        if (!targetShipmentId || !order.backendId) {
          throw new Error('This consignment is not linked to the order yet. Refresh and try again.');
        }
        await recordPortalGoodsReceipt(targetShipmentId, {
          organisationId: state.currentOrganisationId,
          orderId: order.backendId,
          items: prescription.items.map(item => ({
            productId: item.productId,
            expectedQuantity: consignmentPacksFor(item.productId),
            receivedQuantity: lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0,
            batchNumber: null,
            expiryDate: null,
            issue: 'none',
          })),
        });
      }
      dispatch({ type: 'RECORD_GOODS_RECEIPT', orderId: order.id, rxId: prescription.id, lines, note: draft.note });
      setReceiptDrafts(current => ({ ...current, [prescription.id]: { ...draft, quantities: Object.fromEntries(lines.map(line => [line.productId, line.quantityReceived])), note: draft.note } }));
      dispatch({ type: 'ADD_TOAST', message: complete ? 'Arriving consignment checked in.' : 'Partial check-in saved for this consignment.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The delivery receipt could not be saved.', toastType: 'error' });
    } finally {
      setFulfilmentBusyRxId(null);
    }
  };

  const handleReadyForCollection = async (order: PatientOrder, prescription: Prescription, shipmentId?: string) => {
    setFulfilmentBusyRxId(prescription.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        const targetShipmentId = shipmentId ?? prescription.shipmentId ?? prescription.shipmentIds?.[0] ?? prescription.poRef ?? `rx-${prescription.id}`;
        await updatePortalShipmentStatus(targetShipmentId, {
          organisationId: state.currentOrganisationId,
          orderId: order.backendId,
          status: 'ready_for_collection',
        }).catch(err => console.warn('Ready status sync warning:', err));
      }
      dispatch({ type: 'MARK_READY_FOR_COLLECTION', orderId: order.id, rxId: prescription.id });
      dispatch({ type: 'ADD_TOAST', message: 'This shipment is ready and customer message has been queued.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Ready-to-collect could not be confirmed.', toastType: 'error' });
    } finally {
      setFulfilmentBusyRxId(null);
    }
  };

  const handleOrderHandout = async (order: PatientOrder, partial = false, shipmentId?: string) => {
    if (handoutBusy) return;
    const remainingOpen = order.prescriptions.some(prescription =>
      (prescription.fulfilmentLines ?? []).some(line => line.remaining > 0 || line.received < line.ordered || line.collected < line.ordered),
    );
    if (!partial && remainingOpen) {
      dispatch({ type: 'ADD_TOAST', message: 'Remaining packs are still open with Curaleaf. Use partial handover for arrived packs only.', toastType: 'warning' });
      return;
    }
    setHandoutBusy(true);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!order.backendId) throw new Error('This order has not finished saving. Refresh and try again.');
        await handoutPortalOrder(order.backendId, {
          organisationId: state.currentOrganisationId,
          partial,
          shipmentId,
        });
      }
      dispatch({ type: 'HANDOUT_ORDER', orderId: order.id, partial, shipmentId });
      dispatch({
        type: 'ADD_TOAST',
        message: partial ? 'Partial handover recorded. Remaining packs stay open with Curaleaf.' : 'Handover recorded. The order is now completed.',
        toastType: 'success',
      });
      setHandoutOrderId(null);
      if (!partial && !remainingOpen) setActiveFilter('completed');
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The handout could not be recorded.', toastType: 'error' });
    } finally {
      setHandoutBusy(false);
    }
  };

  const handlePaymentLinkResend = async (order: PatientOrder) => {
    if (!order.backendId || paymentLinkBusyOrderId) return;
    setPaymentLinkBusyOrderId(order.id);
    try {
      const session = await resendWorldpayPaymentLink(order.backendId, { organisationId: state.currentOrganisationId });
      const provider = session.provider as { url?: string; _links?: { redirect?: { href?: string } } };
      const paymentUrl = provider.url ?? provider._links?.redirect?.href;
      if (paymentUrl) await navigator.clipboard.writeText(paymentUrl).catch(() => undefined);
      dispatch({ type: 'ADD_TOAST', message: paymentUrl ? 'The old link was voided; the fresh 72-hour link was copied.' : 'The old link was voided and a fresh payment generation was issued.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The payment link could not be reissued.', toastType: 'error' });
    } finally { setPaymentLinkBusyOrderId(null); }
  };

  const handleRecordRejection = async (order: PatientOrder, prescription: Prescription) => {
    if (!order.backendId || !prescription.backendId) return;
    const reason = window.prompt('Record Curaleaf’s rejection reason exactly as supplied:')?.trim();
    if (!reason) return;
    setFulfilmentBusyRxId(prescription.id);
    try {
      await recordCuraleafRejection(order.backendId, { organisationId: state.currentOrganisationId, prescriptionId: prescription.backendId, reason });
      dispatch({ type: 'ADD_TOAST', message: 'Curaleaf rejection recorded and linked to a support case.', toastType: 'warning' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The rejection could not be recorded.', toastType: 'error' });
    } finally { setFulfilmentBusyRxId(null); }
  };

  const handleManualPlace = async (order: PatientOrder, prescription: Prescription) => {
    if (!order.backendId || !prescription.backendId) return;
    setFulfilmentBusyRxId(prescription.id);
    try {
      await placePrescriptionManually(order.backendId, prescription.backendId, state.currentOrganisationId);
      dispatch({ type: 'ADD_TOAST', message: 'Manual placement was requested and recorded in the audit trail.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The prescription could not be placed.', toastType: 'error' });
    } finally { setFulfilmentBusyRxId(null); }
  };

  return (
    <div className="page-body order-crm">
      <section className="order-crm-summary" aria-label="Order pipeline summary">
        <SummaryMetric label="Active orders" value={String(activeCount)} detail="Across payment, Curaleaf and fulfilment" icon={Package} tone="primary" />
        <SummaryMetric label="Needs action" value={String(needsAction)} detail="Payment, submission or exception" icon={AlertTriangle} tone="warning" />
        <SummaryMetric label="Outstanding" value={money(outstandingValue)} detail="Awaiting patient payment" icon={CreditCard} tone="warning" />
        <SummaryMetric label="Ready to collect" value={String(readyCount)} detail="Patient collection queue" icon={PackageCheck} tone="success" />
      </section>

      <section className="order-crm-controls">
        <div className="order-crm-search">
          <Search size={15} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search patient, order, prescription or PO reference" aria-label="Search orders" />
        </div>
        <div className="order-crm-filters" role="group" aria-label="Filter orders by journey stage">
          {PRIMARY_FILTERS.map(filter => (
            <button type="button" key={filter.key} className={activeFilter === filter.key ? 'active' : ''} aria-pressed={activeFilter === filter.key} onClick={() => setActiveFilter(filter.key)}>
              <span>{filter.label}</span><strong>{filterCount(filter.key)}</strong>
            </button>
          ))}
          <details className={`order-filter-more${SECONDARY_FILTERS.some(filter => filter.key === activeFilter) ? ' active' : ''}`}>
            <summary>
              <span>{SECONDARY_FILTERS.find(filter => filter.key === activeFilter)?.label ?? 'More'}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div role="group" aria-label="More order filters">
              {SECONDARY_FILTERS.map(filter => (
                <button type="button" key={filter.key} className={activeFilter === filter.key ? 'active' : ''} aria-pressed={activeFilter === filter.key} onClick={event => { setActiveFilter(filter.key); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                  <span>{filter.label}</span><strong>{filterCount(filter.key)}</strong>
                </button>
              ))}
            </div>
          </details>
        </div>
      </section>

      <div className="order-crm-workspace">
        <aside className="order-crm-list" aria-label="Orders">
          <header><span><small>{activeFilter === 'cancelled' ? 'Cancellation history' : 'Orders'}</small><strong>{filtered.length} result{filtered.length === 1 ? '' : 's'}</strong></span></header>
          <div className="order-crm-list__rows">
            {filtered.length ? (
              activeFilter === 'cancelled' ? (
                <>
                  <OrderListGroup label="Needs action" detail="Supplier or refund follow-up" records={cancellationNeedsAction} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} />
                  <OrderListGroup label="Resolved & refunded" detail="Closed order history" records={cancellationClosed} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} />
                </>
              ) : activeFilter === 'current' ? (
                <>
                  {currentActionRequired.length ? <OrderListGroup label="Action required" detail="Exceptions & cancellations" records={currentActionRequired} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                  {currentReady.length ? <OrderListGroup label="Ready to collect" detail="Medication ready for patient pickup" records={currentReady} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                  {currentDelivery.length ? <OrderListGroup label="In delivery & arrived" detail="In transit with courier or arrived for check-in" records={currentDelivery} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                  {currentPicking.length ? <OrderListGroup label="Curaleaf dispensing" detail="Curaleaf allocating and packing medication" records={currentPicking} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                  {currentProcessing.length ? <OrderListGroup label="Processing" detail="Order confirmed; awaiting lab picking queue" records={currentProcessing} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                  {currentAwaitingPayment.length ? <OrderListGroup label="Awaiting payment" detail="Payment link sent to patient" records={currentAwaitingPayment} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} /> : null}
                </>
              ) : (
                filtered.map(record => (
                  <OrderListRow key={record.order.id} record={record} selected={selected?.order.id === record.order.id} now={now} onSelect={() => setSelectedOrderId(record.order.id)} />
                ))
              )
            ) : <div className="order-crm-empty"><Package size={26} /><strong>No orders in this stage</strong><span>Try another filter or search term.</span></div>}
          </div>
        </aside>

        <main className="order-crm-detail">
          {selected ? (
            <OrderDetail
              key={selected.order.id}
              record={selected}
              now={now}
              placementConfirmation={placementConfirmation?.orderId === selected.order.id ? placementConfirmation.message : null}
              handoutBusy={handoutBusy}
              onOpenHandout={(partial, shipmentId) => {
                setHandoutPartial(partial);
                setHandoutShipmentId(shipmentId);
                setHandoutOrderId(selected.order.id);
              }}
              manualForm={manualForms[selected.order.id] ?? DEFAULT_MANUAL_FORM}
              onManualFormChange={patch => updateManualForm(selected.order.id, patch)}
              onRecordManual={() => void handleRecordManualPayment(selected.order)}
              onRedo={() => {
                const existingDraft = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'none' && order.redoContext?.originalOrderId === selected.order.id);
                dispatch({ type: 'START_REDO_ORDER', sourceOrderId: selected.order.id });
                dispatch({ type: 'ADD_TOAST', message: existingDraft ? `Opened existing replacement ${orderReference(existingDraft)}.` : `Started a replacement draft for ${orderReference(selected.order)}.`, toastType: 'info' });
              }}
              busy={submittingOrderId === selected.order.id}
              receiptDrafts={receiptDrafts}
              fulfilmentBusyRxId={fulfilmentBusyRxId}
              onReceiptDraftChange={updateReceiptDraft}
              onSavePartial={(prescription, shipmentId) => void handleGoodsReceipt(selected.order, prescription, false, shipmentId)}
              onConfirmDelivery={(prescription, shipmentId) => void handleGoodsReceipt(selected.order, prescription, true, shipmentId)}
              onReadyForCollection={(prescription, shipmentId) => void handleReadyForCollection(selected.order, prescription, shipmentId)}
              onCallCuraleaf={() => setCallCuraleafModalOrder(selected.order)}
              onManualPlace={prescription => void handleManualPlace(selected.order, prescription)}
              onPaymentLinkResend={() => void handlePaymentLinkResend(selected.order)}
              paymentLinkBusy={paymentLinkBusyOrderId === selected.order.id}
              refundReference={refundReferences[selected.order.id] ?? ''}
              onRefundReferenceChange={value => setRefundReferences(current => ({ ...current, [selected.order.id]: value }))}
              onRequestRefund={(reason, resolution) => void requestRefund(selected.order, reason, resolution)}
              onConfirmRefund={() => void confirmRefund(selected.order)}
              refundBusy={refundBusyOrderId === selected.order.id}
              cancellationEditorOpen={cancelOrderId === selected.order.id}
              cancellationReason={cancelReason}
              cancellationNote={cancelNote}
              cancellationReference={cancellationReference}
              cancellationContactNote={cancellationContactNote}
              cancellationBusy={cancellationBusyOrderId === selected.order.id}
              onOpenCancellation={() => { setCancelOrderId(selected.order.id); setCancelReason('added_in_error'); setCancelNote(''); }}
              onCloseCancellation={() => setCancelOrderId(null)}
              onCancellationReasonChange={setCancelReason}
              onCancellationNoteChange={setCancelNote}
              onCancellationReferenceChange={setCancellationReference}
              onCancellationContactNoteChange={setCancellationContactNote}
              onRequestCancellation={() => void requestCancellation(selected.order)}
              onRecordCuraleafContact={() => void recordCuraleafCancellationStep(selected.order, 'contacted')}
              onConfirmCuraleafCancellation={() => void recordCuraleafCancellationStep(selected.order, 'confirmed')}
              onChaseDelivery={(prescription, shipmentId) => setChaseDeliveryModal({ order: selected.order, prescription, shipmentId })}
            />
          ) : <div className="order-crm-empty order-crm-empty--detail"><Package size={38} /><strong>Select an order</strong><span>Customer journey, payment and fulfilment information will appear here.</span></div>}
        </main>
      </div>
      {chaseDeliveryModal ? (
        <div className="order-handout-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setChaseDeliveryModal(null); }}>
          <section className="curaleaf-call-modal" role="dialog" aria-modal="true" aria-labelledby="chase-curaleaf-title">
            <header className="curaleaf-call-modal__header">
              <div className="curaleaf-call-modal__header-left">
                <span className="curaleaf-call-modal__icon-pill"><PhoneCall size={20} /></span>
                <div className="curaleaf-call-modal__header-titles">
                  <span className="curaleaf-call-modal__eyebrow">Delivery & Transit Support</span>
                  <h2 id="chase-curaleaf-title" className="curaleaf-call-modal__title">Chase Delivery / Report Issue with Curaleaf</h2>
                </div>
              </div>
              <button type="button" className="curaleaf-call-modal__close" onClick={() => setChaseDeliveryModal(null)} aria-label="Close dialog">
                <X size={18} />
              </button>
            </header>

            <p className="curaleaf-call-modal__desc">
              Contact Curaleaf Customer Services to chase this dispatched consignment or report transit discrepancies (short shipment, damaged packaging, or missing items):
            </p>

            <div className="curaleaf-call-modal__phone-card">
              <div className="curaleaf-call-modal__phone-info">
                <span className="curaleaf-call-modal__phone-label">Curaleaf Dispatch & Pharmacy Support</span>
                <strong className="curaleaf-call-modal__phone-number">0113 873 0000</strong>
              </div>
              <a href="tel:01138730000" className="curaleaf-call-modal__call-btn">
                <Phone size={13} /> Call now
              </a>
            </div>

            <div className="curaleaf-call-modal__refs-card">
              <div className="curaleaf-call-modal__ref-item">
                <span className="curaleaf-call-modal__ref-label">PO Reference</span>
                <div className="curaleaf-call-modal__ref-value-row">
                  <code className="curaleaf-call-modal__ref-code">
                    {chaseDeliveryModal.prescription?.poRef ?? chaseDeliveryModal.order.prescriptions.find(p => p.poRef)?.poRef ?? orderReference(chaseDeliveryModal.order)}
                  </code>
                  <button
                    type="button"
                    className={`curaleaf-call-modal__copy-btn${copiedKey === 'chasePoRef' ? ' curaleaf-call-modal__copy-btn--copied' : ''}`}
                    onClick={() => {
                      const ref = chaseDeliveryModal.prescription?.poRef ?? chaseDeliveryModal.order.prescriptions.find(p => p.poRef)?.poRef ?? orderReference(chaseDeliveryModal.order);
                      void navigator.clipboard.writeText(String(ref));
                      setCopiedKey('chasePoRef');
                      window.setTimeout(() => setCopiedKey(null), 2000);
                    }}
                  >
                    {copiedKey === 'chasePoRef' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKey === 'chasePoRef' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {chaseDeliveryModal.shipmentId ? (
                <div className="curaleaf-call-modal__ref-item">
                  <span className="curaleaf-call-modal__ref-label">Consignment / Shipment ID</span>
                  <div className="curaleaf-call-modal__ref-value-row">
                    <code className="curaleaf-call-modal__ref-code">{chaseDeliveryModal.shipmentId}</code>
                    <button
                      type="button"
                      className={`curaleaf-call-modal__copy-btn${copiedKey === 'chaseShp' ? ' curaleaf-call-modal__copy-btn--copied' : ''}`}
                      onClick={() => {
                        void navigator.clipboard.writeText(chaseDeliveryModal.shipmentId || '');
                        setCopiedKey('chaseShp');
                        window.setTimeout(() => setCopiedKey(null), 2000);
                      }}
                    >
                      {copiedKey === 'chaseShp' ? <Check size={11} /> : <Copy size={11} />}
                      {copiedKey === 'chaseShp' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="curaleaf-call-modal__ref-item">
                <span className="curaleaf-call-modal__ref-label">Order Number</span>
                <div className="curaleaf-call-modal__ref-value-row">
                  <code className="curaleaf-call-modal__ref-code">{orderReference(chaseDeliveryModal.order)}</code>
                  <button
                    type="button"
                    className={`curaleaf-call-modal__copy-btn${copiedKey === 'chaseOrderNum' ? ' curaleaf-call-modal__copy-btn--copied' : ''}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(orderReference(chaseDeliveryModal.order));
                      setCopiedKey('chaseOrderNum');
                      window.setTimeout(() => setCopiedKey(null), 2000);
                    }}
                  >
                    {copiedKey === 'chaseOrderNum' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKey === 'chaseOrderNum' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="curaleaf-call-modal__guidance">
              <Info size={16} />
              <span>
                Quote the <strong>PO Reference</strong> and <strong>Consignment ID</strong> to Curaleaf Customer Services so they can instantly locate the courier manifest with Polar Speed / DX.
              </span>
            </div>

            <footer className="curaleaf-call-modal__footer">
              <button type="button" className="btn btn-primary" onClick={() => setChaseDeliveryModal(null)}>Done</button>
            </footer>
          </section>
        </div>
      ) : null}
      {callCuraleafModalOrder ? (
        <div className="order-handout-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCallCuraleafModalOrder(null); }}>
          <section className="curaleaf-call-modal" role="dialog" aria-modal="true" aria-labelledby="call-curaleaf-title">
            <header className="curaleaf-call-modal__header">
              <div className="curaleaf-call-modal__header-left">
                <span className="curaleaf-call-modal__icon-pill"><PhoneCall size={20} /></span>
                <div className="curaleaf-call-modal__header-titles">
                  <span className="curaleaf-call-modal__eyebrow">Supplier cancellation</span>
                  <h2 id="call-curaleaf-title" className="curaleaf-call-modal__title">Call Curaleaf to Cancel Purchase Order</h2>
                </div>
              </div>
              <button type="button" className="curaleaf-call-modal__close" onClick={() => setCallCuraleafModalOrder(null)} aria-label="Close dialog">
                <X size={18} />
              </button>
            </header>

            <p className="curaleaf-call-modal__desc">
              Contact Curaleaf Customer Services to cancel the Purchase Order on their laboratory cleanroom system. Quote the references below:
            </p>

            <div className="curaleaf-call-modal__phone-card">
              <div className="curaleaf-call-modal__phone-info">
                <span className="curaleaf-call-modal__phone-label">Curaleaf Customer Support</span>
                <strong className="curaleaf-call-modal__phone-number">0113 873 0000</strong>
              </div>
              <a href="tel:01138730000" className="curaleaf-call-modal__call-btn">
                <Phone size={13} /> Call now
              </a>
            </div>

            <div className="curaleaf-call-modal__refs-card">
              <div className="curaleaf-call-modal__ref-item">
                <span className="curaleaf-call-modal__ref-label">PO Reference</span>
                <div className="curaleaf-call-modal__ref-value-row">
                  <code className="curaleaf-call-modal__ref-code">
                    {callCuraleafModalOrder.prescriptions.find(p => p.poRef)?.poRef ?? orderReference(callCuraleafModalOrder)}
                  </code>
                  <button
                    type="button"
                    className={`curaleaf-call-modal__copy-btn${copiedKey === 'poRef' ? ' curaleaf-call-modal__copy-btn--copied' : ''}`}
                    onClick={() => {
                      const ref = callCuraleafModalOrder.prescriptions.find(p => p.poRef)?.poRef ?? orderReference(callCuraleafModalOrder);
                      void navigator.clipboard.writeText(String(ref));
                      setCopiedKey('poRef');
                      window.setTimeout(() => setCopiedKey(null), 2000);
                    }}
                  >
                    {copiedKey === 'poRef' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKey === 'poRef' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="curaleaf-call-modal__ref-item">
                <span className="curaleaf-call-modal__ref-label">Prescription Serial</span>
                <div className="curaleaf-call-modal__ref-value-row">
                  <code className="curaleaf-call-modal__ref-code">
                    {callCuraleafModalOrder.prescriptions.find(p => p.serialNumber)?.serialNumber ?? 'Not recorded'}
                  </code>
                  <button
                    type="button"
                    className={`curaleaf-call-modal__copy-btn${copiedKey === 'serial' ? ' curaleaf-call-modal__copy-btn--copied' : ''}`}
                    onClick={() => {
                      const serial = callCuraleafModalOrder.prescriptions.find(p => p.serialNumber)?.serialNumber ?? '';
                      void navigator.clipboard.writeText(String(serial));
                      setCopiedKey('serial');
                      window.setTimeout(() => setCopiedKey(null), 2000);
                    }}
                  >
                    {copiedKey === 'serial' ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKey === 'serial' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="curaleaf-call-modal__guidance">
              <Info size={16} />
              <span>
                When Curaleaf confirms cancellation on their side, this order will automatically move to your <strong>Unresolved</strong> list to issue a Worldpay refund or create a replacement reorder.
              </span>
            </div>

            <footer className="curaleaf-call-modal__footer">
              <button type="button" className="btn btn-primary" onClick={() => setCallCuraleafModalOrder(null)}>Done</button>
            </footer>
          </section>
        </div>
      ) : null}
      {handoutOrderId && selected?.order.id === handoutOrderId ? (
        <div className="order-handout-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !handoutBusy) { setHandoutOrderId(null); setHandoutPartial(false); setHandoutShipmentId(undefined); } }}>
          <section className="order-handout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="order-handout-title" aria-describedby="order-handout-description">
            <span className="order-handout-dialog__icon"><PackageCheck size={22} /></span>
            <div>
              <small>Patient handout</small>
              <h2 id="order-handout-title">{handoutPartial ? 'Confirm partial handover to patient' : 'Confirm medication has been handed to the patient'}</h2>
              <p id="order-handout-description">
                {handoutPartial
                  ? `This records handover of arrived packs only for ${orderReference(selected.order)}. Remaining quantity stays open with Curaleaf.`
                  : `This completes ${orderReference(selected.order)} and records the handout in the audit trail.`}
              </p>
            </div>
            <footer>
              <button type="button" className="btn btn-secondary" disabled={handoutBusy} onClick={() => { setHandoutOrderId(null); setHandoutPartial(false); setHandoutShipmentId(undefined); }}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={handoutBusy} onClick={() => void handleOrderHandout(selected.order, handoutPartial, handoutShipmentId)}>
                <Check size={14} /> {handoutBusy ? 'Recording handout…' : handoutPartial ? 'Confirm partial handover' : 'Confirm handout'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SummaryMetric({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: LucideIcon; tone: string }) {
  return <article className={`order-crm-metric order-crm-metric--${tone}`}><span className="order-crm-metric__icon"><Icon size={16} /></span><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></article>;
}

function OrderListGroup({ label, detail, records, selectedOrderId, now, onSelect }: {
  label: string;
  detail: string;
  records: OrderRecord[];
  selectedOrderId: number | null;
  now: Date;
  onSelect: (orderId: number) => void;
}) {
  if (!records.length) return null;
  return (
    <section className="order-crm-list-group" aria-label={label}>
      <header><span><strong>{label}</strong><small>{detail}</small></span><b>{records.length}</b></header>
      {records.map(record => <OrderListRow key={record.order.id} record={record} selected={selectedOrderId === record.order.id} now={now} onSelect={() => onSelect(record.order.id)} />)}
    </section>
  );
}

function OrderListRow({ record, selected, now, onSelect }: { record: OrderRecord; selected: boolean; now: Date; onSelect: () => void }) {
  const meta = recordStageMeta(record);
  const Icon = meta.icon;
  const patientName = record.patient?.name ?? 'Unknown patient';
  const cancellationResolution = orderCancellationResolution(record.order);
  const isCancellation = cancellationResolution !== 'none';
  return (
    <button type="button" className={`order-crm-row${meta.tone === 'partial' ? ' order-crm-row--partial' : ''}${isCancellation ? ` order-crm-row--cancelled order-crm-row--${cancellationResolution}` : ''}${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className={`order-crm-row__stage order-tone--${meta.tone}`}><Icon size={15} /></span>
      <span className="order-crm-row__identity"><strong title={patientName}>{compactPatientName(patientName)}</strong><small>{record.order.redoContext ? 'Replacement' : 'Order'} {orderReference(record.order)} · {record.order.prescriptions.length} Rx</small></span>
      <span className="order-crm-row__position"><strong>{money(record.order.payment.amount)}</strong><small>{shipmentListCopy(record, now) ?? formatDate(record.order.date)}</small></span>
      <span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span>
    </button>
  );
}

function ExpiryCountdown({ order, now }: { order: PatientOrder; now: Date }) {
  if (order.payment.status === 'none') return null;
  if (order.prescriptions.every(rx => rx.status === 'collected' || rx.status === 'cancelled')) return null;
  if (order.isExpired || order.unresolvedReason === 'expired') return null;

  const entryDate = new Date(order.date);
  const expiryDate = order.cycleExpiresAt ? new Date(order.cycleExpiresAt) : (() => {
    const d = new Date(entryDate);
    d.setDate(d.getDate() + 28);
    return d;
  })();

  const msLeft = expiryDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  if (daysLeft > 14) return null;

  const tone = daysLeft <= 0 ? 'danger' : daysLeft <= 5 ? 'warning' : 'neutral';
  const label = daysLeft <= 0
    ? '28-Day CD window expired — Prescription re-issue required'
    : daysLeft === 1
      ? '1 day remaining on 28-day CD window'
      : `${daysLeft} days remaining on 28-day CD window`;

  return (
    <div className={`expiry-countdown-pill expiry-countdown-pill--${tone}`}>
      <Clock3 size={14} />
      <span>{label}</span>
    </div>
  );
}

function ReplacementLineage({ order, allOrders }: { order: PatientOrder; allOrders: PatientOrder[] }) {
  const { dispatch } = useApp();

  const childOrder = order.redoneByOrderId
    ? allOrders.find(o => o.backendId === order.redoneByOrderId || o.redoContext?.originalBackendId === order.backendId)
    : allOrders.find(o => o.redoContext?.originalOrderId === order.id);

  const parentOrder = order.redoContext
    ? allOrders.find(o => o.id === order.redoContext!.originalOrderId || o.backendId === order.redoContext!.originalBackendId)
    : null;

  if (!childOrder && !parentOrder) return null;

  return (
    <>
      {childOrder ? (
        <div className="order-lineage-banner order-lineage-banner--parent" onClick={() => dispatch({ type: 'SET_ACTIVE_ORDER', orderId: childOrder.id })} role="button" tabIndex={0}>
          <RefreshCw size={14} />
          <span>Replaced by Order {orderReference(childOrder)} →</span>
        </div>
      ) : null}
      {parentOrder ? (
        <div className="order-lineage-banner order-lineage-banner--child" onClick={() => dispatch({ type: 'SET_ACTIVE_ORDER', orderId: parentOrder.id })} role="button" tabIndex={0}>
          <RefreshCw size={14} />
          <span>Replacement of Order {orderReference(parentOrder)} ({order.redoContext?.reason === 'expired' ? '28-day CD expiry' : order.redoContext?.reason ?? 'replacement'}) →</span>
        </div>
      ) : null}
    </>
  );
}

function OrderDetail({ record, now, placementConfirmation, handoutBusy, onOpenHandout, manualForm, onManualFormChange, onRecordManual, onRedo, busy, receiptDrafts, fulfilmentBusyRxId, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection, onCallCuraleaf, onManualPlace, onPaymentLinkResend, paymentLinkBusy, refundReference, onRefundReferenceChange, onRequestRefund, onConfirmRefund, refundBusy, cancellationEditorOpen, cancellationReason, cancellationNote, cancellationReference, cancellationContactNote, cancellationBusy, onOpenCancellation, onCloseCancellation, onCancellationReasonChange, onCancellationNoteChange, onCancellationReferenceChange, onCancellationContactNoteChange, onRequestCancellation, onRecordCuraleafContact, onConfirmCuraleafCancellation, onChaseDelivery }: {
  record: OrderRecord;
  now: Date;
  placementConfirmation: string | null;
  handoutBusy: boolean;
  onOpenHandout: (partial: boolean, shipmentId?: string) => void;
  manualForm: ManualPaymentForm;
  onManualFormChange: (patch: Partial<ManualPaymentForm>) => void;
  onRecordManual: () => void;
  onRedo: () => void;
  busy: boolean;
  receiptDrafts: Record<number, GoodsReceiptDraft>;
  fulfilmentBusyRxId: number | null;
  onReceiptDraftChange: (prescription: Prescription, patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: (prescription: Prescription, shipmentId?: string) => void;
  onConfirmDelivery: (prescription: Prescription, shipmentId?: string) => void;
  onReadyForCollection: (prescription: Prescription, shipmentId?: string) => void;
  onCallCuraleaf: () => void;
  onManualPlace: (prescription: Prescription) => void;
  onPaymentLinkResend: () => void;
  paymentLinkBusy: boolean;
  refundReference: string;
  onRefundReferenceChange: (value: string) => void;
  onRequestRefund: (reason: 'patient_cancelled' | 'replacement_price_changed', resolution: 'cancel' | 'replace_new_payment') => void;
  onConfirmRefund: () => void;
  refundBusy: boolean;
  cancellationEditorOpen: boolean;
  cancellationReason: 'added_in_error' | 'patient_request' | 'other';
  cancellationNote: string;
  cancellationReference: string;
  cancellationContactNote: string;
  cancellationBusy: boolean;
  onOpenCancellation: () => void;
  onCloseCancellation: () => void;
  onCancellationReasonChange: (reason: 'added_in_error' | 'patient_request' | 'other') => void;
  onCancellationNoteChange: (note: string) => void;
  onCancellationReferenceChange: (reference: string) => void;
  onCancellationContactNoteChange: (note: string) => void;
  onRequestCancellation: () => void;
  onRecordCuraleafContact: () => void;
  onConfirmCuraleafCancellation: () => void;
  onChaseDelivery?: (prescription?: Prescription, shipmentId?: string) => void;
  onOpenHandout: (partial: boolean, shipmentId?: string) => void;
}) {
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [copiedDetailKey, setCopiedDetailKey] = useState<string | null>(null);
  const { state } = useApp();
  const { order, patient, stage } = record;
  const meta = recordStageMeta(record);
  const Icon = meta.icon;
  const cancellationResolution = orderCancellationResolution(order);
  const cancellationClosed = ['resolved', 'refunded'].includes(cancellationResolution);
  const allPlaced = order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.placed);
  const canRedo = Boolean(record.unresolvedReason) && (stage === 'rejected' || stage === 'archived' || stage === 'cancelled');
  const paymentFormVisible = stage === 'awaiting-payment' && order.payment.route === 'pharmacy';
  const curaleafCancellationLocked = Boolean(order.curaleafCancellation && order.curaleafCancellation.status !== 'confirmed');
  const mayCancel = !order.cancellation && !['collected', 'cancelled'].includes(stage);
  const hasCuraleafOrder = order.payment.status === 'paid' && order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
  const remainingOpen = order.prescriptions.some(prescription =>
    (prescription.fulfilmentLines ?? []).some(line => line.remaining > 0 || line.received < line.ordered || line.collected < line.ordered),
  );
  const readyNotCollectedPacks = order.prescriptions.reduce((sum, prescription) => {
    const prescriptionReady = prescription.status === 'ready'
      || Object.values(prescription.shipmentStates ?? {}).includes('ready_for_collection');
    if (!prescriptionReady) return sum;
    return sum + (prescription.fulfilmentLines ?? []).reduce(
      (lineSum, line) => lineSum + Math.max(0, (line.received ?? 0) - (line.collected ?? 0)),
      0,
    );
  }, 0);
  const canFullHandout = stage === 'ready' && !remainingOpen;
  const canPartialHandout = readyNotCollectedPacks > 0 && remainingOpen;

  const handleCopy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedDetailKey(key);
    window.setTimeout(() => setCopiedDetailKey(null), 2000);
  };

  const resolveProductName = (item: { name?: string; productId: string; formulaId?: string }) => {
    const isGeneric = !item.name || ['Curaleaf prescription item', 'Curaleaf formulary product', 'Curaleaf medication', 'Prescribed product'].includes(item.name);
    if (!isGeneric) return item.name;
    const cat = state.catalogue.find(c => c.id === item.productId || (item.formulaId && c.formulaId === item.formulaId));
    return cat?.name ?? item.name ?? 'Curaleaf medication';
  };

  const rawPatientAddress = patient?.address ?? '';
  const patientAddressParts = rawPatientAddress.split(',').map(s => s.trim()).filter(Boolean);
  const patientPostcode = patient?.postcode
    || (patientAddressParts.length > 0 && /^[A-Z0-9]{2,4}\s?[A-Z0-9]{3}$/i.test(patientAddressParts[patientAddressParts.length - 1]) ? patientAddressParts[patientAddressParts.length - 1] : null)
    || (rawPatientAddress.match(/[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}/i)?.[0])
    || (patientAddressParts.length > 1 ? patientAddressParts[patientAddressParts.length - 1] : null);

  const cleanStreetAddress = rawPatientAddress
    ? (patientPostcode && rawPatientAddress.endsWith(patientPostcode)
        ? rawPatientAddress.slice(0, -patientPostcode.length).replace(/,\s*$/, '').trim()
        : rawPatientAddress)
    : 'Not recorded';

  return (
    <article className="order-crm-record">
      <header className="order-crm-record__header">
        <div className="order-crm-record__hero">
          <div className="order-crm-record__identity">
            <span className={`order-crm-record__stage order-tone--${meta.tone}`}><Icon size={20} aria-hidden="true" /></span>
            <div className="order-crm-record__titles">
              <strong>{patient?.name ?? 'Unknown patient'}</strong>
              <span className="order-crm-record__ref">
                {order.redoContext ? 'Replacement' : 'Order'} {orderReference(order)}
                {order.redoContext ? ` · replaces #${order.redoContext.originalOrderId}` : ''}
              </span>
              <em>{meta.description}</em>
            </div>
          </div>
          <span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span>
        </div>
        <div className="order-crm-record__toolbar">
          <div className="order-crm-record__value">
            <small>Patient total</small>
            <strong>{money(order.payment.amount)}</strong>
            <span className="order-crm-record__opened">Opened {formatDate(order.date)}</span>
          </div>
          <div className="order-crm-record__actions" role="group" aria-label="Order actions">
            {canFullHandout ? <button type="button" className="btn btn-primary btn-sm" disabled={handoutBusy} onClick={() => onOpenHandout(false)}><Check size={13} /> Hand over</button> : null}
            {canPartialHandout ? <button type="button" className="btn btn-secondary btn-sm" disabled={handoutBusy} onClick={() => onOpenHandout(true)}><Check size={13} /> Hand over partial ({readyNotCollectedPacks} pk)</button> : null}
            {mayCancel ? <button type="button" className="btn btn-secondary btn-sm" onClick={hasCuraleafOrder ? onCallCuraleaf : onOpenCancellation}>{hasCuraleafOrder ? <PhoneCall size={13} /> : <XCircle size={13} />} {hasCuraleafOrder ? 'Call Curaleaf to cancel' : 'Cancel order'}</button> : null}
          </div>
        </div>
      </header>

      {cancellationClosed ? <CancellationClosureSummary order={order} resolution={cancellationResolution as 'resolved' | 'refunded'} /> : <JourneyRail stage={stage} paymentPaid={order.payment.status === 'paid'} order={order} />}

      <ExpiryCountdown order={order} now={now} />
      <ReplacementLineage order={order} allOrders={state.orders} />

      {!cancellationClosed && (cancellationEditorOpen || order.cancellation) ? (
        <OrderCancellationPanel
          order={order}
          editorOpen={cancellationEditorOpen}
          reason={cancellationReason}
          note={cancellationNote}
          reference={cancellationReference}
          contactNote={cancellationContactNote}
          busy={cancellationBusy}
          onClose={onCloseCancellation}
          onReasonChange={onCancellationReasonChange}
          onNoteChange={onCancellationNoteChange}
          onReferenceChange={onCancellationReferenceChange}
          onContactNoteChange={onCancellationContactNoteChange}
          onRequest={onRequestCancellation}
          onRecordContact={onRecordCuraleafContact}
          onConfirm={onConfirmCuraleafCancellation}
        />
      ) : null}

      {placementConfirmation ? <div className="order-placement-confirmation"><CheckCircle2 size={17} /><span><strong>Order placed with Curaleaf</strong><small>{placementConfirmation}</small></span></div> : null}
      {stage === 'awaiting-payment' || (stage === 'paid' && !allPlaced) ? (
        <PrePlacementDeliveryGuidance now={now} />
      ) : !['collected', 'cancelled', 'rejected', 'archived'].includes(stage) ? (
        <FulfilmentDeliveryStatus order={order} now={now} />
      ) : null}

      {(stage === 'rejected' || stage === 'archived') ? (
        <div className={`order-crm-alert order-crm-alert--${stage === 'rejected' ? 'danger' : 'neutral'}`}>
          {stage === 'rejected' ? <ShieldAlert size={17} /> : <Archive size={17} />}
          <span><strong>{stage === 'rejected' ? 'Curaleaf exception requires attention' : 'Prescription cycle archived'}</strong><small>{stage === 'rejected' ? 'Review the supplier response, then recreate the order against a valid prescription.' : 'This order passed its prescription-cycle deadline and is retained for the audit trail.'}</small></span>
        </div>
      ) : null}

      {order.payment.status === 'paid' && (stage === 'rejected' || stage === 'archived' || stage === 'cancelled' || Boolean(order.cancellation) || order.prescriptions.some(rx => rx.purchaseOrderState === 'CANCELLED' || rx.status === 'cancelled')) ? (
        <PaidExceptionResolution
          order={order}
          canReplace={true}
          lockedByCuraleaf={false}
          busy={refundBusy}
          refundReference={refundReference}
          onRefundReferenceChange={onRefundReferenceChange}
          onReplace={onRedo}
          onRequestRefund={onRequestRefund}
          onConfirmRefund={onConfirmRefund}
        />
      ) : null}

      <div className="order-crm-record__body">
        <section className="order-crm-main">
          <div className="order-crm-section-heading"><span><small>Prescription fulfilment</small><strong>{order.prescriptions.length} prescription{order.prescriptions.length === 1 ? '' : 's'}</strong></span><FileText size={16} /></div>
          <div className="order-crm-prescriptions">
            {order.prescriptions.map((prescription, index) => <PrescriptionCard
              key={prescription.id}
              prescription={prescription}
              index={index}
              receiptDraft={receiptDrafts[prescription.id] ?? {
                quantities: Object.fromEntries(prescription.items.map(item => [item.productId, prescription.receivedItems?.find(received => received.productId === item.productId)?.quantityReceived ?? item.qty])),
                batches: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
                expiries: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
                note: prescription.goodsInNote ?? '',
              }}
              busy={fulfilmentBusyRxId === prescription.id}
              onReceiptDraftChange={patch => onReceiptDraftChange(prescription, patch)}
              onSavePartial={shipmentId => onSavePartial(prescription, shipmentId)}
              onConfirmDelivery={shipmentId => onConfirmDelivery(prescription, shipmentId)}
              onReadyForCollection={shipmentId => onReadyForCollection(prescription, shipmentId)}
              onManualPlace={() => onManualPlace(prescription)}
              onChaseCuraleaf={onChaseDelivery}
              onOpenHandout={onOpenHandout}
            />)}
          </div>

          {stage === 'paid' && !allPlaced && !busy ? (
            <div className="order-crm-next-action order-crm-next-action--waiting">
              <Clock3 size={16} /><span><strong>Waiting for supplier update</strong><small>No action is needed. This order will update here when it moves forward.</small></span>
            </div>
          ) : null}

          {stage === 'awaiting-payment' && order.payment.route === 'worldpay' ? (
            <div className="order-crm-next-action order-crm-next-action--waiting">
              <Clock3 size={16} /><span><strong>Waiting for payment</strong><small>This order will update when the payment is confirmed.</small></span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={paymentLinkBusy} onClick={onPaymentLinkResend}><RefreshCw size={13} /> {paymentLinkBusy ? 'Reissuing…' : 'Void & resend link'}</button>
            </div>
          ) : null}

          {paymentFormVisible ? (
            <section className="order-crm-manual-payment">
              <div className="order-crm-section-heading"><span><small>Pharmacy-managed payment</small><strong>Confirm funds received</strong></span><Banknote size={16} /></div>
              <div className="order-crm-manual-payment__fields">
                <label><span>Payment method</span><select className="input select" value={manualForm.tender} onChange={event => onManualFormChange({ tender: event.target.value as ManualTender })}><option value="epos-card">EPOS card</option><option value="cash">Cash</option><option value="bank-transfer">Bank transfer</option><option value="other">Other</option></select></label>
                <label><span>Receipt reference</span><input className="input" value={manualForm.reference} onChange={event => onManualFormChange({ reference: event.target.value })} placeholder="TILL-1048" /></label>
              </div>
              <label><span>Reconciliation note</span><textarea className="input" value={manualForm.notes} onChange={event => onManualFormChange({ notes: event.target.value })} /></label>
              <label className="payment-confirmation"><input type="checkbox" checked={manualForm.confirmed} onChange={event => onManualFormChange({ confirmed: event.target.checked })} /><span><strong>I confirm {money(order.payment.amount)} has been received</strong><small>This creates the pharmacy payment record.</small></span></label>
              <button type="button" className="btn btn-primary" disabled={!manualForm.confirmed || busy} onClick={onRecordManual}><CheckCircle2 size={14} /> {busy ? 'Recording…' : 'Record payment'}</button>
            </section>
          ) : null}

          <OrderDetailsDrawer
            order={order}
            patient={patient}
            cleanStreetAddress={cleanStreetAddress}
            patientPostcode={patientPostcode}
            pharmacyName={state.currentOrganisation?.tradingName || state.currentOrganisation?.name || null}
            showOrderDetails={showOrderDetails}
            onToggle={() => setShowOrderDetails(prev => !prev)}
            copiedDetailKey={copiedDetailKey}
            onCopy={handleCopy}
            resolveProductName={resolveProductName}
          />
        </section>
      </div>
    </article>
  );
}

function londonDateKey(value: Date | string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function deliveryGuidanceForOrder(order: PatientOrder) {
  const inTransitAt = order.prescriptions.map(prescription => prescription.latestShipmentAt).find(Boolean);
  const placedAt = order.prescriptions.map(prescription => prescription.placedAt).find(Boolean)
    || order.payment.paidAt
    || order.date
    || new Date();
  return curaleafDeliveryGuidance(inTransitAt || placedAt);
}

function deliveryRange(guidance: NonNullable<ReturnType<typeof curaleafDeliveryGuidance>>) {
  return `${formatDeliveryDate(guidance.windowStart)} – ${formatDeliveryDate(guidance.windowEnd)}`;
}

function countdownLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} minute${remainder === 1 ? '' : 's'}`;
  if (!remainder) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${remainder}m`;
}

function PrePlacementDeliveryGuidance({ now }: { now: Date }) {
  const guidance = curaleafDeliveryGuidance(now);
  if (!guidance) return null;
  const range = deliveryRange(guidance);
  const copy = guidance.scenario === 'DT-1'
    ? `Order in the next ${countdownLabel(guidance.countdownMinutes)} for expected delivery ${formatDeliveryDate(guidance.nextDay)}–${formatDeliveryDate(guidance.windowEnd)} (1–2 working days).`
    : guidance.scenario === 'DT-2'
      ? `Today's 2:30pm cut-off has passed — your order joins tomorrow's dispatch. Expected delivery ${range} (2–4 working days).`
      : `Orders placed Friday–Sunday are processed Monday — expected delivery ${range} (2–4 working days).`;
  return (
    <div className="order-delivery-banner order-delivery-banner--pending" role="status">
      <div className="order-delivery-banner__main">
        <div className="order-delivery-banner__icon-wrap">
          <Clock3 size={17} />
        </div>
        <div className="order-delivery-banner__content">
          <div className="order-delivery-banner__eyebrow">
            <span>Pre-placement dispatch estimate</span>
          </div>
          <strong className="order-delivery-banner__title">{copy}</strong>
          {guidance.scenario === 'DT-1' ? (
            <p className="order-delivery-banner__desc">Order before 2:30pm Mon–Thu for fastest dispatch.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FulfilmentDeliveryStatus({ order, now }: { order: PatientOrder; now: Date }) {
  const guidance = deliveryGuidanceForOrder(order);
  if (!guidance) return null;
  const range = deliveryRange(guidance);
  const packTotals = orderPackTotals(order);
  const awaitingSupplier = orderAwaitingSupplierShipmentProductNames(order);
  const inTransitProducts = orderInTransitProductNames(order);
  const hasInTransit = orderHasInTransitPacks(order);
  const hasUncollected = orderHasUncollectedReceivedPacks(order);
  const hasPartialCollection = orderHasPartialCollection(order);

  if (hasUncollected) {
    const packsWaiting = packTotals.received - packTotals.collected;
    return (
      <div className="order-delivery-banner order-delivery-banner--ready" role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            <PackageCheck size={17} />
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>Ready for patient handout</span>
            </div>
            <strong className="order-delivery-banner__title">
              {packsWaiting} pack{packsWaiting === 1 ? '' : 's'} checked in and awaiting collection
            </strong>
            <p className="order-delivery-banner__desc">
              Complete pharmacy verification, then hand out the arrived consignment to the patient.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (hasPartialCollection && awaitingSupplier.length) {
    return (
      <div className="order-delivery-banner order-delivery-banner--ready" role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            <CheckCircle2 size={17} />
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>Split order · First consignment complete</span>
            </div>
            <strong className="order-delivery-banner__title">
              {packTotals.collected} of {packTotals.ordered} packs handed out to the patient
            </strong>
            <p className="order-delivery-banner__desc">
              {awaitingSupplier.map(product => `${product}: remaining quantity stays open with Curaleaf for a later shipment.`).join(' ')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (hasInTransit && inTransitProducts.length) {
    const overdue = londonDateKey(now) > guidance.windowEnd;
    const isSplit = awaitingSupplier.length > 0 || order.prescriptions.some(rx => rx.dispatchStatus === 'partial');
    if (isSplit) {
      return (
        <div className={`order-delivery-banner ${overdue ? 'order-delivery-banner--overdue' : 'order-delivery-banner--dispatched'}`} role="status">
          <div className="order-delivery-banner__main">
            <div className="order-delivery-banner__icon-wrap">
              <AlertTriangle size={17} />
            </div>
            <div className="order-delivery-banner__content">
              <div className="order-delivery-banner__eyebrow">
                <span>Split shipment · Open with Curaleaf</span>
              </div>
              <strong className="order-delivery-banner__title">
                {overdue
                  ? `Current consignment overdue · expected by ${formatDeliveryDate(guidance.windowEnd)}`
                  : `Partially dispatched · current consignment expected ${range}`}
              </strong>
              <p className="order-delivery-banner__desc">
                {inTransitProducts.map(product => `${product}: this consignment is in transit to the pharmacy.`).join(' ')}
                {awaitingSupplier.length
                  ? ` ${awaitingSupplier.map(product => `${product}: further packs remain with Curaleaf for a later shipment.`).join(' ')}`
                  : ''}
              </p>
            </div>
          </div>
        </div>
      );
    }
    // Non-split consignments fall through to the standard in-transit banner below.
  }

  if (awaitingSupplier.length && !hasInTransit) {
    return (
      <div className="order-delivery-banner order-delivery-banner--picking" role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            <Package size={17} />
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>Split order · Awaiting next shipment</span>
            </div>
            <strong className="order-delivery-banner__title">
              Remaining packs open with Curaleaf
            </strong>
            <p className="order-delivery-banner__desc">
              {awaitingSupplier.map(product => `${product}: remaining quantity is open with Curaleaf and will dispatch in a later shipment.`).join(' ')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const allRx = order.prescriptions;
  const totalOrdered = allRx.reduce((sum, rx) => sum + rx.items.reduce((s, i) => s + i.qty, 0), 0);
  const totalAllocated = allRx.reduce((sum, rx) => {
    if (rx.supplierItems?.length) {
      return sum + rx.supplierItems.reduce((s, si) => s + (si.packsAllocatedCount ?? 0), 0);
    }
    if (rx.purchaseOrderState === 'FULLY_ALLOCATED' || rx.status === 'received' || rx.status === 'ready' || rx.status === 'collected') {
      return sum + rx.items.reduce((s, i) => s + i.qty, 0);
    }
    return sum;
  }, 0);

  const hasAllocatedItems = totalAllocated > 0 || allRx.some(rx => rx.purchaseOrderState === 'PROCESSING' || rx.purchaseOrderState === 'FULLY_ALLOCATED');
  const isFullyAllocated = (totalAllocated >= totalOrdered && totalOrdered > 0) || allRx.every(rx => rx.purchaseOrderState === 'FULLY_ALLOCATED');
  const isDispatched = hasInTransit || allRx.some(rx =>
    rx.status === 'dispatched'
    && !['received', 'partially-received', 'ready', 'collected'].includes(rx.status),
  );
  const overdue = londonDateKey(now) > guidance.windowEnd;

  if (isDispatched) {
    const copy = overdue
      ? `Expected by ${formatDeliveryDate(guidance.windowEnd)} — not yet received? Check with Curaleaf customer service.`
      : `Dispatched by Curaleaf · expected by ${formatDeliveryDate(guidance.windowEnd)}`;
    return (
      <div className={`order-delivery-banner ${overdue ? 'order-delivery-banner--overdue' : 'order-delivery-banner--dispatched'}`} role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            {overdue ? <AlertTriangle size={17} /> : <Truck size={17} />}
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>{overdue ? 'Delivery overdue' : 'In transit with courier'}</span>
            </div>
            <strong className="order-delivery-banner__title">{copy}</strong>
            <p className="order-delivery-banner__desc">
              Expected delivery window: {range}. Pharmacy goods-in check is required upon delivery.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isFullyAllocated) {
    return (
      <div className="order-delivery-banner order-delivery-banner--ready" role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            <PackageCheck size={17} />
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>Curaleaf dispensing complete</span>
            </div>
            <strong className="order-delivery-banner__title">
              Expected delivery {range} (1–2 working days)
            </strong>
            <p className="order-delivery-banner__desc">
              All {totalOrdered} packs allocated and verified by Curaleaf. Packed and awaiting courier handover.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (hasAllocatedItems) {
    return (
      <div className="order-delivery-banner order-delivery-banner--picking" role="status">
        <div className="order-delivery-banner__main">
          <div className="order-delivery-banner__icon-wrap">
            <Package size={17} />
          </div>
          <div className="order-delivery-banner__content">
            <div className="order-delivery-banner__eyebrow">
              <span>Curaleaf dispensing in progress</span>
            </div>
            <strong className="order-delivery-banner__title">
              Expected delivery {range} · {totalAllocated} of {totalOrdered} packs dispensed
            </strong>
            <p className="order-delivery-banner__desc">
              Curaleaf technicians are actively dispensing this order. Delivery timeline is active and tracked against live allocation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Pre-allocation / waiting to be picked (e.g. CREATED or Curaleaf review)
  return (
    <div className="order-delivery-banner order-delivery-banner--pending" role="status">
      <div className="order-delivery-banner__main">
        <div className="order-delivery-banner__icon-wrap">
          <Clock3 size={17} />
        </div>
        <div className="order-delivery-banner__content">
          <div className="order-delivery-banner__eyebrow">
            <span>Estimated delivery · Subject to change</span>
          </div>
          <strong className="order-delivery-banner__title">
            Expected delivery {range} (1–2 working days)
          </strong>
          <p className="order-delivery-banner__desc">
            Order placed with Curaleaf. Standard 1–2 working day dispatch applies; dates update live once Curaleaf dispensing begins.
          </p>
        </div>
      </div>
    </div>
  );
}

function shipmentListCopy(record: OrderRecord, now: Date) {
  if (record.stage !== 'dispatched') return null;
  const guidance = deliveryGuidanceForOrder(record.order);
  if (!guidance) return null;
  return londonDateKey(now) > guidance.windowEnd
    ? `Expected by ${formatDeliveryDate(guidance.windowEnd)} — not received?`
    : `Dispatched · expected by ${formatDeliveryDate(guidance.windowEnd)}`;
}

function collapsedActionCopy(stage: OrderStage) {
  if (stage === 'awaiting-payment') return 'Payment is the next required step.';
  if (stage === 'paid') return 'Awaiting placement with Curaleaf.';
  if (stage === 'delivered') return 'Complete pharmacy checks and mark the order ready.';
  if (stage === 'ready') return 'Handout to the patient is the only remaining step.';
  if (stage === 'rejected') return 'Review the Curaleaf exception and resolution.';
  if (stage === 'cancelled') return 'Cancellation is retained for audit.';
  if (stage === 'collected') return 'The medication handout is complete.';
  return 'Open the full view for prescription, supplier and activity details.';
}

function CancellationClosureSummary({ order, resolution }: { order: PatientOrder; resolution: 'resolved' | 'refunded' }) {
  const refunded = resolution === 'refunded';
  const closedAt = refunded ? order.refund?.confirmedAt : order.curaleafCancellation?.confirmedAt ?? order.cancellation?.requestedAt;
  const supplierCopy = order.curaleafCancellation?.status === 'confirmed'
    ? 'Curaleaf cancellation confirmed.'
    : order.prescriptions.some(prescription => prescription.placed || prescription.poRef)
      ? 'Supplier cancellation recorded.'
      : 'No supplier order required cancellation.';
  return (
    <section className={`order-cancellation-closure order-cancellation-closure--${resolution}`} aria-label="Resolved cancellation">
      <span className="order-cancellation-closure__icon">{refunded ? <Banknote size={18} /> : <CheckCircle2 size={18} />}</span>
      <span className="order-cancellation-closure__copy">
        <small>Closed order</small>
        <strong>{refunded ? `${money((order.refund?.amountPence ?? Math.round(order.payment.amount * 100)) / 100)} refunded` : 'Cancellation resolved'}</strong>
        <em>{supplierCopy} This closes this order only; the patient can place another order in future.</em>
      </span>
      <span className="order-cancellation-closure__status"><b>No action needed</b><small>{formatDate(closedAt, true)}</small></span>
    </section>
  );
}

function OrderCancellationPanel({ order, editorOpen, reason, note, reference, contactNote, busy, onClose, onReasonChange, onNoteChange, onReferenceChange, onContactNoteChange, onRequest, onRecordContact, onConfirm }: {
  order: PatientOrder;
  editorOpen: boolean;
  reason: 'added_in_error' | 'patient_request' | 'other';
  note: string;
  reference: string;
  contactNote: string;
  busy: boolean;
  onClose: () => void;
  onReasonChange: (reason: 'added_in_error' | 'patient_request' | 'other') => void;
  onNoteChange: (note: string) => void;
  onReferenceChange: (reference: string) => void;
  onContactNoteChange: (note: string) => void;
  onRequest: () => void;
  onRecordContact: () => void;
  onConfirm: () => void;
}) {
  const supplier = order.curaleafCancellation;
  const hasCuraleafOrder = order.payment.status === 'paid' && order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
  if (!order.cancellation && editorOpen) return (
    <section className="order-cancellation-card order-cancellation-card--compose">
      <header><span><small>Controlled cancellation</small><strong>Cancel {orderReference(order)}</strong></span><button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Keep order</button></header>
      <div className="order-cancellation-warning"><AlertTriangle size={16} /><span><strong>The payment request will be retired</strong><small>The order and link are cancelled in HHH. Any late provider payment will be flagged for refund.</small></span></div>
      <div className="order-cancellation-fields">
        <label><span>Reason</span><select className="input select" value={reason} onChange={event => onReasonChange(event.target.value as typeof reason)}><option value="added_in_error">Prescription added in error</option><option value="patient_request">Patient requested cancellation</option><option value="other">Other</option></select></label>
        <label><span>Cancellation note</span><textarea className="input" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Briefly explain what was added incorrectly" /></label>
      </div>
      <footer><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onRequest}><XCircle size={13} /> {busy ? 'Cancelling…' : 'Cancel order'}</button></footer>
    </section>
  );

  if (!order.cancellation) return null;

  return (
    <section className={`order-cancellation-card ${order.cancellation.status === 'refund_required' ? 'order-cancellation-card--supplier' : 'order-cancellation-card--confirmed'}`}>
      {order.cancellation.status === 'refund_required' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span><strong>{order.cancellation.status === 'refund_required' ? 'Paid cancellation requires pharmacy refund' : 'Order cancelled'}</strong><small>{order.cancellation.status === 'refund_required' ? `Refund the patient in Worldpay using reference ${order.cancellation.paymentReference ?? order.payment.ref ?? 'below'}.` : 'The order has been cancelled and its payment link retired.'}</small></span>
    </section>
  );
}

function PaidExceptionResolution({ order, canReplace, lockedByCuraleaf: _locked, busy, refundReference, onRefundReferenceChange, onReplace, onRequestRefund, onConfirmRefund }: {
  order: PatientOrder;
  canReplace: boolean;
  lockedByCuraleaf?: boolean;
  busy: boolean;
  refundReference: string;
  onRefundReferenceChange: (value: string) => void;
  onReplace: () => void;
  onRequestRefund: (reason: 'patient_cancelled' | 'replacement_price_changed', resolution: 'cancel' | 'replace_new_payment') => void;
  onConfirmRefund: () => void;
}) {
  const method = order.payment.route === 'worldpay' ? 'Worldpay portal' : 'Pharmacy payment system';
  const reference = order.refund?.paymentReference ?? order.payment.ref ?? 'Reference unavailable';
  return (
    <section className={`order-resolution${order.refund?.status === 'completed' ? ' order-resolution--complete' : ''}`}>
      <header>
        <span><small>Paid-order resolution</small><strong>{order.refund?.status === 'completed' ? 'Refund completed' : order.refund ? 'Manual refund awaiting confirmation' : canReplace ? 'Choose replacement or refund' : 'Prepare patient refund'}</strong></span>
        <span className="order-resolution__amount"><small>Patient paid</small><strong>{money(order.payment.amount)}</strong></span>
      </header>
      <div className="order-resolution__reference">
        <CreditCard size={15} />
        <span><small>{method} payment ID</small><code>{reference}</code></span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void navigator.clipboard.writeText(reference)}>Copy ID</button>
      </div>
      {!order.refund ? (
        <div className="order-resolution__choices">
          {canReplace ? <button type="button" className="btn btn-primary btn-sm" onClick={onReplace}><RefreshCw size={13} /> Create replacement</button> : null}
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onRequestRefund('patient_cancelled', 'cancel')}><XCircle size={13} /> Cancel & prepare full refund</button>
          <small>Refunds are completed in {method}. HHH records the task and confirmation but does not move the money automatically.</small>
        </div>
      ) : order.refund.status === 'pending_confirmation' ? (
        <div className="order-resolution__confirm">
          <ol><li>Sign in to {method}.</li><li>Find payment <code>{reference}</code> and refund {money(order.refund.amountPence / 100)}.</li><li>Enter the Worldpay refund reference below and confirm.</li></ol>
          <label><span>Refund confirmation reference</span><input className="input" value={refundReference} onChange={event => onRefundReferenceChange(event.target.value)} placeholder="Worldpay refund / command ID" /></label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || refundReference.trim().length < 3} onClick={onConfirmRefund}><CheckCircle2 size={13} /> {busy ? 'Recording…' : 'Confirm refund completed'}</button>
        </div>
      ) : (
        <div className="order-resolution__completed"><CheckCircle2 size={16} /><span><strong>{money(order.refund.amountPence / 100)} refunded via {method}</strong><small>Confirmation {order.refund.externalReference ?? 'recorded'} · {formatDate(order.refund.confirmedAt, true)}</small></span></div>
      )}
    </section>
  );
}

function JourneyRail({ stage, paymentPaid, order }: { stage: OrderStage; paymentPaid: boolean; order: PatientOrder }) {
  if (stage === 'cancelled') {
    const phases = [
      { label: 'Payment', detail: paymentPaid ? 'Cleared' : 'Cancelled', complete: paymentPaid },
      { label: 'Curaleaf', detail: 'Cancelled', complete: true },
      { label: 'Delivery', detail: 'Stopped', complete: false },
      { label: 'Ready to collect', detail: 'Not required', complete: false },
    ];
    return (
      <ol className="order-journey-rail order-journey-rail--premium" aria-label="Order journey">
        {phases.map((phase, index) => (
          <li key={phase.label} className={phase.complete ? 'is-complete' : 'is-pending'} aria-current={undefined}>
            <span className="order-journey-rail__marker" aria-hidden="true">{phase.complete ? <Check size={12} /> : index + 1}</span>
            <div className="order-journey-rail__copy"><strong>{phase.label}</strong><small>{phase.detail}</small></div>
          </li>
        ))}
      </ol>
    );
  }
  const packTotals = orderPackTotals(order);
  const curaleafComplete = ['curaleaf-approved', 'dispatched', 'delivered', 'ready', 'collected'].includes(stage);
  const deliveryFullyComplete = packTotals.ordered > 0 && packTotals.received >= packTotals.ordered;
  const deliveryPartial = packTotals.received > 0 && !deliveryFullyComplete;
  const collectionFullyComplete = packTotals.ordered > 0 && packTotals.collected >= packTotals.ordered;
  const partialCollection = orderHasPartialCollection(order);
  const hasUncollected = orderHasUncollectedReceivedPacks(order);
  const deliveryDetail = deliveryFullyComplete
    ? 'Received'
    : deliveryPartial
      ? 'Part delivered'
      : stage === 'dispatched'
        ? 'In transit'
        : 'Pending';
  const collectionDetail = collectionFullyComplete
    ? 'Handed out'
    : partialCollection
      ? 'Partial handout'
      : hasUncollected || stage === 'ready'
        ? 'Ready'
        : 'Pending';
  const phases = [
    { label: 'Payment', detail: paymentPaid ? 'Cleared' : 'Awaiting', complete: paymentPaid, partial: false, active: stage === 'awaiting-payment' },
    { label: 'Curaleaf', detail: curaleafComplete ? 'Approved' : stage === 'curaleaf-pending' ? 'In review' : 'Pending', complete: curaleafComplete, partial: false, active: stage === 'paid' || stage === 'curaleaf-pending' },
    {
      label: 'Delivery',
      detail: deliveryDetail,
      complete: deliveryFullyComplete,
      partial: deliveryPartial,
      active: !deliveryFullyComplete && !deliveryPartial && (stage === 'curaleaf-approved' || stage === 'dispatched'),
    },
    {
      label: 'Ready to collect',
      detail: collectionDetail,
      complete: collectionFullyComplete,
      partial: partialCollection,
      active: !collectionFullyComplete && !partialCollection && (stage === 'delivered' || stage === 'ready' || hasUncollected),
    },
  ];
  return (
    <ol className="order-journey-rail order-journey-rail--premium" aria-label="Order journey">
      {phases.map((phase, index) => {
        let stateClass = 'is-pending';
        if (phase.complete) stateClass = 'is-complete';
        else if (phase.partial) stateClass = 'is-partial';
        else if (phase.active) stateClass = 'is-active';
        return (
          <li key={phase.label} className={stateClass} aria-current={phase.active ? 'step' : undefined}>
            <span className="order-journey-rail__marker" aria-hidden="true">{phase.complete ? <Check size={12} /> : index + 1}</span>
            <div className="order-journey-rail__copy"><strong>{phase.label}</strong><small>{phase.detail}</small></div>
          </li>
        );
      })}
    </ol>
  );
}

function pipelineStepClass(base: string, state: { complete: boolean; partial: boolean; active: boolean }) {
  const classes = [base];
  if (state.complete) classes.push('pipeline-step--complete');
  else if (state.partial) classes.push('pipeline-step--partial');
  else if (state.active) classes.push('pipeline-step--active');
  return classes.join(' ');
}

function fulfilmentPipelineSteps(line: {
  orderedPacks: number;
  allocatedPacks: number;
  dispatchedPacks: number;
  inTransitPacks: number;
  receivedPacks: number;
  awaitingDispatchPacks: number;
  isSplit: boolean;
}) {
  const ordered = line.orderedPacks;
  const allocated = line.allocatedPacks;
  const dispatched = line.dispatchedPacks;
  const inTransit = line.inTransitPacks;
  const received = line.receivedPacks;
  const consignmentDelivered = dispatched > 0 && inTransit === 0 && received >= dispatched;
  const splitAwaitingNextShipment = line.isSplit && line.awaitingDispatchPacks > 0;

  return {
    ordered: {
      complete: ordered > 0,
      partial: false,
      active: false,
    },
    dispensed: {
      complete: allocated >= ordered && ordered > 0,
      partial: allocated > 0 && allocated < ordered,
      active: allocated === 0 && ordered > 0,
    },
    inTransit: {
      complete: consignmentDelivered && !splitAwaitingNextShipment,
      partial: inTransit > 0
        || (consignmentDelivered && splitAwaitingNextShipment)
        || (dispatched > 0 && inTransit === 0 && received > 0 && received < dispatched),
      active: inTransit > 0,
    },
    checkedIn: {
      complete: received >= ordered && ordered > 0,
      partial: received > 0 && received < ordered,
      active: false,
    },
  };
}

function PrescriptionCard({ prescription, index, receiptDraft, busy, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection, onManualPlace, onChaseCuraleaf, onOpenHandout }: {
  prescription: Prescription;
  index: number;
  receiptDraft: GoodsReceiptDraft;
  busy: boolean;
  onReceiptDraftChange: (patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: (shipmentId?: string) => void;
  onConfirmDelivery: (shipmentId?: string) => void;
  onReadyForCollection: (shipmentId?: string) => void;
  onManualPlace: () => void;
  onChaseCuraleaf?: (prescription: Prescription, shipmentId?: string) => void;
  onOpenHandout?: (partial: boolean, shipmentId?: string) => void;
}) {
  const { state } = useApp();
  const shipmentIds = useMemo(() => prescription.shipmentIds?.length ? prescription.shipmentIds : prescription.shipmentId ? [prescription.shipmentId] : [], [prescription.shipmentId, prescription.shipmentIds]);
  const [selectedShipmentId, setSelectedShipmentId] = useState(shipmentIds.find(id => prescription.shipmentStates?.[id] !== 'collected') ?? shipmentIds[0] ?? '');
  useEffect(() => {
    if (!selectedShipmentId || !shipmentIds.includes(selectedShipmentId)) setSelectedShipmentId(shipmentIds.find(id => prescription.shipmentStates?.[id] !== 'collected') ?? shipmentIds[0] ?? '');
  }, [prescription.shipmentStates, selectedShipmentId, shipmentIds]);
  const selectedShipmentState = selectedShipmentId ? prescription.shipmentStates?.[selectedShipmentId] : undefined;
  const statusLabel = prescriptionStatusLabel(prescription);
  const totalReceivedPacks = (prescription.fulfilmentLines ?? []).reduce((sum, line) => sum + (line.received ?? 0), 0);
  const totalShippedPacks = (prescription.fulfilmentLines ?? []).reduce((sum, line) => sum + (line.shipped ?? 0), 0);
  const arrivedNotCollectedPacks = (prescription.fulfilmentLines ?? []).reduce((sum, line) => sum + Math.max(0, (line.received ?? 0) - (line.collected ?? 0)), 0);
  const hasCheckedInPacks = totalReceivedPacks > 0;
  const hasShippedNotCheckedIn = totalShippedPacks > totalReceivedPacks;

  const remainingOpen = (prescription.fulfilmentLines ?? []).some(line => line.remaining > 0 || line.received < line.ordered || line.collected < line.ordered);
  const isCollected = !remainingOpen && prescription.status === 'collected';
  const selectedConsignmentCollected = selectedShipmentState === 'collected';
  const selectedConsignmentReady = selectedShipmentState === 'ready_for_collection';
  const selectedConsignmentReceived = (selectedShipmentState === 'received' || selectedConsignmentReady || selectedConsignmentCollected) && hasCheckedInPacks;
  const isReady = !isCollected && (prescription.status === 'ready' || selectedConsignmentReady);
  const isDelivered = !isCollected && !isReady && (prescription.status === 'received' || selectedConsignmentReceived || (hasCheckedInPacks && prescription.status === 'partially-received'));
  const isPartiallyDelivered = !isCollected && hasCheckedInPacks && (prescription.status === 'partially-received' || selectedShipmentState === 'partially_received' || (remainingOpen && (prescription.receivedItems?.some(item => item.quantityReceived > 0) || (prescription.fulfilmentLines ?? []).some(line => line.received > 0))));

  const selectedConsignment = selectedShipmentId
    ? prescription.shipments?.find(shipment => shipment.id === selectedShipmentId)
    : prescription.shipments?.[0];
  const consignmentPacksFor = (productId: string) => {
    const fromShipment = selectedConsignment?.items?.filter(item => item.productId === productId).reduce((sum, item) => sum + Number(item.packCount || 0), 0) ?? 0;
    if (fromShipment > 0) return fromShipment;
    const line = prescription.fulfilmentLines?.find(item => item.productId === productId);
    return line?.shipped ?? 0;
  };
  const totalConsignmentPacks = prescription.items.reduce((sum, item) => sum + consignmentPacksFor(item.productId), 0);
  const consignmentHasShippedPacks = totalConsignmentPacks > 0;

  const isDispatchedPhase = (consignmentHasShippedPacks || totalShippedPacks > 0 || prescription.dispatchStatus === 'partial' || prescription.dispatchStatus === 'dispatched') && (
    prescription.status === 'dispatched'
    || prescription.status === 'partially-received'
    || prescription.dispatchStatus === 'dispatched'
    || prescription.dispatchStatus === 'partial'
    || Boolean(selectedShipmentId)
    || Boolean(prescription.shipmentIds?.length)
  );

  const receiving = prescription.placed
    && !selectedConsignmentCollected
    && hasShippedNotCheckedIn
    && isDispatchedPhase;

  const readyControl = isDelivered && !remainingOpen;
  const partialReadyControl = (isPartiallyDelivered || (isDelivered && remainingOpen)) && !selectedConsignmentReady && !selectedConsignmentCollected;
  const partialHandoutControl = remainingOpen
    && arrivedNotCollectedPacks > 0
    && (selectedConsignmentReady || prescription.status === 'ready');
  const fullHandoutControl = (prescription.status === 'ready' || selectedConsignmentReady) && !remainingOpen;
  const collectionControl = isReady && !remainingOpen;
  const deliveryGuidance = (prescription.latestShipmentAt || prescription.placedAt)
    ? curaleafDeliveryGuidance(prescription.latestShipmentAt || prescription.placedAt)
    : null;
  const totalOrderedPacks = prescription.items.reduce((s, i) => s + i.qty, 0);
  const totalDispatchedPacks = prescription.items.reduce((s, i) => {
    const line = prescription.fulfilmentLines?.find(l => l.productId === i.productId);
    return s + (line?.shipped ?? 0);
  }, 0);

  const resolveProductName = (item: { name?: string; productId: string; formulaId?: string }) => {
    const isGeneric = !item.name || ['Curaleaf prescription item', 'Curaleaf formulary product', 'Curaleaf medication', 'Prescribed product'].includes(item.name);
    if (!isGeneric) return item.name;
    const cat = state.catalogue.find(c => c.id === item.productId || (item.formulaId && c.formulaId === item.formulaId));
    return cat?.name ?? item.name ?? 'Curaleaf medication';
  };

  const displayLines = prescription.items.map(item => {
    const matchingLine = prescription.fulfilmentLines?.find(l => l.productId === item.productId || (item.formulaId && l.productId.includes(item.formulaId)));
    const orderedPacks = matchingLine?.requested || matchingLine?.ordered || item.qty;
    const allocatedPacks = matchingLine?.allocated ?? 0;
    const dispatchedPacks = matchingLine?.shipped ?? 0;
    const consignmentPacks = consignmentPacksFor(item.productId);
    const itemReceived = prescription.receivedItems?.find(it => it.productId === item.productId)?.quantityReceived;
    const receivedPacks = typeof itemReceived === 'number'
      ? itemReceived
      : (matchingLine?.received || 0);
    const consignmentCheckedIn = selectedConsignmentReceived;
    const inTransitPacks = consignmentCheckedIn
      ? 0
      : Math.max(0, consignmentPacks > 0 ? consignmentPacks : Math.max(0, dispatchedPacks - receivedPacks));
    const awaitingDispatchPacks = Math.max(0, orderedPacks - dispatchedPacks);
    const isDeliveredOrCheckedIn = receivedPacks > 0 && (consignmentCheckedIn || (!remainingOpen && receivedPacks >= orderedPacks));
    const isSplit = awaitingDispatchPacks > 0 && dispatchedPacks > 0;

    const percentReceived = orderedPacks > 0 ? Math.min(100, Math.round((receivedPacks / orderedPacks) * 100)) : 0;
    const percentAllocated = orderedPacks > 0 ? Math.min(100, Math.round((allocatedPacks / orderedPacks) * 100)) : 0;
    const percentInTransit = orderedPacks > 0 && inTransitPacks > 0 ? Math.min(100, Math.round(((receivedPacks + inTransitPacks) / orderedPacks) * 100)) : 0;

    return {
      productId: item.productId,
      displayName: resolveProductName(item),
      orderedPacks,
      allocatedPacks,
      dispatchedPacks,
      consignmentPacks,
      receivedPacks,
      inTransitPacks,
      awaitingDispatchPacks,
      isDeliveredOrCheckedIn,
      isSplit,
      percentReceived,
      percentAllocated,
      percentInTransit,
      quantityMismatch: matchingLine?.quantityMismatch,
      supplierReportedOrdered: matchingLine?.supplierReportedOrdered,
    };
  });

  const hasSupplierSection = Boolean(prescription.placed && (prescription.fulfilmentLines?.length || isDispatchedPhase || isPartiallyDelivered || isDelivered || isReady));

  return (
    <div className="order-rx-pair">
      {/* Box 1: Pharmacy Prescription Ordered Details */}
      <article className="order-rx-card">
        <header>
          <span><small>Prescription {index + 1}</small><strong>{prescription.prescriber || 'Prescriber pending'}</strong></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{money(rxRevenue(prescription))}</strong>
            <span className={`rx-status-chip rx-status-chip--${prescription.status}`}>{statusLabel}</span>
          </div>
        </header>
        {prescription.manualPlaceRequired ? (
          <div className="order-ready-control">
            <span>
              <Clock3 size={16} />
              <span>
                <strong>Manual placement required</strong>
                <small>Automatic placement is disabled for this pharmacy. The final quote will be rechecked when you continue.</small>
              </span>
            </span>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onManualPlace}>
              {busy ? 'Placing…' : 'Place prescription'}
            </button>
          </div>
        ) : null}

        <div className="order-rx-lines">
          {prescription.items.map(item => (
            <div key={item.productId}>
              <span>
                <strong>{resolveProductName(item)}</strong>
                <small>{item.qty} pack{item.qty === 1 ? '' : 's'}{item.retail ? ` · ${money(item.retail * item.qty)}` : ''}</small>
              </span>
              <span className="pack-qty-badge">{item.qty} pack{item.qty === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      </article>

      {/* Box 2: Curaleaf Allocation, In-Transit Progress & Consignment Check-In */}
      {hasSupplierSection ? (
        <article className="order-rx-card order-rx-card--supplier">
          {shipmentIds.length > 1 ? (
            <div className="order-shipments-segmented-bar">
              <div className="order-shipments-segmented-bar__meta">
                <Truck size={13} />
                <span><strong>{shipmentIds.length} Consignments Dispatched</strong> · Select parcel to inspect & check in:</span>
              </div>
              <div className="order-shipments-segmented-tabs">
                {shipmentIds.map((id, shipmentIndex) => {
                  const state = prescription.shipmentStates?.[id];
                  const isSelected = id === selectedShipmentId;
                  const formattedState = state ? state.replaceAll('_', ' ') : 'In Transit';
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`order-shipments-tab ${isSelected ? 'order-shipments-tab--active' : ''}`}
                      onClick={() => setSelectedShipmentId(id)}
                    >
                      <span className="order-shipments-tab__title">Consignment {shipmentIndex + 1}</span>
                      <span className={`order-shipments-tab__badge order-shipments-tab__badge--${state || 'in_transit'}`}>
                        {formattedState}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="order-supplier-fulfilment">
            <header className="order-supplier-fulfilment__header">
              <div>
                <small>Curaleaf Live Allocation & Progress</small>
                <strong>
                  {isCollected
                    ? 'Delivered to Pharmacy — Checked In'
                    : isPartiallyDelivered
                      ? 'Partial check-in — remainder open with Curaleaf'
                      : hasShippedNotCheckedIn && prescription.dispatchStatus === 'partial'
                        ? 'Partial dispatch — check in arriving consignment'
                      : isDelivered || isReady
                        ? 'Arrived consignment checked in'
                        : prescription.dispatchStatus === 'complete'
                          ? 'Fulfilled by Curaleaf — Dispatched'
                          : prescription.dispatchStatus === 'partial'
                            ? 'Partial dispatch — remainder awaiting dispatch at Curaleaf'
                            : isDispatchedPhase
                              ? 'Dispatched with courier — check in arriving consignment'
                              : prescription.purchaseOrderState === 'FULLY_ALLOCATED'
                                ? 'Fully dispensed by Curaleaf'
                                : prescription.purchaseOrderState === 'PROCESSING'
                                  ? 'Dispensing at Curaleaf'
                                  : 'Curaleaf purchase order active'}
                </strong>
              </div>
              {deliveryGuidance ? (
                <span className="order-delivery-estimate-badge">
                  <Truck size={12} /> {deliveryRange(deliveryGuidance)}
                </span>
              ) : null}
            </header>
            <div className="order-supplier-fulfilment__body">
              {displayLines.map(line => {
                const steps = fulfilmentPipelineSteps(line);

                return (
                  <div key={line.productId} className={`order-fulfilment-row ${line.quantityMismatch ? 'has-mismatch' : ''}`}>
                    <div className="order-fulfilment-row__header">
                      <div>
                        <strong>{line.displayName}</strong>
                        {line.quantityMismatch ? (
                          <span className="mismatch-tag">
                            PO reports {line.supplierReportedOrdered} pack{line.supplierReportedOrdered === 1 ? '' : 's'} (Mismatch)
                          </span>
                        ) : line.isSplit ? (
                          <span className="mismatch-tag" style={{ background: '#fef3c7', color: '#b45309' }}>
                            Partial Dispatch ({line.dispatchedPacks} sent · {line.awaitingDispatchPacks} awaiting)
                          </span>
                        ) : (
                          <small>Live Curaleaf Lab Allocation</small>
                        )}
                      </div>
                    </div>
                    
                    <div className="order-fulfilment-pipeline" role="list" aria-label="Curaleaf fulfilment progress">
                      <div className={pipelineStepClass('pipeline-step pipeline-step--ordered', steps.ordered)} role="listitem">
                        <span className="pipeline-step__num" aria-hidden="true">1</span>
                        <div className="pipeline-step__content">
                          <span className="pipeline-step__label">Ordered</span>
                          <strong className="pipeline-step__value">{line.orderedPacks} <small>pk</small></strong>
                        </div>
                      </div>

                      <div className={pipelineStepClass('pipeline-step pipeline-step--picked', steps.dispensed)} role="listitem">
                        <span className="pipeline-step__num" aria-hidden="true">2</span>
                        <div className="pipeline-step__content">
                          <span className="pipeline-step__label">Curaleaf Dispensed</span>
                          <strong className="pipeline-step__value">{line.allocatedPacks}/{line.orderedPacks} <small>pk</small></strong>
                        </div>
                      </div>

                      <div className={pipelineStepClass('pipeline-step pipeline-step--transit', steps.inTransit)} role="listitem">
                        <span className="pipeline-step__num" aria-hidden="true">3</span>
                        <div className="pipeline-step__content">
                          <span className="pipeline-step__label">In Transit</span>
                          <strong className="pipeline-step__value">
                            {line.inTransitPacks} <small>pk</small>
                            {line.isSplit && line.awaitingDispatchPacks > 0 ? (
                              <span className="pipeline-step__split-tag" title={`${line.awaitingDispatchPacks} pack(s) awaiting next dispatch`}>
                                +{line.awaitingDispatchPacks} split
                              </span>
                            ) : null}
                          </strong>
                        </div>
                      </div>

                      <div className={pipelineStepClass('pipeline-step pipeline-step--received', steps.checkedIn)} role="listitem">
                        <span className="pipeline-step__num" aria-hidden="true">4</span>
                        <div className="pipeline-step__content">
                          <span className="pipeline-step__label">Checked In</span>
                          <strong className="pipeline-step__value">{line.receivedPacks}/{line.orderedPacks} <small>pk</small></strong>
                        </div>
                      </div>
                    </div>

                    <div className="order-fulfilment-bar">
                      <div className="order-fulfilment-bar__fill--allocated" style={{ width: `${line.percentAllocated}%` }} />
                      {line.inTransitPacks > 0 || (line.isSplit && line.awaitingDispatchPacks > 0) ? <div className="order-fulfilment-bar__fill--transit" style={{ width: `${line.percentInTransit}%` }} /> : null}
                      <div className="order-fulfilment-bar__fill--received" style={{ width: `${line.percentReceived}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {receiving ? (
            <div className="order-goods-in">
              <header className="order-goods-in__header">
                <div>
                  <span className="order-goods-in__eyebrow">Curaleaf Consignment Manifest</span>
                  <h3 className="order-goods-in__title">
                    {prescription.status === 'partially-received'
                      ? 'Check in arriving consignment'
                      : 'Check in arriving consignment from Curaleaf'}
                  </h3>
                </div>
                <div className="order-goods-in__header-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm order-goods-in__chase-btn"
                    onClick={() => onChaseCuraleaf?.(prescription, selectedShipmentId || undefined)}
                  >
                    <PhoneCall size={12} /> Chase Curaleaf / Issue
                  </button>
                </div>
              </header>

              <div className="order-goods-in__items">
                {displayLines.map(line => {
                  const dispatchedQty = line.consignmentPacks || line.dispatchedPacks;
                  const isPartial = line.isSplit;

                  return (
                    <div key={line.productId} className="order-goods-in__item-card order-goods-in__item-card--complete">
                      <div className="order-goods-in__item-main">
                        <div className="order-goods-in__item-details">
                          <strong className="order-goods-in__item-name">{line.displayName}</strong>
                          <div className="order-goods-in__item-meta">
                            <span className="pill pill-subtle">Ordered: <strong>{line.orderedPacks} pack{line.orderedPacks === 1 ? '' : 's'}</strong></span>
                            <span className="pill pill-blue">Dispatched: <strong>{dispatchedQty} pack{dispatchedQty === 1 ? '' : 's'}</strong></span>
                            {isPartial ? (
                              <span className="pill pill-amber" style={{ background: '#fef3c7', color: '#b45309' }}>
                                {line.awaitingDispatchPacks} pack{line.awaitingDispatchPacks === 1 ? '' : 's'} still open with Curaleaf
                              </span>
                            ) : (
                              <span className="pill pill-green"><Check size={11} /> Full quantity in consignment</span>
                            )}
                          </div>
                        </div>

                        <div className="order-goods-in__manifest-count">
                          <span className="order-goods-in__manifest-badge">
                            <PackageCheck size={14} /> {dispatchedQty} pack{dispatchedQty === 1 ? '' : 's'} arriving
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="order-goods-in__footer">
                <div className="order-goods-in__summary-pill">
                  <span className="order-goods-in__status-badge order-goods-in__status-badge--ready">
                    <CheckCircle2 size={14} /> Curaleaf shipment manifest verified ({totalConsignmentPacks || totalDispatchedPacks} pk)
                  </span>
                </div>
                <div className="order-goods-in__actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || (totalConsignmentPacks || totalDispatchedPacks) < 1}
                    onClick={() => {
                      const allArrived: Record<string, number> = {};
                      prescription.items.forEach(it => { allArrived[it.productId] = consignmentPacksFor(it.productId); });
                      onReceiptDraftChange({ quantities: allArrived });
                      onConfirmDelivery(selectedShipmentId || undefined);
                    }}
                  >
                    <PackageCheck size={15} />
                    {busy ? 'Recording delivery…' : `Accept Delivery (${totalConsignmentPacks || totalDispatchedPacks} pk)`}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {!receiving && !partialReadyControl && !readyControl && !partialHandoutControl && !fullHandoutControl && !collectionControl && hasShippedNotCheckedIn ? (
            <div className="order-ready-control order-ready-control--hint">
              <span>
                <PackageCheck size={16} style={{ color: 'var(--tenant-primary)' }} />
                <span>
                  <strong>Check in arriving packs before partial handover</strong>
                  <small>{totalShippedPacks - totalReceivedPacks} pack(s) dispatched from Curaleaf are not checked in yet. Accept delivery below when the consignment arrives, then mark ready and hand over partial quantity.</small>
                </span>
              </span>
            </div>
          ) : null}
          {partialReadyControl ? (
            <div className="order-ready-control" style={{ background: 'color-mix(in srgb, #f59e0b 8%, var(--bg-surface))', borderColor: 'color-mix(in srgb, #f59e0b 30%, var(--border))' }}>
              <span>
                <Clock3 size={16} style={{ color: '#d97706' }} />
                <span>
                  <strong>Arrived consignment checked in ({totalConsignmentPacks || totalDispatchedPacks} pk)</strong>
                  <small>Mark these packs ready for collection. {remainingOpen ? `${Math.max(0, totalOrderedPacks - totalDispatchedPacks)} pack(s) remain open with Curaleaf for a later shipment.` : 'Perform pharmacy dispensing checks before patient collection.'}</small>
                </span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onReadyForCollection(selectedShipmentId || undefined)}>
                <Mail size={13} /> {busy ? 'Queuing…' : 'Mark arrived packs ready to collect'}
              </button>
            </div>
          ) : null}
          {readyControl ? (
            <div className="order-ready-control" style={{ background: 'color-mix(in srgb, var(--tenant-primary) 6%, var(--bg-surface))', borderColor: 'color-mix(in srgb, var(--tenant-primary) 25%, var(--border))' }}>
              <span>
                <CheckCircle2 size={18} style={{ color: 'var(--tenant-primary)' }} />
                <span>
                  <strong>All packs checked in ({totalOrderedPacks} pk)</strong>
                  <small>Verified by {prescription.goodsInBy ?? 'Pharmacy staff'}{prescription.goodsInAt ? ` on ${formatDate(prescription.goodsInAt, true)}` : ''}. Perform pharmacy dispensing checks before patient collection.</small>
                </span>
              </span>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onReadyForCollection(selectedShipmentId || undefined)}>
                <Mail size={13} /> {busy ? 'Queuing email…' : 'Mark ready to collect & email patient'}
              </button>
            </div>
          ) : null}
          {partialHandoutControl && onOpenHandout ? (
            <div className="order-ready-control" style={{ background: 'color-mix(in srgb, var(--tenant-primary) 6%, var(--bg-surface))', borderColor: 'color-mix(in srgb, var(--tenant-primary) 25%, var(--border))' }}>
              <span>
                <PackageCheck size={16} style={{ color: 'var(--tenant-primary)' }} />
                <span>
                  <strong>Arrived packs ready — partial handover available</strong>
                  <small>Hand over only the checked-in packs now. Remaining quantity stays open with Curaleaf and the split dispatch banner remains visible.</small>
                </span>
              </span>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onOpenHandout(true, selectedShipmentId || undefined)}>
                <Check size={13} /> Hand over partial ({arrivedNotCollectedPacks} pk)
              </button>
            </div>
          ) : null}
          {fullHandoutControl && onOpenHandout ? (
            <div className="order-ready-control">
              <span>
                <PackageCheck size={16} />
                <span>
                  <strong>All packs ready for handover</strong>
                  <small>Every ordered pack has been checked in and is ready for patient collection.</small>
                </span>
              </span>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onOpenHandout(false, selectedShipmentId || undefined)}>
                <Check size={13} /> Hand over
              </button>
            </div>
          ) : null}
          {collectionControl ? (
            <div className="order-ready-confirmed">
              <Mail size={16} />
              <span>
                <strong>Medication ready for patient collection</strong>
                <small>Collection email notification queued{prescription.readyAt ? ` on ${formatDate(prescription.readyAt, true)}` : ''}. Hand out medication when patient arrives at dispensary.</small>
              </span>
            </div>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

function LedgerCopyButton({ detailKey, copyKey, value, copiedDetailKey, onCopy, compact = false }: {
  detailKey: string;
  copyKey: string;
  value: string;
  copiedDetailKey: string | null;
  onCopy: (key: string, text: string) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`order-ledger__copy-btn ${compact ? 'order-ledger__copy-btn--compact' : ''}`}
      onClick={() => onCopy(copyKey, value)}
      title="Copy"
      aria-label="Copy value"
    >
      {copiedDetailKey === detailKey ? <Check size={compact ? 10 : 11} aria-hidden="true" /> : <Copy size={compact ? 10 : 11} aria-hidden="true" />}
    </button>
  );
}

function LedgerValue({ children, mono = false, muted = false, title }: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`order-ledger__value ${mono ? 'order-ledger__value--mono' : ''} ${muted ? 'order-ledger__value--muted' : ''}`}
      title={title}
    >
      {children}
    </span>
  );
}

function OrderDetailsDrawer({ order, patient, cleanStreetAddress, patientPostcode, pharmacyName, showOrderDetails, onToggle, copiedDetailKey, onCopy, resolveProductName }: {
  order: PatientOrder;
  patient: CRMPatient | null | undefined;
  cleanStreetAddress: string;
  patientPostcode: string | null;
  pharmacyName: string | null;
  showOrderDetails: boolean;
  onToggle: () => void;
  copiedDetailKey: string | null;
  onCopy: (key: string, text: string) => void;
  resolveProductName: (item: { name?: string; productId: string; formulaId?: string }) => string;
}) {
  const consignments = collectOrderConsignments(order);
  const courierLabel = orderCourierLabel(order);
  const deliveryDestination = orderDeliveryDestination(order, pharmacyName);
  const computedTotal = orderFinancialTotal(order);
  const paymentReference = order.payment.manualReference ?? order.payment.ref ?? null;

  return (
    <div className="order-details-drawer">
      <button
        type="button"
        className="order-details-drawer__toggle-btn"
        onClick={onToggle}
        aria-expanded={showOrderDetails}
      >
        <div className="order-details-drawer__toggle-left">
          <span className="order-details-drawer__toggle-icon">
            <FileText size={16} />
          </span>
          <div className="order-details-drawer__toggle-text">
            <strong>{showOrderDetails ? 'Hide order details & history' : 'Order details & audit history'}</strong>
            <small>References, consignments, contact, payment, and timeline</small>
          </div>
        </div>
        <div className="order-details-drawer__toggle-right">
          <span className="order-details-drawer__toggle-pill">
            {showOrderDetails ? 'Collapse' : 'Expand details'}
          </span>
          {showOrderDetails ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {showOrderDetails ? (
        <div className="order-details-drawer__content">
          <div className="order-details-drawer__grid">
            <section className="order-ledger__card">
              <header className="order-ledger__card-head">
                <span><small>Curaleaf Rocky API</small><strong>Prescription & PO references</strong></span>
                <FileCode2 size={15} aria-hidden="true" />
              </header>
              <div className="order-ledger__stack">
                {order.prescriptions.map((rx, rxIdx) => (
                  <div key={rx.id} className="order-ledger__group">
                    {order.prescriptions.length > 1 ? (
                      <p className="order-ledger__group-label">Prescription {rxIdx + 1}</p>
                    ) : null}
                    <dl className="order-ledger__facts">
                      <div className="order-ledger__row">
                        <dt>Prescriber</dt>
                        <dd><LedgerValue>{rx.prescriber || 'Prescriber pending'}</LedgerValue></dd>
                      </div>
                      <div className="order-ledger__row">
                        <dt>PO reference</dt>
                        <dd className="order-ledger__row-value">
                          <LedgerValue mono>{rx.poRef ?? 'Pending placement'}</LedgerValue>
                          {rx.poRef ? <LedgerCopyButton detailKey={`po_${rx.id}`} copyKey={`po_${rx.id}`} value={rx.poRef} copiedDetailKey={copiedDetailKey} onCopy={onCopy} /> : null}
                        </dd>
                      </div>
                      <div className="order-ledger__row">
                        <dt>Serial number</dt>
                        <dd className="order-ledger__row-value">
                          <LedgerValue mono>{rx.serialNumber ?? 'Not recorded'}</LedgerValue>
                          {rx.serialNumber ? <LedgerCopyButton detailKey={`serial_${rx.id}`} copyKey={`serial_${rx.id}`} value={rx.serialNumber} copiedDetailKey={copiedDetailKey} onCopy={onCopy} /> : null}
                        </dd>
                      </div>
                      {rx.curaleafPrescriptionId ? (
                        <div className="order-ledger__row">
                          <dt>Curaleaf Rx ID</dt>
                          <dd><LedgerValue mono>{rx.curaleafPrescriptionId}</LedgerValue></dd>
                        </div>
                      ) : null}
                      <div className="order-ledger__row">
                        <dt>Curaleaf PO state</dt>
                        <dd><LedgerValue>{rx.purchaseOrderState ?? (rx.placed ? 'ACTIVE' : 'DRAFT')}</LedgerValue></dd>
                      </div>
                      {rx.placedAt ? (
                        <div className="order-ledger__row">
                          <dt>Placed with Curaleaf</dt>
                          <dd><LedgerValue>{formatDate(rx.placedAt, true)}</LedgerValue></dd>
                        </div>
                      ) : null}
                      {rx.prescriberGmcNumber || rx.prescriberGphcNumber ? (
                        <div className="order-ledger__row">
                          <dt>Prescriber registration</dt>
                          <dd><LedgerValue>{rx.prescriberGmcNumber ? `GMC #${rx.prescriberGmcNumber}` : `GPhC #${rx.prescriberGphcNumber}`}</LedgerValue></dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ))}
              </div>
            </section>

            <section className="order-ledger__card">
              <header className="order-ledger__card-head">
                <span><small>Courier & logistics</small><strong>Consignment & destination</strong></span>
                <Truck size={15} aria-hidden="true" />
              </header>
              <dl className="order-ledger__facts">
                <div className="order-ledger__row">
                  <dt>Courier service</dt>
                  <dd><LedgerValue>{courierLabel ?? 'Not yet dispatched'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt>Delivery destination</dt>
                  <dd><LedgerValue>{deliveryDestination ?? 'Not yet dispatched'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt>Fulfilment model</dt>
                  <dd><LedgerValue muted>Curaleaf dispatch → dispensary goods-in → in-person collection</LedgerValue></dd>
                </div>
              </dl>
              {consignments.length ? (
                <ul className="order-ledger__consignments">
                  {consignments.map((consignment, index) => (
                    <li key={consignment.id} className="order-ledger__consignment">
                      <div className="order-ledger__consignment-head">
                        <strong>Consignment {index + 1}</strong>
                        <span className={`order-ledger__status order-ledger__status--${consignment.status.replace(/_/g, '-')}`}>{consignment.statusLabel}</span>
                      </div>
                      <dl className="order-ledger__facts order-ledger__facts--nested">
                        <div className="order-ledger__row">
                          <dt>Shipment ID</dt>
                          <dd className="order-ledger__row-value">
                            <LedgerValue mono title={consignment.id}>{shortConsignmentId(consignment.id)}</LedgerValue>
                            <LedgerCopyButton detailKey={`shp_${consignment.id}`} copyKey={`shp_${consignment.id}`} value={consignment.id} copiedDetailKey={copiedDetailKey} onCopy={onCopy} compact />
                          </dd>
                        </div>
                        {consignment.poRef ? (
                          <div className="order-ledger__row">
                            <dt>PO reference</dt>
                            <dd><LedgerValue mono>{consignment.poRef}</LedgerValue></dd>
                          </div>
                        ) : null}
                        <div className="order-ledger__row">
                          <dt>Packs in consignment</dt>
                          <dd><LedgerValue>{consignment.packCount} pack{consignment.packCount === 1 ? '' : 's'}</LedgerValue></dd>
                        </div>
                        {consignment.createdAt ? (
                          <div className="order-ledger__row">
                            <dt>Dispatched</dt>
                            <dd><LedgerValue>{formatDate(consignment.createdAt, true)}</LedgerValue></dd>
                          </div>
                        ) : null}
                        {consignment.shipmentCharge ? (
                          <div className="order-ledger__row">
                            <dt>Shipment charge</dt>
                            <dd><LedgerValue>£{consignment.shipmentCharge}</LedgerValue></dd>
                          </div>
                        ) : null}
                        {consignment.shippingAddress ? (
                          <div className="order-ledger__row">
                            <dt>Ship-to address</dt>
                            <dd><LedgerValue>{consignment.shippingAddress}</LedgerValue></dd>
                          </div>
                        ) : null}
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="order-ledger__empty">Not yet dispatched — consignment details appear when Curaleaf creates a shipment.</p>
              )}
            </section>

            <section className="order-ledger__card">
              <header className="order-ledger__card-head">
                <span><small>Customer</small><strong>Contact details</strong></span>
                <UserRound size={15} aria-hidden="true" />
              </header>
              <dl className="order-ledger__facts">
                <div className="order-ledger__row">
                  <dt><Mail size={12} aria-hidden="true" /> Email</dt>
                  <dd><LedgerValue>{patient?.email ?? 'Not recorded'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt><Phone size={12} aria-hidden="true" /> Mobile</dt>
                  <dd><LedgerValue>{patient?.mobile ?? 'Not recorded'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt><UserRound size={12} aria-hidden="true" /> Date of birth</dt>
                  <dd><LedgerValue>{patient?.dob ? formatPatientDob(patient.dob) : 'Not recorded'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt><MapPin size={12} aria-hidden="true" /> Address</dt>
                  <dd><LedgerValue>{cleanStreetAddress || 'Not recorded'}</LedgerValue></dd>
                </div>
                {patientPostcode ? (
                  <div className="order-ledger__row">
                    <dt><MapPin size={12} aria-hidden="true" /> Postcode</dt>
                    <dd><LedgerValue>{patientPostcode}</LedgerValue></dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="order-ledger__card">
              <header className="order-ledger__card-head">
                <span><small>Financial breakdown</small><strong>{order.payment.status === 'paid' ? 'Payment cleared' : 'Payment outstanding'}</strong></span>
                {order.payment.route === 'worldpay' ? <CreditCard size={15} aria-hidden="true" /> : <Banknote size={15} aria-hidden="true" />}
              </header>
              <dl className="order-ledger__facts">
                {order.prescriptions.flatMap(rx => rx.items).map(item => (
                  <div key={item.productId} className="order-ledger__row">
                    <dt>{resolveProductName(item)} <span className="order-ledger__meta">{item.qty} × {money(item.retail)}</span></dt>
                    <dd><LedgerValue>{money(item.retail * item.qty)}</LedgerValue></dd>
                  </div>
                ))}
                {order.dispensingFee ? (
                  <div className="order-ledger__row">
                    <dt>Dispensing fee</dt>
                    <dd><LedgerValue>{money(order.dispensingFee)}</LedgerValue></dd>
                  </div>
                ) : null}
                <div className="order-ledger__row order-ledger__row--total">
                  <dt>Total {order.payment.status === 'paid' ? 'paid' : 'due'}</dt>
                  <dd><LedgerValue>{money(order.payment.amount)}</LedgerValue></dd>
                </div>
                {Math.abs(computedTotal - order.payment.amount) > 0.009 ? (
                  <div className="order-ledger__row">
                    <dt>Line-item subtotal</dt>
                    <dd><LedgerValue muted>{money(computedTotal)}</LedgerValue></dd>
                  </div>
                ) : null}
                <div className="order-ledger__row">
                  <dt>Payment route</dt>
                  <dd><LedgerValue>{order.payment.route === 'worldpay' ? 'Worldpay' : 'Pharmacy managed'}</LedgerValue></dd>
                </div>
                <div className="order-ledger__row">
                  <dt>Requested</dt>
                  <dd><LedgerValue>{formatDate(order.payment.sentAt, true)}</LedgerValue></dd>
                </div>
                {order.payment.paidAt ? (
                  <div className="order-ledger__row">
                    <dt>Paid at</dt>
                    <dd><LedgerValue>{formatDate(order.payment.paidAt, true)}</LedgerValue></dd>
                  </div>
                ) : null}
                <div className="order-ledger__row">
                  <dt>Reference</dt>
                  <dd className="order-ledger__row-value">
                    <LedgerValue mono>{paymentReference ?? 'Pending'}</LedgerValue>
                    {paymentReference ? <LedgerCopyButton detailKey="pay_ref" copyKey="pay_ref" value={paymentReference} copiedDetailKey={copiedDetailKey} onCopy={onCopy} /> : null}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="order-ledger__card order-ledger__card--timeline">
            <header className="order-ledger__card-head">
              <span><small>Audit trail</small><strong>Activity timeline</strong></span>
              <Clock3 size={15} aria-hidden="true" />
            </header>
            <OrderTimeline order={order} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function OrderTimeline({ order }: { order: PatientOrder & { handoutAt?: Date | string | null; handoutRecipient?: string | null } }) {
  const events = buildOrderTimelineEvents(order);
  if (!events.length) {
    return <p className="order-ledger__empty">No activity recorded yet.</p>;
  }
  return (
    <ol className="order-crm-timeline order-ledger__timeline">
      {events.map((event, index) => (
        <li key={`${event.label}-${index}`}>
          <span aria-hidden="true" />
          <div>
            <strong>{event.label}</strong>
            <small>{event.detail}</small>
            <time dateTime={event.date ? new Date(event.date).toISOString() : undefined}>{formatDate(event.date, true)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
