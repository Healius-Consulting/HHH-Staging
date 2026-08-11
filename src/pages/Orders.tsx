import { useEffect, useMemo, useState } from 'react';
import { curaleafDeliveryExpectation, curaleafDeliveryWindowState } from '@hhh/domain/delivery';
import {
  AlertTriangle,
  Archive,
  Banknote,
  Check,
  CheckCircle2,
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
  Send,
  ShieldAlert,
  Truck,
  UserRound,
  XCircle,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';
import {
  getUnresolvedReason,
  lineRevenue,
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
import { confirmPortalOrderRefund, createPortalOrderRefund, recordPortalCuraleafCancellation, recordPortalGoodsReceipt, recordPortalManualPayment, requestPortalOrderCancellation, submitCuraleafClinicPrescription, submitCuraleafManualPrescription, updatePortalShipmentStatus } from '../shared/api';
import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';

type OrderStage =
  | 'awaiting-payment'
  | 'paid'
  | 'curaleaf-pending'
  | 'curaleaf-approved'
  | 'dispatched'
  | 'delivered'
  | 'ready'
  | 'collected'
  | 'rejected'
  | 'archived'
  | 'cancelled';

type StageFilter = 'all' | 'awaiting-payment' | 'paid' | 'curaleaf' | 'delivery' | 'ready' | 'rejected' | 'archived' | 'cancelled' | 'completed';
type ManualPaymentForm = { tender: ManualTender; reference: string; notes: string; confirmed: boolean };
type GoodsReceiptDraft = { quantities: Record<string, number>; note: string };

interface OrderRecord {
  order: PatientOrder;
  patient: CRMPatient | null;
  stage: OrderStage;
  unresolvedReason: ReturnType<typeof getUnresolvedReason>;
}

const DEFAULT_MANUAL_FORM: ManualPaymentForm = { tender: 'epos-card', reference: '', notes: '', confirmed: false };

const STAGE_META: Record<OrderStage, { label: string; description: string; tone: string; icon: LucideIcon }> = {
  'awaiting-payment': { label: 'Awaiting payment', description: 'Payment request sent to patient', tone: 'warning', icon: Clock3 },
  paid: { label: 'Paid', description: 'Cleared and ready for Curaleaf', tone: 'success', icon: CreditCard },
  'curaleaf-pending': { label: 'With Curaleaf', description: 'Awaiting supplier decision', tone: 'info', icon: CircleDot },
  'curaleaf-approved': { label: 'Curaleaf approved', description: 'Supplier accepted the prescription', tone: 'success', icon: CheckCircle2 },
  dispatched: { label: 'In delivery', description: 'Dispatched to the pharmacy', tone: 'info', icon: Truck },
  delivered: { label: 'Delivered', description: 'Received by the pharmacy', tone: 'success', icon: PackageCheck },
  ready: { label: 'Ready to collect', description: 'Patient can collect from pharmacy', tone: 'success', icon: Package },
  collected: { label: 'Collected', description: 'Medication handed to patient', tone: 'neutral', icon: Check },
  rejected: { label: 'Rejected', description: 'Order needs review or recreation', tone: 'danger', icon: XCircle },
  archived: { label: 'Archived', description: 'Prescription cycle expired', tone: 'neutral', icon: Archive },
  cancelled: { label: 'Cancelled', description: 'Cancellation retained for audit', tone: 'neutral', icon: XCircle },
};

const FILTERS: Array<{ key: StageFilter; label: string }> = [
  { key: 'all', label: 'All orders' },
  { key: 'awaiting-payment', label: 'Awaiting payment' },
  { key: 'paid', label: 'Paid' },
  { key: 'curaleaf', label: 'Curaleaf' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'ready', label: 'RTC' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'completed', label: 'Completed' },
];

function orderStage(order: PatientOrder, now = new Date()): { stage: OrderStage; unresolvedReason: ReturnType<typeof getUnresolvedReason> } {
  const unresolvedReason = getUnresolvedReason(order, now);
  if (order.lifecycleStatus === 'cancelled') return { stage: 'cancelled', unresolvedReason };
  if (unresolvedReason === 'expired' || order.unresolvedReason === 'expired' || order.lifecycleStatus === 'archived' || order.isExpired) return { stage: 'archived', unresolvedReason };
  if (unresolvedReason === 'rejected' || order.unresolvedReason === 'rejected' || order.quoteReview) return { stage: 'rejected', unresolvedReason };
  if (order.payment.status === 'sent') return { stage: 'awaiting-payment', unresolvedReason };

  const statuses = order.prescriptions.map(prescription => prescription.status);
  if (statuses.length && statuses.every(status => status === 'collected')) return { stage: 'collected', unresolvedReason };
  if (statuses.some(status => status === 'ready')) return { stage: 'ready', unresolvedReason };
  if (statuses.some(status => status === 'received' || status === 'partially-received')) return { stage: 'delivered', unresolvedReason };
  if (statuses.some(status => status === 'dispatched')) return { stage: 'dispatched', unresolvedReason };
  if (statuses.length && statuses.every(status => ['approved', 'dispatched', 'partially-received', 'received', 'ready', 'collected'].includes(status))) {
    return { stage: 'curaleaf-approved', unresolvedReason };
  }
  if (order.prescriptions.some(prescription => prescription.placed || prescription.status === 'awaiting-approval')) {
    return { stage: 'curaleaf-pending', unresolvedReason };
  }
  return { stage: 'paid', unresolvedReason };
}

function stageMatchesFilter(stage: OrderStage, filter: StageFilter) {
  if (filter === 'all') return true;
  if (filter === 'curaleaf') return stage === 'curaleaf-pending' || stage === 'curaleaf-approved';
  if (filter === 'delivery') return stage === 'dispatched' || stage === 'delivered';
  if (filter === 'completed') return stage === 'collected';
  return stage === filter;
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
  const [activeFilter, setActiveFilter] = useState<StageFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [manualForms, setManualForms] = useState<Record<number, ManualPaymentForm>>({});
  const [submittingOrderId, setSubmittingOrderId] = useState<number | null>(null);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<number, GoodsReceiptDraft>>({});
  const [fulfilmentBusyRxId, setFulfilmentBusyRxId] = useState<number | null>(null);
  const [refundBusyOrderId, setRefundBusyOrderId] = useState<number | null>(null);
  const [refundReferences, setRefundReferences] = useState<Record<number, string>>({});
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<'added_in_error' | 'patient_request' | 'other'>('added_in_error');
  const [cancelNote, setCancelNote] = useState('');
  const [cancellationReference, setCancellationReference] = useState('');
  const [cancellationContactNote, setCancellationContactNote] = useState('');
  const [cancellationBusyOrderId, setCancellationBusyOrderId] = useState<number | null>(null);

  const records = useMemo<OrderRecord[]>(() => state.orders
    .filter(order => order.organisationId === state.currentOrganisationId && order.payment.status !== 'none')
    .map(order => {
      const patient = order.patientId
        ? state.crm.find(candidate => candidate.organisationId === state.currentOrganisationId && candidate.id === order.patientId) ?? null
        : null;
      const resolvedStage = orderStage(order);
      return { order, patient, ...resolvedStage };
    })
    .sort((left, right) => right.order.date.getTime() - left.order.date.getTime()), [state.crm, state.currentOrganisationId, state.orders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter(record => {
      if (!stageMatchesFilter(record.stage, activeFilter)) return false;
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
    if (records.some(record => record.order.id === orderId)) {
      setActiveFilter('all');
      setQuery('');
      setSelectedOrderId(orderId);
    }
    dispatch({ type: 'CLEAR_NAVIGATION_TARGET' });
  }, [dispatch, records, state.navigationTarget]);

  const selected = filtered.find(record => record.order.id === selectedOrderId) ?? filtered[0] ?? null;
  const outstandingValue = records.filter(record => record.stage === 'awaiting-payment').reduce((sum, record) => sum + record.order.payment.amount, 0);
  const needsAction = records.filter(record => ['awaiting-payment', 'paid', 'rejected', 'delivered'].includes(record.stage) || (
    record.stage === 'cancelled' && record.order.refund?.status !== 'completed' && record.order.cancellation?.status === 'refund_required'
  ) || ['contact_required', 'awaiting_confirmation'].includes(record.order.curaleafCancellation?.status ?? '')).length;
  const readyCount = records.filter(record => record.stage === 'ready').length;
  const activeCount = records.filter(record => !['collected', 'archived', 'rejected', 'cancelled'].includes(record.stage)).length;

  const filterCount = (filter: StageFilter) => records.filter(record => stageMatchesFilter(record.stage, filter)).length;

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
    note: prescription.goodsInNote ?? '',
  };
  const updateReceiptDraft = (prescription: Prescription, patch: Partial<GoodsReceiptDraft>) => setReceiptDrafts(current => ({
    ...current,
    [prescription.id]: { ...receiptDraftFor(prescription), ...current[prescription.id], ...patch },
  }));

  const submitLiveOrder = async (order: PatientOrder) => {
    if (!order.backendId) throw new Error('This order has not been saved to the HHH backend.');
    let pendingAcceptance = 0;
    for (const prescription of order.prescriptions.filter(candidate => !candidate.placed)) {
      if (!prescription.fileId || !prescription.issueDate) throw new Error(`Rx ${prescription.id} does not have a complete prescription record.`);
      if (prescription.items.some(item => !item.formulaId || !item.unitsNeededCount)) throw new Error(`Rx ${prescription.id} has a product without a formula ID or prescribed-unit count.`);
      const result = prescription.entryMode === 'manual'
        ? await submitCuraleafManualPrescription({
            organisationId: state.currentOrganisationId,
            orderId: order.backendId,
            subOrderId: String(prescription.id),
            fileId: prescription.fileId,
            serialNumber: prescription.serialNumber || '',
            issueDate: prescription.issueDate,
            prescriber: {
              pin: prescription.prescriberPin?.trim() ?? '',
              gmcNumber: prescription.prescriberGmcNumber?.trim() ? Number(prescription.prescriberGmcNumber) : null,
              gphcNumber: prescription.prescriberGphcNumber?.trim() || null,
              name: prescription.prescriber,
              initials: prescription.prescriber.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 20),
            },
            items: prescription.items.map(item => ({
              formulaId: item.formulaId!,
              unitsNeededCount: item.unitsNeededCount!,
              packId: item.productId,
              quantity: item.qty,
            })),
          })
        : await submitCuraleafClinicPrescription({
            organisationId: state.currentOrganisationId,
            orderId: order.backendId,
            subOrderId: String(prescription.id),
            fileId: prescription.fileId,
            serialNumber: prescription.serialNumber || '',
          });
      if (result.status !== 'purchase_order_submitted') pendingAcceptance += 1;
      dispatch({ type: 'CONFIRM_CURALEAF_SUBMISSION', orderId: order.id, rxId: prescription.id, customerReference: result.customerReference });
    }
    return pendingAcceptance;
  };

  const handlePlaceOrder = async (order: PatientOrder) => {
    setSubmittingOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        const pendingAcceptance = await submitLiveOrder(order);
        dispatch({ type: 'ADD_TOAST', message: pendingAcceptance ? `${pendingAcceptance} prescription${pendingAcceptance === 1 ? ' is' : 's are'} awaiting Curaleaf review.` : 'Curaleaf purchase orders submitted.', toastType: 'success' });
      } else {
        dispatch({ type: 'PLACE_ORDER', orderId: order.id });
        dispatch({ type: 'ADD_TOAST', message: 'Training Curaleaf submission simulated locally. Nothing was sent.', toastType: 'info' });
      }
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Curaleaf submission failed.', toastType: 'error' });
    } finally {
      setSubmittingOrderId(null);
    }
  };

  const handleRecordManualPayment = async (order: PatientOrder) => {
    const form = manualForms[order.id] ?? DEFAULT_MANUAL_FORM;
    if (!form.confirmed) return;
    setSubmittingOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!order.backendId) throw new Error('This order has not been saved to the HHH backend.');
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
        dispatch({ type: 'ADD_TOAST', message: 'Payment recorded. The order is ready to send to Curaleaf.', toastType: 'success' });
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

  const handleGoodsReceipt = async (order: PatientOrder, prescription: Prescription, complete: boolean) => {
    const draft = receiptDraftFor(prescription);
    const lines = prescription.items.map(item => ({
      productId: item.productId,
      quantityReceived: complete ? item.qty : Math.max(0, Math.min(item.qty, Math.floor(draft.quantities[item.productId] ?? 0))),
    }));
    const anyReceived = lines.some(line => line.quantityReceived > 0);
    const allReceived = prescription.items.length > 0 && prescription.items.every(item => lines.find(line => line.productId === item.productId)?.quantityReceived === item.qty);
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
        if (!prescription.shipmentId) throw new Error('The Curaleaf shipment reference is not linked yet. Sync shipments and try again.');
        await recordPortalGoodsReceipt(prescription.shipmentId, {
          organisationId: state.currentOrganisationId,
          items: prescription.items.map(item => ({
            productId: item.productId,
            expectedQuantity: item.qty,
            receivedQuantity: lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0,
            issue: complete ? 'none' : (lines.find(line => line.productId === item.productId)?.quantityReceived ?? 0) < item.qty ? 'short' : 'none',
            notes: draft.note.trim() || undefined,
          })),
        });
      }
      dispatch({ type: 'RECORD_GOODS_RECEIPT', orderId: order.id, rxId: prescription.id, lines, note: draft.note });
      setReceiptDrafts(current => ({ ...current, [prescription.id]: { quantities: Object.fromEntries(lines.map(line => [line.productId, line.quantityReceived])), note: draft.note } }));
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The delivery receipt could not be saved.', toastType: 'error' });
    } finally {
      setFulfilmentBusyRxId(null);
    }
  };

  const handleReadyForCollection = async (order: PatientOrder, prescription: Prescription) => {
    setFulfilmentBusyRxId(prescription.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!prescription.shipmentId) throw new Error('The Curaleaf shipment reference is not linked yet. Sync shipments and try again.');
        await updatePortalShipmentStatus(prescription.shipmentId, { organisationId: state.currentOrganisationId, status: 'ready_for_collection' });
      }
      dispatch({ type: 'MARK_READY_FOR_COLLECTION', orderId: order.id, rxId: prescription.id });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Ready-to-collect could not be confirmed.', toastType: 'error' });
    } finally {
      setFulfilmentBusyRxId(null);
    }
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
          {FILTERS.map(filter => (
            <button type="button" key={filter.key} className={activeFilter === filter.key ? 'active' : ''} aria-pressed={activeFilter === filter.key} onClick={() => setActiveFilter(filter.key)}>
              <span>{filter.label}</span><strong>{filterCount(filter.key)}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="order-crm-workspace">
        <aside className="order-crm-list" aria-label="Customer orders">
          <header><span><small>Customer orders</small><strong>{filtered.length} result{filtered.length === 1 ? '' : 's'}</strong></span><span>Newest first</span></header>
          <div className="order-crm-list__rows">
            {filtered.length ? filtered.map(record => (
              <OrderListRow key={record.order.id} record={record} selected={selected?.order.id === record.order.id} onSelect={() => setSelectedOrderId(record.order.id)} />
            )) : <div className="order-crm-empty"><Package size={26} /><strong>No orders in this stage</strong><span>Try another filter or search term.</span></div>}
          </div>
        </aside>

        <main className="order-crm-detail">
          {selected ? (
            <OrderDetail
              record={selected}
              manualForm={manualForms[selected.order.id] ?? DEFAULT_MANUAL_FORM}
              onManualFormChange={patch => updateManualForm(selected.order.id, patch)}
              onRecordManual={() => void handleRecordManualPayment(selected.order)}
              onSendCuraleaf={() => void handlePlaceOrder(selected.order)}
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
              onSavePartial={(prescription) => void handleGoodsReceipt(selected.order, prescription, false)}
              onConfirmDelivery={(prescription) => void handleGoodsReceipt(selected.order, prescription, true)}
              onReadyForCollection={(prescription) => void handleReadyForCollection(selected.order, prescription)}
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
    </div>
  );
}

function SummaryMetric({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: LucideIcon; tone: string }) {
  return <article className={`order-crm-metric order-crm-metric--${tone}`}><span className="order-crm-metric__icon"><Icon size={16} /></span><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></article>;
}

function OrderListRow({ record, selected, onSelect }: { record: OrderRecord; selected: boolean; onSelect: () => void }) {
  const meta = STAGE_META[record.stage];
  const Icon = meta.icon;
  const patientName = record.patient?.name ?? 'Unknown patient';
  return (
    <button type="button" className={`order-crm-row${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className={`order-crm-row__stage order-tone--${meta.tone}`}><Icon size={15} /></span>
      <span className="order-crm-row__identity"><strong title={patientName}>{compactPatientName(patientName)}</strong><small>{record.order.redoContext ? 'Replacement' : 'Order'} {orderReference(record.order)} · {record.order.prescriptions.length} Rx</small></span>
      <span className="order-crm-row__position"><strong>{money(record.order.payment.amount)}</strong><small>{formatDate(record.order.date)}</small></span>
      <span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span>
    </button>
  );
}

function OrderDetail({ record, manualForm, onManualFormChange, onRecordManual, onSendCuraleaf, onRedo, onPrint, busy, receiptDrafts, fulfilmentBusyRxId, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection, refundReference, onRefundReferenceChange, onRequestRefund, onConfirmRefund, refundBusy, cancellationEditorOpen, cancellationReason, cancellationNote, cancellationReference, cancellationContactNote, cancellationBusy, onOpenCancellation, onCloseCancellation, onCancellationReasonChange, onCancellationNoteChange, onCancellationReferenceChange, onCancellationContactNoteChange, onRequestCancellation, onRecordCuraleafContact, onConfirmCuraleafCancellation }: {
  record: OrderRecord;
  manualForm: ManualPaymentForm;
  onManualFormChange: (patch: Partial<ManualPaymentForm>) => void;
  onRecordManual: () => void;
  onSendCuraleaf: () => void;
  onRedo: () => void;
  onPrint: () => void;
  busy: boolean;
  receiptDrafts: Record<number, GoodsReceiptDraft>;
  fulfilmentBusyRxId: number | null;
  onReceiptDraftChange: (prescription: Prescription, patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: (prescription: Prescription) => void;
  onConfirmDelivery: (prescription: Prescription) => void;
  onReadyForCollection: (prescription: Prescription) => void;
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
  const { order, patient, stage } = record;
  const meta = STAGE_META[stage];
  const Icon = meta.icon;
  const allPlaced = order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.placed);
  const canRedo = Boolean(record.unresolvedReason) && (stage === 'rejected' || stage === 'archived');
  const paymentFormVisible = stage === 'awaiting-payment' && order.payment.route === 'pharmacy';
  const curaleafCancellationLocked = Boolean(order.curaleafCancellation && order.curaleafCancellation.status !== 'confirmed');
  const mayCancel = !order.cancellation && !['collected', 'cancelled'].includes(stage);

  return (
    <article className="order-crm-record">
      <header className="order-crm-record__header">
        <div className="order-crm-record__identity">
          <span className={`order-crm-record__stage order-tone--${meta.tone}`}><Icon size={18} /></span>
          <span><small>{order.redoContext ? 'Replacement' : 'Order'} {orderReference(order)} · opened {formatDate(order.date)}{order.redoContext ? ` · replaces #${order.redoContext.originalOrderId}` : ''}</small><strong>{patient?.name ?? 'Unknown patient'}</strong><em>{meta.description}</em></span>
        </div>
        <div className="order-crm-record__value"><small>Patient total</small><strong>{money(order.payment.amount)}</strong><span className={`order-stage-pill order-tone--${meta.tone}`}>{meta.label}</span></div>
        <div className="order-crm-record__actions">
          {mayCancel ? <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenCancellation}><XCircle size={13} /> Cancel order</button> : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPrint}><Printer size={13} /> Print</button>
        </div>
      </header>

      <JourneyRail stage={stage} paymentPaid={order.payment.status === 'paid'} />

      {(cancellationEditorOpen || order.cancellation) ? (
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

      {(stage === 'curaleaf-approved' || stage === 'dispatched') ? <DeliveryExpectation order={order} /> : null}

      {(stage === 'rejected' || stage === 'archived') ? (
        <div className={`order-crm-alert order-crm-alert--${stage === 'rejected' ? 'danger' : 'neutral'}`}>
          {stage === 'rejected' ? <ShieldAlert size={17} /> : <Archive size={17} />}
          <span><strong>{stage === 'rejected' ? 'Curaleaf exception requires attention' : 'Prescription cycle archived'}</strong><small>{stage === 'rejected' ? 'Review the supplier response, then recreate the order against a valid prescription.' : 'This order passed its prescription-cycle deadline and is retained for the audit trail.'}</small></span>
        </div>
      ) : null}

      {(stage === 'rejected' || stage === 'archived') && order.payment.status === 'paid' ? (
        <PaidExceptionResolution order={order} canReplace={canRedo} lockedByCuraleaf={curaleafCancellationLocked} busy={refundBusy} refundReference={refundReference} onRefundReferenceChange={onRefundReferenceChange} onReplace={onRedo} onRequestRefund={onRequestRefund} onConfirmRefund={onConfirmRefund} />
      ) : null}

      {stage === 'cancelled' && order.payment.status === 'paid' && order.cancellation?.status === 'refund_required' ? (
        <PaidExceptionResolution order={order} canReplace={false} lockedByCuraleaf={curaleafCancellationLocked} busy={refundBusy} refundReference={refundReference} onRefundReferenceChange={onRefundReferenceChange} onReplace={onRedo} onRequestRefund={onRequestRefund} onConfirmRefund={onConfirmRefund} />
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
                quantities: Object.fromEntries(prescription.items.map(item => [item.productId, prescription.receivedItems?.find(received => received.productId === item.productId)?.quantityReceived ?? 0])),
                note: prescription.goodsInNote ?? '',
              }}
              busy={fulfilmentBusyRxId === prescription.id}
              onReceiptDraftChange={patch => onReceiptDraftChange(prescription, patch)}
              onSavePartial={() => onSavePartial(prescription)}
              onConfirmDelivery={() => onConfirmDelivery(prescription)}
              onReadyForCollection={() => onReadyForCollection(prescription)}
            />)}
          </div>

          {stage === 'paid' && !allPlaced ? (
            <div className="order-crm-next-action">
              <span><strong>Payment cleared</strong><small>This order is ready to move into the Curaleaf workflow.</small></span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onSendCuraleaf}><Send size={14} /> {busy ? 'Submitting…' : 'Send to Curaleaf'}</button>
            </div>
          ) : null}

          {stage === 'awaiting-payment' && order.payment.route === 'worldpay' ? (
            <div className="order-crm-next-action order-crm-next-action--waiting">
              <Clock3 size={16} /><span><strong>Waiting for verified Worldpay payment</strong><small>The order will move to Paid automatically after Worldpay submits it for settlement.</small></span>
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
              <div><dt>Route</dt><dd>{order.payment.route === 'worldpay' ? 'Worldpay HPP' : 'Pharmacy managed'}</dd></div>
              <div><dt>Requested</dt><dd>{formatDate(order.payment.sentAt, true)}</dd></div>
              <div><dt>Paid</dt><dd>{formatDate(order.payment.paidAt, true)}</dd></div>
              <div><dt>Reference</dt><dd>{order.payment.manualReference ?? order.payment.ref ?? 'Pending'}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </article>
  );
}

function DeliveryExpectation({ order }: { order: PatientOrder }) {
  const expectation = order.curaleafApprovedAt ? curaleafDeliveryExpectation(order.curaleafApprovedAt) : null;
  if (!expectation) {
    return (
      <div className="order-delivery-warning order-delivery-warning--missing">
        <AlertTriangle size={17} />
        <span><strong>Delivery estimate needs an approval timestamp</strong><small>The Curaleaf order is approved, but its approval time has not yet synced. Reconciliation will add the delivery window automatically.</small></span>
      </div>
    );
  }

  const state = curaleafDeliveryWindowState(expectation);
  const singleDay = expectation.windowStart === expectation.windowEnd;
  const windowLabel = singleDay
    ? formatDeliveryDate(expectation.windowStart)
    : `${formatDeliveryDate(expectation.windowStart)} – ${formatDeliveryDate(expectation.windowEnd)}`;
  const thursdayAfterCutoff = expectation.approvedWeekday === 'Thu' && !expectation.beforeCutoff;
  const heading = state === 'overdue'
    ? 'Curaleaf delivery needs follow-up'
    : singleDay ? `Delivery aim: ${windowLabel}` : `Delivery window: ${windowLabel}`;
  const serviceCopy = expectation.beforeCutoff
    ? 'Approved before 14:30, so Curaleaf aims to deliver on the next working day.'
    : thursdayAfterCutoff
      ? 'Approved after 14:30 on Thursday, so the next delivery is expected within 2–4 working days.'
      : 'Approved after the 14:30 cut-off, so delivery is expected within 2–4 working days.';

  return (
    <div className={`order-delivery-warning order-delivery-warning--${state}`}>
      {state === 'overdue' ? <AlertTriangle size={17} /> : <Truck size={17} />}
      <span>
        <strong>{heading}</strong>
        <small>{serviceCopy} Approval recorded {formatDate(order.curaleafApprovedAt, true)}. Working days exclude weekends; bank holidays may extend the estimate.</small>
      </span>
    </div>
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
      { label: 'Collection', detail: 'Not required', complete: false },
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
    { label: 'Collection', detail: collectionComplete ? 'Collected' : stage === 'ready' ? 'Ready' : 'Pending', complete: collectionComplete, active: stage === 'delivered' || stage === 'ready' },
  ];
  return <ol className="order-journey-rail">{phases.map((phase, index) => <li key={phase.label} className={phase.complete ? 'complete' : phase.active ? 'active' : ''}><span>{phase.complete ? <Check size={12} /> : index + 1}</span><div><strong>{phase.label}</strong><small>{phase.detail}</small></div></li>)}</ol>;
}

function PrescriptionCard({ prescription, index, receiptDraft, busy, onReceiptDraftChange, onSavePartial, onConfirmDelivery, onReadyForCollection }: {
  prescription: Prescription;
  index: number;
  receiptDraft: GoodsReceiptDraft;
  busy: boolean;
  onReceiptDraftChange: (patch: Partial<GoodsReceiptDraft>) => void;
  onSavePartial: () => void;
  onConfirmDelivery: () => void;
  onReadyForCollection: () => void;
}) {
  const statusLabel = ({ draft: 'Draft', 'awaiting-approval': 'Curaleaf review', approved: 'Approved', dispatched: 'Dispatched', 'partially-received': 'Part delivered', received: 'Delivered', ready: 'Ready to collect', collected: 'Collected' } as const)[prescription.status];
  const receiving = prescription.status === 'dispatched' || prescription.status === 'partially-received';
  return (
    <article className="order-rx-card">
      <header><span><small>Prescription {index + 1}</small><strong>{prescription.prescriber || 'Prescriber pending'}</strong></span><span className={`rx-status-chip rx-status-chip--${prescription.status}`}>{statusLabel}</span></header>
      <div className="order-rx-card__refs"><span>PO reference <strong>{prescription.poRef ?? 'Pending'}</strong></span><span>Serial <strong>{prescription.serialNumber ?? 'Not recorded'}</strong></span><span>Value <strong>{money(rxRevenue(prescription))}</strong></span></div>
      <div className="order-rx-lines">{prescription.items.map(item => <div key={item.productId}><span><strong>{item.name}</strong><small>{item.qty} pack{item.qty === 1 ? '' : 's'}</small></span><strong>{money(lineRevenue(item))}</strong></div>)}</div>
      {receiving ? (
        <div className="order-goods-in">
          <header><span><small>Pharmacy delivery check</small><strong>{prescription.status === 'partially-received' ? 'Update the partial receipt' : 'Confirm what arrived from Curaleaf'}</strong></span><PackageCheck size={15} /></header>
          <div className="order-goods-in__lines">
            {prescription.items.map(item => (
              <label key={item.productId}>
                <span><strong>{item.name}</strong><small>Ordered: {item.qty} pack{item.qty === 1 ? '' : 's'}</small></span>
                <span className="order-goods-in__quantity"><input type="number" min="0" max={item.qty} step="1" value={receiptDraft.quantities[item.productId] ?? 0} onChange={event => onReceiptDraftChange({ quantities: { ...receiptDraft.quantities, [item.productId]: Math.max(0, Math.min(item.qty, Math.floor(Number(event.target.value) || 0))) } })} aria-label={`${item.name} packs received`} /><small>received</small></span>
              </label>
            ))}
          </div>
          <label className="order-goods-in__note"><span>Delivery note <small>(optional)</small></span><textarea className="input" value={receiptDraft.note} onChange={event => onReceiptDraftChange({ note: event.target.value })} placeholder="Short, damaged or missing packs" /></label>
          <div className="order-goods-in__actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onSavePartial}><Package size={13} /> Save partial delivery</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onConfirmDelivery}><PackageCheck size={13} /> {busy ? 'Saving delivery…' : 'Confirm complete delivery'}</button>
          </div>
        </div>
      ) : null}
      {prescription.status === 'received' ? (
        <div className="order-ready-control">
          <span><CheckCircle2 size={16} /><span><strong>Complete delivery recorded</strong><small>Ready-to-collect remains manual. Confirm only after the pharmacy’s dispensing checks.</small></span></span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onReadyForCollection}><Mail size={13} /> {busy ? 'Queuing email…' : 'Mark ready & email customer'}</button>
        </div>
      ) : null}
      {prescription.status === 'ready' ? <div className="order-ready-confirmed"><Mail size={14} /><span><strong>Customer collection email queued</strong><small>Ready to collect was confirmed by the pharmacy{prescription.readyAt ? ` on ${formatDate(prescription.readyAt, true)}` : ''}.</small></span></div> : null}
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
