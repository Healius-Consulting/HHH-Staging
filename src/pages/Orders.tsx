import { useEffect, useMemo, useRef, useState } from 'react';
import { curaleafDeliveryGuidance } from '@hhh/domain/delivery';
import {
  AlertTriangle,
  Archive,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  CreditCard,
  FileText,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Truck,
  UserRound,
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
import { hasDispatchedRemainder, orderCancellationResolution, orderStage, stageMatchesFilter, type OrderStage, type StageFilter } from '../utils/orderStage';
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
  'awaiting-payment': { label: 'Awaiting payment', description: 'Payment request sent to patient', tone: 'warning', icon: Clock3 },
  paid: { label: 'Paid', description: 'Payment received; awaiting supplier update', tone: 'success', icon: CreditCard },
  'curaleaf-pending': { label: 'With Curaleaf', description: 'Awaiting supplier decision', tone: 'info', icon: CircleDot },
  'curaleaf-approved': { label: 'Processing', description: 'Curaleaf is picking the order', tone: 'info', icon: CircleDot },
  dispatched: { label: 'In delivery', description: 'Dispatched to the pharmacy', tone: 'info', icon: Truck },
  delivered: { label: 'Delivered', description: 'Received by the pharmacy', tone: 'success', icon: PackageCheck },
  ready: { label: 'Ready to collect', description: 'Patient can collect from pharmacy', tone: 'success', icon: Package },
  collected: { label: 'Collected', description: 'Medication handed to patient', tone: 'neutral', icon: Check },
  rejected: { label: 'Rejected', description: 'Order needs review or recreation', tone: 'danger', icon: XCircle },
  archived: { label: 'Archived', description: 'Prescription cycle expired', tone: 'neutral', icon: Archive },
  cancelled: { label: 'Cancelled', description: 'Cancellation retained for audit', tone: 'neutral', icon: XCircle },
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
  if (cancellationResolution !== 'none' || record.stage === 'archived') return 3;
  if (record.stage === 'collected') return 2;
  if (record.stage === 'rejected') return 1;
  return 0;
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
  const [handoutOrderId, setHandoutOrderId] = useState<number | null>(null);
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
      const hasCuraleafOrder = order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
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
    const lines = prescription.items.map(item => ({
      productId: item.productId,
      quantityReceived: complete ? item.qty : Math.max(0, Math.min(item.qty, Math.floor(draft.quantities[item.productId] ?? 0))),
    }));
    const anyReceived = lines.some(line => line.quantityReceived > 0);
    const allReceived = prescription.items.length > 0 && prescription.items.every(item => lines.find(line => line.productId === item.productId)?.quantityReceived === item.qty);
    const missingBatchDetails = lines.some(line => line.quantityReceived > 0 && (!draft.batches[line.productId]?.trim() || !draft.expiries[line.productId]));
    if (missingBatchDetails) {
      dispatch({ type: 'ADD_TOAST', message: 'Enter the batch number and batch expiry for every received medicine.', toastType: 'warning' });
      return;
    }
    if (!complete && !anyReceived) {
      dispatch({ type: 'ADD_TOAST', message: 'Enter at least one received pack before saving a partial delivery.', toastType: 'warning' });
      return;
    }
    if (!complete && allReceived) {
      dispatch({ type: 'ADD_TOAST', message: 'All packs are present. Use Confirm complete delivery instead.', toastType: 'info' });
      return;
    }
    setFulfilmentBusyRxId(prescription.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        const targetShipmentId = shipmentId ?? prescription.shipmentId;
        if (!targetShipmentId) throw new Error('The Curaleaf shipment reference is not linked yet. Sync shipments and try again.');
        await recordPortalGoodsReceipt(targetShipmentId, {
          organisationId: state.currentOrganisationId,
          items: prescription.items.map(item => ({
            productId: item.productId,
            expectedQuantity: item.qty,
            receivedQuantity: lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0,
            batchNumber: draft.batches[item.productId]?.trim() || null,
            expiryDate: draft.expiries[item.productId] || null,
            issue: complete ? 'none' : (lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0) < item.qty ? 'short' : 'none',
            notes: draft.note.trim() || undefined,
          })),
        });
      }
      dispatch({ type: 'RECORD_GOODS_RECEIPT', orderId: order.id, rxId: prescription.id, lines, note: draft.note });
      setReceiptDrafts(current => ({ ...current, [prescription.id]: { ...draft, quantities: Object.fromEntries(lines.map(line => [line.productId, line.quantityReceived])), note: draft.note } }));
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
        const targetShipmentId = shipmentId ?? prescription.shipmentId;
        if (!targetShipmentId) throw new Error('The Curaleaf shipment reference is not linked yet. Sync shipments and try again.');
        await updatePortalShipmentStatus(targetShipmentId, { organisationId: state.currentOrganisationId, status: 'ready_for_collection' });
      }
      if (isLocalPortalPreview || state.workspaceMode !== 'live') dispatch({ type: 'MARK_READY_FOR_COLLECTION', orderId: order.id, rxId: prescription.id });
      else dispatch({ type: 'ADD_TOAST', message: 'This shipment is ready and its customer message has been queued.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Ready-to-collect could not be confirmed.', toastType: 'error' });
    } finally {
      setFulfilmentBusyRxId(null);
    }
  };

  const handleOrderHandout = async (order: PatientOrder) => {
    if (handoutBusy) return;
    setHandoutBusy(true);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!order.backendId) throw new Error('This order has not finished saving. Refresh and try again.');
        await handoutPortalOrder(order.backendId, { organisationId: state.currentOrganisationId });
      }
      dispatch({ type: 'HANDOUT_ORDER', orderId: order.id });
      dispatch({ type: 'ADD_TOAST', message: 'Handout recorded. The order is now completed.', toastType: 'success' });
      setHandoutOrderId(null);
      setActiveFilter('completed');
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
            {filtered.length ? activeFilter === 'cancelled' ? (
              <>
                <OrderListGroup label="Needs action" detail="Supplier or refund follow-up" records={cancellationNeedsAction} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} />
                <OrderListGroup label="Resolved & refunded" detail="Closed order history" records={cancellationClosed} selectedOrderId={selected?.order.id ?? null} now={now} onSelect={setSelectedOrderId} />
              </>
            ) : filtered.map(record => (
              <OrderListRow key={record.order.id} record={record} selected={selected?.order.id === record.order.id} now={now} onSelect={() => setSelectedOrderId(record.order.id)} />
            )) : <div className="order-crm-empty"><Package size={26} /><strong>No orders in this stage</strong><span>Try another filter or search term.</span></div>}
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
              onOpenHandout={() => setHandoutOrderId(selected.order.id)}
              manualForm={manualForms[selected.order.id] ?? DEFAULT_MANUAL_FORM}
              onManualFormChange={patch => updateManualForm(selected.order.id, patch)}
              onRecordManual={() => void handleRecordManualPayment(selected.order)}
              onRedo={() => {
                const existingDraft = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'none' && order.redoContext?.originalOrderId === selected.order.id);
                dispatch({ type: 'START_REDO_ORDER', sourceOrderId: selected.order.id });
                dispatch({ type: 'ADD_TOAST', message: existingDraft ? `Opened existing replacement ${orderReference(existingDraft)}.` : `Started a replacement draft for ${orderReference(selected.order)}.`, toastType: 'info' });
              }}
              onPrint={() => window.print()}
              busy={submittingOrderId === selected.order.id}
              receiptDrafts={receiptDrafts}
              fulfilmentBusyRxId={fulfilmentBusyRxId}
              onReceiptDraftChange={updateReceiptDraft}
              onSavePartial={(prescription, shipmentId) => void handleGoodsReceipt(selected.order, prescription, false, shipmentId)}
              onConfirmDelivery={(prescription, shipmentId) => void handleGoodsReceipt(selected.order, prescription, true, shipmentId)}
              onReadyForCollection={(prescription, shipmentId) => void handleReadyForCollection(selected.order, prescription, shipmentId)}
              onRecordRejection={prescription => void handleRecordRejection(selected.order, prescription)}
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
            />
          ) : <div className="order-crm-empty order-crm-empty--detail"><Package size={38} /><strong>Select an order</strong><span>Customer journey, payment and fulfilment information will appear here.</span></div>}
        </main>
      </div>
      {handoutOrderId && selected?.order.id === handoutOrderId ? (
        <div className="order-handout-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !handoutBusy) setHandoutOrderId(null); }}>
          <section className="order-handout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="order-handout-title" aria-describedby="order-handout-description">
            <span className="order-handout-dialog__icon"><PackageCheck size={22} /></span>
            <div><small>Patient handout</small><h2 id="order-handout-title">Confirm medication has been handed to the patient</h2><p id="order-handout-description">This completes {orderReference(selected.order)} and records the handout in the audit trail.</p></div>
            <footer><button type="button" className="btn btn-secondary" disabled={handoutBusy} onClick={() => setHandoutOrderId(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={handoutBusy} onClick={() => void handleOrderHandout(selected.order)}><Check size={14} /> {handoutBusy ? 'Recording handout…' : 'Confirm handout'}</button></footer>
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
    <button type="button" className={`order-crm-row${isCancellation ? ` order-crm-row--cancelled order-crm-row--${cancellationResolution}` : ''}${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className={`order-crm-row__stage order-tone--${meta.tone}`}><Icon size={15} /></span>
      <span className="order-crm-row__identity"><strong title={patientName}>{compactPatientName(patientName)}</strong><small>{record.order.redoContext ? 'Replacement' : 'Order'} {orderReference(record.order)} · {record.order.prescriptions.length} Rx</small></span>
      <span className="order-crm-row__position"><strong>{money(record.order.payment.amount)}</strong><small>{shipmentListCopy(record, now) ?? formatDate(record.order.date)}</small></span>
      <span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span>
    </button>
  );
}

function OrderDetail({ record, now, placementConfirmation, handoutBusy, onOpenHandout, manualForm, onManualFormChange, onRecordManual, onRedo, onPrint, busy, receiptDrafts, fulfilmentBusyRxId, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection, onRecordRejection, onManualPlace, onPaymentLinkResend, paymentLinkBusy, refundReference, onRefundReferenceChange, onRequestRefund, onConfirmRefund, refundBusy, cancellationEditorOpen, cancellationReason, cancellationNote, cancellationReference, cancellationContactNote, cancellationBusy, onOpenCancellation, onCloseCancellation, onCancellationReasonChange, onCancellationNoteChange, onCancellationReferenceChange, onCancellationContactNoteChange, onRequestCancellation, onRecordCuraleafContact, onConfirmCuraleafCancellation }: {
  record: OrderRecord;
  now: Date;
  placementConfirmation: string | null;
  handoutBusy: boolean;
  onOpenHandout: () => void;
  manualForm: ManualPaymentForm;
  onManualFormChange: (patch: Partial<ManualPaymentForm>) => void;
  onRecordManual: () => void;
  onRedo: () => void;
  onPrint: () => void;
  busy: boolean;
  receiptDrafts: Record<number, GoodsReceiptDraft>;
  fulfilmentBusyRxId: number | null;
  onReceiptDraftChange: (prescription: Prescription, patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: (prescription: Prescription, shipmentId?: string) => void;
  onConfirmDelivery: (prescription: Prescription, shipmentId?: string) => void;
  onReadyForCollection: (prescription: Prescription, shipmentId?: string) => void;
  onRecordRejection: (prescription: Prescription) => void;
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
}) {
  const [expanded, setExpanded] = useState(false);
  const { order, patient, stage } = record;
  const meta = recordStageMeta(record);
  const Icon = meta.icon;
  const cancellationResolution = orderCancellationResolution(order);
  const cancellationClosed = ['resolved', 'refunded'].includes(cancellationResolution);
  const allPlaced = order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.placed);
  const canRedo = Boolean(record.unresolvedReason) && (stage === 'rejected' || stage === 'archived');
  const paymentFormVisible = stage === 'awaiting-payment' && order.payment.route === 'pharmacy';
  const curaleafCancellationLocked = Boolean(order.curaleafCancellation && order.curaleafCancellation.status !== 'confirmed');
  const mayCancel = !order.cancellation && !['collected', 'cancelled'].includes(stage);
  const hasCuraleafOrder = order.prescriptions.some(prescription => prescription.placed || prescription.poRef);

  return (
    <article className="order-crm-record">
      <header className="order-crm-record__header">
        <div className="order-crm-record__identity">
          <span className={`order-crm-record__stage order-tone--${meta.tone}`}><Icon size={18} /></span>
          <span><small>{order.redoContext ? 'Replacement' : 'Order'} {orderReference(order)} · opened {formatDate(order.date)}{order.redoContext ? ` · replaces #${order.redoContext.originalOrderId}` : ''}</small><strong>{patient?.name ?? 'Unknown patient'}</strong><em>{meta.description}</em></span>
        </div>
        <div className="order-crm-record__value"><small>Patient total</small><strong>{money(order.payment.amount)}</strong><span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span></div>
        <div className="order-crm-record__actions">
          {stage === 'ready' ? <button type="button" className="btn btn-primary btn-sm" disabled={handoutBusy} onClick={onOpenHandout}><Check size={13} /> Handout now</button> : null}
          {mayCancel ? <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenCancellation}>{hasCuraleafOrder ? <PhoneCall size={13} /> : <XCircle size={13} />} {hasCuraleafOrder ? 'Call Curaleaf to cancel' : 'Cancel order'}</button> : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPrint}><Printer size={13} /> Print</button>
        </div>
      </header>

      {cancellationClosed ? <CancellationClosureSummary order={order} resolution={cancellationResolution as 'resolved' | 'refunded'} /> : <JourneyRail stage={stage} paymentPaid={order.payment.status === 'paid'} />}

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
      {stage === 'paid' && !allPlaced ? <PrePlacementDeliveryGuidance now={now} /> : null}
      {['curaleaf-approved', 'dispatched'].includes(stage) ? <FulfilmentDeliveryStatus order={order} now={now} /> : null}

      {(stage === 'rejected' || stage === 'archived') ? (
        <div className={`order-crm-alert order-crm-alert--${stage === 'rejected' ? 'danger' : 'neutral'}`}>
          {stage === 'rejected' ? <ShieldAlert size={17} /> : <Archive size={17} />}
          <span><strong>{stage === 'rejected' ? 'Curaleaf exception requires attention' : 'Prescription cycle archived'}</strong><small>{stage === 'rejected' ? 'Review the supplier response, then recreate the order against a valid prescription.' : 'This order passed its prescription-cycle deadline and is retained for the audit trail.'}</small></span>
        </div>
      ) : null}

      {(stage === 'rejected' || stage === 'archived') && order.payment.status === 'paid' ? (
        <PaidExceptionResolution order={order} canReplace={canRedo} lockedByCuraleaf={curaleafCancellationLocked} busy={refundBusy} refundReference={refundReference} onRefundReferenceChange={onRefundReferenceChange} onReplace={onRedo} onRequestRefund={onRequestRefund} onConfirmRefund={onConfirmRefund} />
      ) : null}

      {cancellationResolution === 'needs-action' && order.payment.status === 'paid' && order.cancellation?.status === 'refund_required' ? (
        <PaidExceptionResolution order={order} canReplace={false} lockedByCuraleaf={curaleafCancellationLocked} busy={refundBusy} refundReference={refundReference} onRefundReferenceChange={onRefundReferenceChange} onReplace={onRedo} onRequestRefund={onRequestRefund} onConfirmRefund={onConfirmRefund} />
      ) : null}

      {!expanded ? (
        <section className={`order-fulfilment-collapsed${cancellationClosed ? ' order-fulfilment-collapsed--audit' : ''}`}>
          <div><FileText size={17} /><span><small>{cancellationClosed ? 'Order audit' : 'Prescription fulfilment'}</small><strong>{order.prescriptions.length} prescription{order.prescriptions.length === 1 ? '' : 's'} · {meta.label}</strong><em>{cancellationClosed ? 'Closed history is available for reference; no operational action is required.' : collapsedActionCopy(stage)}</em></span></div>
          <button type="button" className={`btn ${cancellationClosed ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setExpanded(true)}>{cancellationClosed ? 'View audit details' : 'Open full order view'} <ChevronDown size={14} /></button>
        </section>
      ) : (
      <>
      <div className="order-full-view-controls"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(false)}>Close full order view <ChevronUp size={14} /></button></div>
      <div className="order-crm-record__body">
        <section className="order-crm-main">
          <div className="order-crm-section-heading"><span><small>Prescription fulfilment</small><strong>{order.prescriptions.length} prescription{order.prescriptions.length === 1 ? '' : 's'}</strong></span><FileText size={16} /></div>
          <div className="order-crm-prescriptions">
            {order.prescriptions.map((prescription, index) => <PrescriptionCard
              key={prescription.id}
              prescription={prescription}
              index={index}
              receiptDraft={receiptDrafts[prescription.id] ?? {
                quantities: Object.fromEntries(prescription.items.map(item => [item.productId, prescription.receivedItems?.find(received => received.productId === item.productId)?.quantityReceived ?? 0])),
                batches: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
                expiries: Object.fromEntries(prescription.items.map(item => [item.productId, ''])),
                note: prescription.goodsInNote ?? '',
              }}
              busy={fulfilmentBusyRxId === prescription.id}
              onReceiptDraftChange={patch => onReceiptDraftChange(prescription, patch)}
              onSavePartial={shipmentId => onSavePartial(prescription, shipmentId)}
              onConfirmDelivery={shipmentId => onConfirmDelivery(prescription, shipmentId)}
              onReadyForCollection={shipmentId => onReadyForCollection(prescription, shipmentId)}
              onRecordRejection={() => onRecordRejection(prescription)}
              onManualPlace={() => onManualPlace(prescription)}
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

          <OrderTimeline order={order} />
        </section>

        <aside className="order-crm-sidebar">
          <section>
            <div className="order-crm-section-heading"><span><small>Customer</small><strong>Contact details</strong></span><UserRound size={15} /></div>
            <dl className="order-crm-facts">
              <div><dt><Mail size={12} /> Email</dt><dd>{patient?.email ?? 'Not recorded'}</dd></div>
              <div><dt><Phone size={12} /> Mobile</dt><dd>{patient?.mobile ?? 'Not recorded'}</dd></div>
              <div><dt><UserRound size={12} /> Date of birth</dt><dd>{patient?.dob ? formatPatientDob(patient.dob) : 'Not recorded'}</dd></div>
              <div><dt><MapPin size={12} /> Address</dt><dd>{patient?.address ?? 'Not recorded'}</dd></div>
            </dl>
          </section>
          <section>
            <div className="order-crm-section-heading"><span><small>Payment</small><strong>{order.payment.status === 'paid' ? 'Cleared' : 'Outstanding'}</strong></span>{order.payment.route === 'worldpay' ? <CreditCard size={15} /> : <Banknote size={15} />}</div>
            <dl className="order-crm-facts">
              <div><dt>Route</dt><dd>{order.payment.route === 'worldpay' ? 'Worldpay' : 'Pharmacy managed'}</dd></div>
              <div><dt>Requested</dt><dd>{formatDate(order.payment.sentAt, true)}</dd></div>
              <div><dt>Paid</dt><dd>{formatDate(order.payment.paidAt, true)}</dd></div>
              <div><dt>Reference</dt><dd>{order.payment.manualReference ?? order.payment.ref ?? 'Pending'}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
      </>
      )}
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
  const placedAt = order.prescriptions.map(prescription => prescription.placedAt).find(Boolean);
  return placedAt ? curaleafDeliveryGuidance(placedAt) : null;
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
    ? `Order in the next ${countdownLabel(guidance.countdownMinutes)} for expected delivery ${formatDeliveryDate(guidance.nextDay)} — allow up to 4 working days.`
    : guidance.scenario === 'DT-2'
      ? `Today's 2:30pm cut-off has passed — your order joins tomorrow's dispatch. Expected delivery ${range}.`
      : guidance.scenario === 'DT-3'
        ? 'Order by 2:30pm today for expected delivery Monday. After that, orders are processed Monday for delivery from Tuesday.'
        : `Orders placed now are processed Monday — expected delivery ${range}.`;
  return <div className="order-delivery-warning order-delivery-warning--upcoming"><Clock3 size={17} /><span><strong>{copy}</strong>{['DT-1', 'DT-3'].includes(guidance.scenario) ? <small>Expected delivery window: {range}.</small> : null}</span></div>;
}

function backorderedProducts(order: PatientOrder) {
  return order.prescriptions.flatMap(prescription => prescription.fulfilmentLines?.flatMap(line => {
    if (!hasDispatchedRemainder(line)) return [];
    const product = prescription.items.find(item => item.productId === line.productId);
    return product ? [product.name] : [];
  }) ?? []);
}

function FulfilmentDeliveryStatus({ order, now }: { order: PatientOrder; now: Date }) {
  const guidance = deliveryGuidanceForOrder(order);
  if (!guidance) return <div className="order-delivery-warning order-delivery-warning--missing"><AlertTriangle size={17} /><span><strong>Delivery estimate pending</strong><small>The delivery window will appear when the Curaleaf placement time is available.</small></span></div>;
  const range = deliveryRange(guidance);
  const delayed = [...new Set(backorderedProducts(order))];
  if (delayed.length) {
    return <div className="order-delivery-warning order-delivery-warning--due"><AlertTriangle size={17} /><span><strong>Partially dispatched · current shipment expected {range}.</strong><small>{delayed.map(product => `${product}: the remaining quantity is still open with Curaleaf and can be sent in a later shipment.`).join(' ')}</small></span></div>;
  }
  const dispatched = order.prescriptions.some(prescription => prescription.status === 'dispatched');
  const overdue = londonDateKey(now) > guidance.windowEnd;
  if (dispatched) {
    const copy = overdue
      ? `Expected by ${formatDeliveryDate(guidance.windowEnd)} — not yet received? Check with Curaleaf customer service.`
      : `Dispatched · expected by ${formatDeliveryDate(guidance.windowEnd)}`;
    return <div className={`order-delivery-warning order-delivery-warning--${overdue ? 'overdue' : 'due'}`}>{overdue ? <AlertTriangle size={17} /> : <Truck size={17} />}<span><strong>{copy}</strong><small>Expected delivery window: {range}. Pharmacy goods-in is required before this order can become ready to collect.</small></span></div>;
  }
  return <div className="order-delivery-warning order-delivery-warning--upcoming"><Truck size={17} /><span><strong>Expected at the pharmacy {range}</strong><small>This is a staff estimate based on working days, not a courier-delivered confirmation.</small></span></div>;
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
  const hasCuraleafOrder = order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
  if (!order.cancellation && editorOpen) return (
    <section className="order-cancellation-card order-cancellation-card--compose">
      <header><span><small>Controlled cancellation</small><strong>Cancel {orderReference(order)}</strong></span><button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Keep order</button></header>
      <div className="order-cancellation-warning"><AlertTriangle size={16} /><span><strong>{hasCuraleafOrder ? 'Curaleaf must be contacted first' : order.payment.status === 'paid' ? 'This is a paid order' : 'The payment request will be retired'}</strong><small>{hasCuraleafOrder ? 'Refund and replacement actions remain locked until Curaleaf confirms cancellation.' : order.payment.status === 'paid' ? 'The pharmacy will receive an action to refund the patient and record the reference.' : 'The order and link are cancelled in HHH. A late provider payment will be flagged for refund.'}</small></span></div>
      <div className="order-cancellation-fields">
        <label><span>Reason</span><select className="input select" value={reason} onChange={event => onReasonChange(event.target.value as typeof reason)}><option value="added_in_error">Prescription added in error</option><option value="patient_request">Patient requested cancellation</option><option value="other">Other</option></select></label>
        <label><span>Cancellation note</span><textarea className="input" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Briefly explain what was added incorrectly" /></label>
      </div>
      <footer><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onRequest}><XCircle size={13} /> {busy ? 'Recording…' : hasCuraleafOrder ? 'Open cancellation workflow' : 'Cancel order'}</button></footer>
    </section>
  );

  if (!order.cancellation) return null;
  if (supplier?.status === 'contact_required') return (
    <section className="order-cancellation-card order-cancellation-card--supplier">
      <header><span><small>Step 1 of 2 · Supplier cancellation</small><strong>Call Curaleaf Customer Service</strong></span><span className="pill pill-red">Refund locked</span></header>
      <div className="order-cancellation-instruction"><PhoneCall size={18} /><span><strong>Ask Curaleaf to cancel this prescription order</strong><small>Use the pharmacy’s Curaleaf support route. Do not refund the patient or create a replacement until Curaleaf confirms cancellation.</small></span></div>
      <dl className="order-cancellation-refs"><div><dt>Purchase order</dt><dd><code>{supplier.purchaseOrderId ?? order.prescriptions.find(prescription => prescription.poRef)?.poRef ?? 'Not returned'}</code></dd></div><div><dt>Prescription</dt><dd><code>{supplier.prescriptionId ?? order.prescriptions.find(prescription => prescription.curaleafPrescriptionId)?.curaleafPrescriptionId ?? 'Not returned'}</code></dd></div></dl>
      <div className="order-cancellation-fields"><label><span>Curaleaf contact / case reference</span><input className="input" value={reference} onChange={event => onReferenceChange(event.target.value)} placeholder="Case, call or agent reference" /></label><label><span>Contact note</span><textarea className="input" value={contactNote} onChange={event => onContactNoteChange(event.target.value)} placeholder="Who was contacted and what they advised" /></label></div>
      <footer><button type="button" className="btn btn-primary btn-sm" disabled={busy || reference.trim().length < 3} onClick={onRecordContact}><PhoneCall size={13} /> {busy ? 'Saving…' : 'Record Curaleaf contacted'}</button></footer>
    </section>
  );

  if (supplier?.status === 'awaiting_confirmation') return (
    <section className="order-cancellation-card order-cancellation-card--waiting">
      <header><span><small>Step 2 of 2 · Supplier confirmation</small><strong>Waiting for Curaleaf to confirm cancellation</strong></span><span className="pill pill-amber">Refund locked</span></header>
      <div className="order-cancellation-warning"><Clock3 size={16} /><span><strong>Curaleaf contact recorded</strong><small>Contact reference {supplier.contactReference ?? 'recorded'}. Only confirm below once Curaleaf has explicitly cancelled the order.</small></span></div>
      <div className="order-cancellation-fields"><label><span>Curaleaf cancellation confirmation</span><input className="input" value={reference} onChange={event => onReferenceChange(event.target.value)} placeholder="Cancellation / confirmation reference" /></label></div>
      <footer><button type="button" className="btn btn-primary btn-sm" disabled={busy || reference.trim().length < 3} onClick={onConfirm}><CheckCircle2 size={13} /> {busy ? 'Confirming…' : 'Confirm Curaleaf cancelled'}</button></footer>
    </section>
  );

  if (supplier?.status === 'confirmed') return (
    <section className="order-cancellation-card order-cancellation-card--confirmed"><CheckCircle2 size={18} /><span><strong>Curaleaf cancellation confirmed</strong><small>Confirmation {supplier.confirmationReference ?? 'recorded'}. {order.payment.status === 'paid' ? 'The pharmacy refund action is now unlocked.' : 'No settled payment requires refunding.'}</small></span></section>
  );

  return (
    <section className={`order-cancellation-card ${order.cancellation.status === 'refund_required' ? 'order-cancellation-card--supplier' : 'order-cancellation-card--confirmed'}`}>
      {order.cancellation.status === 'refund_required' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span><strong>{order.cancellation.status === 'refund_required' ? 'Paid cancellation requires pharmacy action' : 'Order cancelled'}</strong><small>{order.cancellation.status === 'refund_required' ? `Refund the patient using payment ID ${order.cancellation.paymentReference ?? order.payment.ref ?? 'shown below'}.` : order.cancellation.paymentLinkStatus === 'cancelled_in_platform' ? 'The HHH payment request has been retired. Any late Worldpay payment will be flagged for refund.' : 'Cancellation is retained in the audit history.'}</small></span>
    </section>
  );
}

function PaidExceptionResolution({ order, canReplace, lockedByCuraleaf, busy, refundReference, onRefundReferenceChange, onReplace, onRequestRefund, onConfirmRefund }: {
  order: PatientOrder;
  canReplace: boolean;
  lockedByCuraleaf: boolean;
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
      {lockedByCuraleaf ? (
        <div className="order-resolution__locked"><ShieldAlert size={16} /><span><strong>Refund and replacement locked</strong><small>Record Curaleaf contact and cancellation confirmation above before continuing.</small></span></div>
      ) : !order.refund ? (
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

function JourneyRail({ stage, paymentPaid }: { stage: OrderStage; paymentPaid: boolean }) {
  if (stage === 'cancelled') {
    const phases = [
      { label: 'Payment', detail: paymentPaid ? 'Cleared' : 'Cancelled', complete: paymentPaid },
      { label: 'Curaleaf', detail: 'Cancelled', complete: true },
      { label: 'Delivery', detail: 'Stopped', complete: false },
      { label: 'Ready to collect', detail: 'Not required', complete: false },
    ];
    return <ol className="order-journey-rail">{phases.map((phase, index) => <li key={phase.label} className={phase.complete ? 'complete' : ''}><span>{phase.complete ? <Check size={12} /> : index + 1}</span><div><strong>{phase.label}</strong><small>{phase.detail}</small></div></li>)}</ol>;
  }
  const curaleafComplete = ['curaleaf-approved', 'dispatched', 'delivered', 'ready', 'collected'].includes(stage);
  const deliveryComplete = ['delivered', 'ready', 'collected'].includes(stage);
  const collectionComplete = stage === 'collected';
  const phases = [
    { label: 'Payment', detail: paymentPaid ? 'Cleared' : 'Awaiting', complete: paymentPaid, active: stage === 'awaiting-payment' },
    { label: 'Curaleaf', detail: curaleafComplete ? 'Approved' : stage === 'curaleaf-pending' ? 'In review' : 'Pending', complete: curaleafComplete, active: stage === 'paid' || stage === 'curaleaf-pending' },
    { label: 'Delivery', detail: deliveryComplete ? 'Received' : stage === 'dispatched' ? 'In transit' : 'Pending', complete: deliveryComplete, active: stage === 'curaleaf-approved' || stage === 'dispatched' },
    { label: 'Ready to collect', detail: collectionComplete ? 'Handed out' : stage === 'ready' ? 'Ready' : 'Pending', complete: collectionComplete, active: stage === 'delivered' || stage === 'ready' },
  ];
  return <ol className="order-journey-rail">{phases.map((phase, index) => <li key={phase.label} className={phase.complete ? 'complete' : phase.active ? 'active' : ''}><span>{phase.complete ? <Check size={12} /> : index + 1}</span><div><strong>{phase.label}</strong><small>{phase.detail}</small></div></li>)}</ol>;
}

function PrescriptionCard({ prescription, index, receiptDraft, busy, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection, onRecordRejection, onManualPlace }: {
  prescription: Prescription;
  index: number;
  receiptDraft: GoodsReceiptDraft;
  busy: boolean;
  onReceiptDraftChange: (patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: (shipmentId?: string) => void;
  onConfirmDelivery: (shipmentId?: string) => void;
  onReadyForCollection: (shipmentId?: string) => void;
  onRecordRejection: () => void;
  onManualPlace: () => void;
}) {
  const shipmentIds = useMemo(() => prescription.shipmentIds?.length ? prescription.shipmentIds : prescription.shipmentId ? [prescription.shipmentId] : [], [prescription.shipmentId, prescription.shipmentIds]);
  const [selectedShipmentId, setSelectedShipmentId] = useState(shipmentIds.find(id => prescription.shipmentStates?.[id] !== 'collected') ?? shipmentIds[0] ?? '');
  useEffect(() => {
    if (!selectedShipmentId || !shipmentIds.includes(selectedShipmentId)) setSelectedShipmentId(shipmentIds.find(id => prescription.shipmentStates?.[id] !== 'collected') ?? shipmentIds[0] ?? '');
  }, [prescription.shipmentStates, selectedShipmentId, shipmentIds]);
  const selectedShipmentState = selectedShipmentId ? prescription.shipmentStates?.[selectedShipmentId] : undefined;
  const statusLabel = ({ draft: 'Draft', 'awaiting-approval': 'Curaleaf review', processing: 'Processing', approved: 'Approved', dispatched: prescription.dispatchStatus === 'partial' ? 'Partially dispatched' : 'Dispatched', 'partially-received': 'Part delivered', received: 'Delivered', ready: 'Ready to collect', collected: 'Collected', cancelled: 'Cancelled purchase order' } as const)[prescription.status];
  const receiving = ['partially_dispatched_to_pharmacy', 'dispatched_to_pharmacy', 'partially_received'].includes(selectedShipmentState ?? '') || !selectedShipmentState && (shipmentIds.length > 1 || prescription.status === 'dispatched' || prescription.status === 'partially-received');
  const readyControl = selectedShipmentState === 'received' || !selectedShipmentState && prescription.status === 'received';
  const collectionControl = selectedShipmentState === 'ready_for_collection' || !selectedShipmentState && prescription.status === 'ready';
  const deliveryGuidance = prescription.placedAt ? curaleafDeliveryGuidance(prescription.placedAt) : null;
  return (
    <article className="order-rx-card">
      <header><span><small>Prescription {index + 1}</small><strong>{prescription.prescriber || 'Prescriber pending'}</strong></span><span className={`rx-status-chip rx-status-chip--${prescription.status}`}>{statusLabel}</span>{prescription.placed && prescription.status !== 'collected' ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onRecordRejection}>Record Curaleaf rejection</button> : null}</header>
      <div className="order-rx-card__refs"><span>PO reference <strong>{prescription.poRef ?? 'Pending'}</strong></span><span>Serial <strong>{prescription.serialNumber ?? 'Not recorded'}</strong></span><span>Value <strong>{money(rxRevenue(prescription))}</strong></span></div>
      {prescription.manualPlaceRequired ? <div className="order-ready-control"><span><Clock3 size={16} /><span><strong>Manual placement required</strong><small>Automatic placement is disabled for this pharmacy. The final quote will be rechecked when you continue.</small></span></span><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onManualPlace}>{busy ? 'Placing…' : 'Place prescription'}</button></div> : null}
      {shipmentIds.length ? <label className="order-shipment-selector"><span>Shipment</span><select className="input select" value={selectedShipmentId} onChange={event => setSelectedShipmentId(event.target.value)}>{shipmentIds.map((id, shipmentIndex) => <option key={id} value={id}>Shipment {shipmentIndex + 1} · {prescription.shipmentStates?.[id]?.replaceAll('_', ' ') ?? 'supplier synced'}</option>)}</select></label> : null}
      <div className="order-rx-lines">{prescription.items.map(item => <div key={item.productId}><span><strong>{item.name}</strong><small>{item.qty} pack{item.qty === 1 ? '' : 's'}</small></span></div>)}</div>
      {prescription.purchaseOrderState === 'CANCELLED' ? <div className="order-cancellation-warning"><XCircle size={16} /><span><strong>Cancelled purchase order</strong><small>Curaleaf cancelled this PO. Review the pharmacy’s Curaleaf call or case reference for the reason before refunding or replacing it.</small></span></div> : null}
      {prescription.fulfilmentLines?.length ? (
        <div className="order-supplier-fulfilment">
          <header className="order-supplier-fulfilment__header">
            <div>
              <small>Curaleaf Live Allocation & Progress</small>
              <strong>
                {prescription.dispatchStatus === 'complete'
                  ? 'Fulfilled by Curaleaf — Checked In'
                  : prescription.dispatchStatus === 'partial'
                    ? 'Partial Dispatch — Remainder Awaiting Dispatch'
                    : prescription.purchaseOrderState === 'FULLY_ALLOCATED'
                      ? 'Fully Allocated in Curaleaf Cleanroom'
                      : prescription.purchaseOrderState === 'PROCESSING'
                        ? 'Picking in Curaleaf Cleanroom'
                        : 'Curaleaf Purchase Order Active'}
              </strong>
            </div>
            {deliveryGuidance ? (
              <span className="order-delivery-estimate-badge">
                <Truck size={12} /> {deliveryRange(deliveryGuidance)}
              </span>
            ) : null}
          </header>
          <div className="order-supplier-fulfilment__body">
            {prescription.fulfilmentLines.map(line => {
              const product = prescription.items.find(item => item.productId === line.productId);
              const orderedPacks = line.requested || line.ordered;
              const allocatedPacks = line.allocated;
              const awaitingPacks = line.remaining;
              const receivedPacks = line.received;
              const percentReceived = orderedPacks > 0 ? Math.min(100, Math.round((receivedPacks / orderedPacks) * 100)) : 0;
              const percentAllocated = orderedPacks > 0 ? Math.min(100, Math.round((allocatedPacks / orderedPacks) * 100)) : 0;

              return (
                <div key={line.productId} className={`order-fulfilment-row ${line.quantityMismatch ? 'has-mismatch' : ''}`}>
                  <div className="order-fulfilment-row__header">
                    <div>
                      <strong>{product?.name ?? line.productId}</strong>
                      {line.quantityMismatch ? (
                        <span className="mismatch-tag">
                          PO reports {line.supplierReportedOrdered} pack{line.supplierReportedOrdered === 1 ? '' : 's'} (Mismatch)
                        </span>
                      ) : (
                        <small>Live Curaleaf Lab Allocation</small>
                      )}
                    </div>
                  </div>
                  <div className="order-fulfilment-metrics">
                    <div className="metric-box">
                      <span className="metric-label">Ordered</span>
                      <span className="metric-value">{orderedPacks}</span>
                    </div>
                    <div className="metric-box metric-box--allocated">
                      <span className="metric-label">Curaleaf Picked</span>
                      <span className="metric-value">{allocatedPacks}</span>
                    </div>
                    <div className="metric-box metric-box--awaiting">
                      <span className="metric-label">Awaiting Dispatch</span>
                      <span className="metric-value">{awaitingPacks}</span>
                    </div>
                    <div className="metric-box metric-box--received">
                      <span className="metric-label">Checked In</span>
                      <span className="metric-value">{receivedPacks}</span>
                    </div>
                  </div>
                  <div className="order-fulfilment-bar">
                    <div className="order-fulfilment-bar__fill--allocated" style={{ width: `${percentAllocated}%` }} />
                    <div className="order-fulfilment-bar__fill--received" style={{ width: `${percentReceived}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {receiving ? (
        <div className="order-goods-in">
          <header><span><small>Pharmacy delivery check</small><strong>{prescription.status === 'partially-received' ? 'Update the partial receipt' : 'Confirm what arrived from Curaleaf'}</strong></span><PackageCheck size={15} /></header>
          <div className="order-goods-in__lines">
            {prescription.items.map(item => (
              <label key={item.productId}>
                <span><strong>{item.name}</strong><small>Ordered: {item.qty} pack{item.qty === 1 ? '' : 's'}</small></span>
                <span className="order-goods-in__quantity"><input type="number" min="0" max={item.qty} step="1" value={receiptDraft.quantities[item.productId] ?? 0} onChange={event => onReceiptDraftChange({ quantities: { ...receiptDraft.quantities, [item.productId]: Math.max(0, Math.min(item.qty, Math.floor(Number(event.target.value) || 0))) } })} aria-label={`${item.name} packs received`} /><small>received</small></span>
                <span className="order-goods-in__batch"><input type="text" maxLength={100} value={receiptDraft.batches[item.productId] ?? ''} onChange={event => onReceiptDraftChange({ batches: { ...receiptDraft.batches, [item.productId]: event.target.value } })} placeholder="Batch number" aria-label={`${item.name} batch number`} /><input type="date" value={receiptDraft.expiries[item.productId] ?? ''} onChange={event => onReceiptDraftChange({ expiries: { ...receiptDraft.expiries, [item.productId]: event.target.value } })} aria-label={`${item.name} batch expiry`} /></span>
              </label>
            ))}
          </div>
          <label className="order-goods-in__note"><span>Delivery note <small>(optional)</small></span><textarea className="input" value={receiptDraft.note} onChange={event => onReceiptDraftChange({ note: event.target.value })} placeholder="Short, damaged or missing packs" /></label>
          <div className="order-goods-in__actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onSavePartial(selectedShipmentId || undefined)}><Package size={13} /> Save partial delivery</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onConfirmDelivery(selectedShipmentId || undefined)}><PackageCheck size={13} /> {busy ? 'Saving delivery…' : 'Confirm complete delivery'}</button>
          </div>
        </div>
      ) : null}
      {readyControl ? (
        <div className="order-ready-control">
          <span><CheckCircle2 size={16} /><span><strong>Complete delivery recorded</strong><small>Ready-to-collect remains manual. Confirm only after the pharmacy’s dispensing checks.</small></span></span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onReadyForCollection(selectedShipmentId || undefined)}><Mail size={13} /> {busy ? 'Queuing email…' : 'Mark ready & email customer'}</button>
        </div>
      ) : null}
      {collectionControl ? <div className="order-ready-confirmed"><Mail size={14} /><span><strong>Customer collection email queued</strong><small>Ready to collect was confirmed for this shipment{prescription.readyAt ? ` on ${formatDate(prescription.readyAt, true)}` : ''}. Use the order-level Handout now action after giving all medication to the patient.</small></span></div> : null}
    </article>
  );
}

function OrderTimeline({ order }: { order: PatientOrder }) {
  const events: Array<{ label: string; detail: string; date: Date | string | null }> = [
    { label: 'Order created', detail: `${order.prescriptions.length} prescription${order.prescriptions.length === 1 ? '' : 's'} prepared`, date: order.date },
  ];
  if (order.payment.sentAt) events.push({ label: 'Payment requested', detail: order.payment.route === 'worldpay' ? 'Worldpay payment link created' : 'Pharmacy payment selected', date: order.payment.sentAt });
  if (order.payment.paidAt) events.push({ label: 'Payment cleared', detail: `${money(order.payment.amount)} received`, date: order.payment.paidAt });
  if (order.curaleafApprovedAt) events.push({ label: 'Curaleaf approved', detail: 'Delivery service window started', date: order.curaleafApprovedAt });
  if (order.cancellation) events.push({ label: 'Cancellation requested', detail: order.curaleafCancellation ? 'Curaleaf cancellation workflow opened' : 'Order cancellation recorded', date: order.cancellation.requestedAt });
  if (order.curaleafCancellation?.contactedAt) events.push({ label: 'Curaleaf contacted', detail: `Reference ${order.curaleafCancellation.contactReference ?? 'recorded'}`, date: order.curaleafCancellation.contactedAt });
  if (order.curaleafCancellation?.confirmedAt) events.push({ label: 'Curaleaf cancellation confirmed', detail: `Confirmation ${order.curaleafCancellation.confirmationReference ?? 'recorded'}`, date: order.curaleafCancellation.confirmedAt });
  order.prescriptions.forEach((prescription, index) => {
    if (prescription.placed) events.push({ label: `Rx ${index + 1} sent to Curaleaf`, detail: prescription.poRef ? `PO ${prescription.poRef}` : 'Awaiting supplier reference', date: order.payment.paidAt ?? order.date });
    if (prescription.goodsInAt) events.push({ label: `Rx ${index + 1} delivered`, detail: prescription.goodsInBy ? `Received by ${prescription.goodsInBy}` : 'Received by pharmacy', date: prescription.goodsInAt });
    if (prescription.readyAt) events.push({ label: `Rx ${index + 1} ready to collect`, detail: 'Collection notification queued', date: prescription.readyAt });
  });
  return <section className="order-crm-activity"><div className="order-crm-section-heading"><span><small>Activity</small><strong>Order timeline</strong></span><Clock3 size={15} /></div><ol className="order-crm-timeline">{events.sort((left, right) => new Date(right.date ?? 0).getTime() - new Date(left.date ?? 0).getTime()).map((event, index) => <li key={`${event.label}-${index}`}><span /><div><strong>{event.label}</strong><small>{event.detail}</small><time>{formatDate(event.date, true)}</time></div></li>)}</ol></section>;
}
