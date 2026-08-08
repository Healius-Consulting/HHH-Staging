import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, Banknote, CheckCircle, Clock, CreditCard, ReceiptText, Send, ShieldCheck } from 'lucide-react';
import { useApp, money, rxRevenue, type ManualTender, type PatientOrder } from '../context/AppContext';
import { compactPatientName } from '../utils/patientName';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { recordPortalManualPayment, submitCuraleafClinicPrescription, submitCuraleafManualPrescription } from '../shared/api';

type PaymentFilter = 'all' | 'awaiting' | 'paid';
type ManualPaymentForm = { tender: ManualTender; reference: string; notes: string; confirmed: boolean };
const DEFAULT_MANUAL_FORM: ManualPaymentForm = { tender: 'epos-card', reference: '', notes: '', confirmed: false };

export default function AwaitingPayment() {
  const { state, dispatch } = useApp();
  const [activeFilter, setActiveFilter] = useState<PaymentFilter>('awaiting');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [manualForms, setManualForms] = useState<Record<number, ManualPaymentForm>>({});
  const [submittingOrderId, setSubmittingOrderId] = useState<number | null>(null);
  const tenantOrders = state.orders.filter(order => order.organisationId === state.currentOrganisationId);
  const awaitingOrders = tenantOrders.filter(order => order.payment.status === 'sent');
  const paidOrders = tenantOrders.filter(order => order.payment.status === 'paid');

  const matchingOrders = useMemo(() => {
    if (activeFilter === 'awaiting') return awaitingOrders;
    if (activeFilter === 'paid') return paidOrders;
    return [...awaitingOrders, ...paidOrders].sort((a, b) => b.id - a.id);
  }, [activeFilter, awaitingOrders, paidOrders]);

  useEffect(() => {
    if (!matchingOrders.some(order => order.id === selectedOrderId)) setSelectedOrderId(matchingOrders[0]?.id ?? null);
  }, [matchingOrders, selectedOrderId]);

  const selectedOrder = matchingOrders.find(order => order.id === selectedOrderId) ?? matchingOrders[0] ?? null;
  const outstandingValue = awaitingOrders.reduce((sum, order) => sum + order.payment.amount, 0);
  const clearedValue = paidOrders.reduce((sum, order) => sum + order.payment.amount, 0);

  const patientName = (patientId: string | null) => patientId
    ? state.crm.find(patient => patient.organisationId === state.currentOrganisationId && patient.id === patientId)?.name ?? 'Unknown patient'
    : 'Unassigned';

  const updateManualForm = (orderId: number, patch: Partial<ManualPaymentForm>) => setManualForms(current => ({
    ...current,
    [orderId]: { ...(current[orderId] ?? DEFAULT_MANUAL_FORM), ...patch },
  }));

  const submitLiveOrder = async (order: PatientOrder) => {
    if (!order.backendId) throw new Error('This order has not been saved to the HHH backend.');
    let pendingAcceptance = 0;
    for (const rx of order.prescriptions.filter(prescription => !prescription.placed)) {
      if (!rx.fileId || !rx.issueDate) throw new Error(`Rx ${rx.id} does not have a complete prescription record.`);

      if (rx.items.some(item => !item.formulaId || !item.unitsNeededCount)) throw new Error(`Rx ${rx.id} has a product without a formula ID or prescribed-unit count.`);
      const result = rx.entryMode === 'manual'
        ? await submitCuraleafManualPrescription({
            organisationId: state.currentOrganisationId,
            orderId: order.backendId,
            subOrderId: String(rx.id),
            fileId: rx.fileId,
            serialNumber: rx.serialNumber || '',

            issueDate: rx.issueDate,
            prescriber: {
              pin: rx.prescriberPin?.trim() ?? '',
              gmcNumber: rx.prescriberGmcNumber?.trim() ? Number(rx.prescriberGmcNumber) : null,
              gphcNumber: rx.prescriberGphcNumber?.trim() || null,
              name: rx.prescriber,
              initials: rx.prescriber.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 20),
            },
            items: rx.items.map(item => ({
              formulaId: item.formulaId!,
              unitsNeededCount: item.unitsNeededCount!,
              packId: item.productId,
              quantity: item.qty,
            })),
          })
        : await submitCuraleafClinicPrescription({
            organisationId: state.currentOrganisationId,
            orderId: order.backendId,
            subOrderId: String(rx.id),
            fileId: rx.fileId,
            serialNumber: rx.serialNumber || '',

          });
      if (result.status !== 'purchase_order_submitted') pendingAcceptance += 1;
      dispatch({ type: 'CONFIRM_CURALEAF_SUBMISSION', orderId: order.id, rxId: rx.id, customerReference: result.customerReference });
    }
    return pendingAcceptance;
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
        const pendingAcceptance = await submitLiveOrder({ ...order, payment: { ...order.payment, status: 'paid' } });
        dispatch({ type: 'ADD_TOAST', message: pendingAcceptance ? `Payment recorded. ${pendingAcceptance} prescription${pendingAcceptance === 1 ? ' is' : 's are'} awaiting Curaleaf credential validation or supplier review before purchase ordering.` : 'Payment recorded and Curaleaf purchase orders submitted.', toastType: 'success' });
      } else {
        dispatch({ type: 'RECORD_MANUAL_PAYMENT', orderId: order.id, tender: form.tender, reference: form.reference, notes: form.notes });
        dispatch({ type: 'PLACE_ORDER', orderId: order.id });
        dispatch({ type: 'ADD_TOAST', message: 'Training payment and Curaleaf submission simulated locally. Nothing was sent.', toastType: 'info' });
      }
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Payment or Curaleaf submission failed.', toastType: 'error' });
    } finally {
      setSubmittingOrderId(null);
    }
  };

  const handlePlaceOrder = async (order: PatientOrder) => {
    setSubmittingOrderId(order.id);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        const pendingAcceptance = await submitLiveOrder(order);
        dispatch({ type: 'ADD_TOAST', message: pendingAcceptance ? `${pendingAcceptance} prescription${pendingAcceptance === 1 ? ' is' : 's are'} awaiting Curaleaf credential validation or supplier review before purchase ordering.` : 'Curaleaf purchase orders submitted.', toastType: 'success' });
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

  const filterOptions: Array<{ key: PaymentFilter; label: string; count: number }> = [
    { key: 'awaiting', label: 'Needs action', count: awaitingOrders.length },
    { key: 'paid', label: 'Cleared', count: paidOrders.length },
    { key: 'all', label: 'All activity', count: awaitingOrders.length + paidOrders.length },
  ];

  return (
    <div className="page-body payment-workbench">
      <section className="operations-brief payment-brief">
        <div className="operations-brief__lead">
          <p className="section-label">Payment position</p>
          <h2>Review and reconcile patient payments</h2>
          <p>{awaitingOrders.length ? `${awaitingOrders.length} payment${awaitingOrders.length === 1 ? ' needs' : 's need'} attention · ` : ''}{money(outstandingValue)} outstanding · {money(clearedValue)} cleared.</p>
        </div>
        <label className="workspace-filter-field payment-brief__filter"><span>Show</span><select className="input select" value={activeFilter} onChange={event => setActiveFilter(event.target.value as PaymentFilter)}>{filterOptions.map(option => <option value={option.key} key={option.key}>{option.label} ({option.count})</option>)}</select></label>
      </section>

      {matchingOrders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">{activeFilter === 'awaiting' ? <Clock size={28} /> : <CheckCircle size={28} />}</div><h3>{activeFilter === 'awaiting' ? 'Nothing is waiting for payment' : 'No cleared payments yet'}</h3><p className="empty-desc">{activeFilter === 'awaiting' ? 'New payment requests will appear here as prescriptions reach checkout.' : 'Completed transactions will remain available in the cleared ledger.'}</p></div>
      ) : (
        <div className="payment-ledger-layout">
          <section className="payment-ledger" aria-label="Payment activity">
            <header><span><small>{activeFilter === 'awaiting' ? 'Action queue' : activeFilter === 'paid' ? 'Settlement ledger' : 'Payment activity'}</small><strong>{matchingOrders.length} transaction{matchingOrders.length === 1 ? '' : 's'}</strong></span><span>Newest first</span></header>
            <div className="payment-ledger__rows">
              {matchingOrders.map((order, index) => {
                const selected = selectedOrder?.id === order.id;
                const isPaid = order.payment.status === 'paid';
                return (
                  <button type="button" key={order.id} className={`payment-ledger-row${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedOrderId(order.id)} style={{ '--stagger-index': index } as CSSProperties}>
                    <span className={`payment-ledger-row__icon ${isPaid ? 'paid' : 'pending'}`}>{order.payment.route === 'worldpay' ? <CreditCard size={16} /> : <Banknote size={16} />}</span>
                    <span className="payment-ledger-row__identity"><strong title={patientName(order.patientId)}>{compactPatientName(patientName(order.patientId))}</strong><small>Order {order.id} · {order.prescriptions.length} Rx</small></span>
                    <span className="payment-ledger-row__amount"><strong>{money(order.payment.amount)}</strong><span className={`payment-queue-state ${isPaid ? 'paid' : 'pending'}`}>{isPaid ? <CheckCircle size={11} /> : <Clock size={11} />}{isPaid ? 'Cleared' : order.payment.route === 'worldpay' ? 'Awaiting patient' : 'Needs confirmation'}</span></span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>

          {selectedOrder && <PaymentDetail
            order={selectedOrder}
            patientName={patientName(selectedOrder.patientId)}
            form={manualForms[selectedOrder.id] ?? DEFAULT_MANUAL_FORM}
            onFormChange={patch => updateManualForm(selectedOrder.id, patch)}
            onRecordManual={() => void handleRecordManualPayment(selectedOrder)}
            onPlaceOrder={() => void handlePlaceOrder(selectedOrder)}
            busy={submittingOrderId === selectedOrder.id}
          />}
        </div>
      )}
    </div>
  );
}

function PaymentDetail({ order, patientName, form, onFormChange, onRecordManual, onPlaceOrder, busy }: {
  order: PatientOrder;
  patientName: string;
  form: ManualPaymentForm;
  onFormChange: (patch: Partial<ManualPaymentForm>) => void;
  onRecordManual: () => void;
  onPlaceOrder: () => void;
  busy: boolean;
}) {
  const { payment, prescriptions } = order;
  const isPaid = payment.status === 'paid';
  const isWorldpay = payment.route === 'worldpay';
  const allPlaced = prescriptions.length > 0 && prescriptions.every(rx => rx.placed);
  const routeLabel = isWorldpay ? 'Worldpay online checkout' : 'Pharmacy-managed payment';
  const eventDate = payment.paidAt ?? payment.sentAt;

  return (
    <article className="payment-detail" aria-label={`Payment details for ${patientName}`}>
      <header className="payment-detail__header">
        <span><small>Order {order.id}</small><strong>{patientName}</strong><em>{prescriptions.length} prescription sub-order{prescriptions.length === 1 ? '' : 's'}</em></span>
        <span className="payment-detail__amount"><small>{isPaid ? 'Amount received' : 'Amount requested'}</small><strong>{money(payment.amount)}</strong><span className={`payment-state ${isPaid ? 'paid' : 'pending'}`}>{isPaid ? <CheckCircle size={12} /> : <Clock size={12} />}{isPaid ? 'Payment cleared' : isWorldpay ? 'Awaiting patient' : 'Awaiting confirmation'}</span></span>
      </header>

      <dl className="payment-facts">
        <div><dt>Payment route</dt><dd>{routeLabel}</dd></div>
        <div><dt>{isPaid ? 'Confirmed' : 'Request created'}</dt><dd>{eventDate ? new Date(eventDate).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded'}</dd></div>
        {payment.ref && <div><dt>Worldpay reference</dt><dd>{payment.ref}</dd></div>}
        {payment.manualTender && <div><dt>Tender received</dt><dd>{{ 'epos-card': 'EPOS card', cash: 'Cash', 'bank-transfer': 'Bank transfer', other: 'Other' }[payment.manualTender]}</dd></div>}
        {payment.manualReference && <div><dt>Receipt reference</dt><dd>{payment.manualReference}</dd></div>}
        {payment.manualRecordedBy && <div><dt>Recorded by</dt><dd>{payment.manualRecordedBy}</dd></div>}
      </dl>

      <section className="payment-rx-ledger">
        <header><span className="section-label">Charge breakdown</span><span>{money(payment.amount)}</span></header>
        {prescriptions.map((rx, index) => <div key={rx.id}><span><strong>Rx {index + 1}</strong><small>{rx.prescriber || 'Prescriber pending'} · {rx.items.length} item{rx.items.length === 1 ? '' : 's'}</small></span><strong>{money(rxRevenue(rx))}</strong></div>)}
        {order.dispensingFee > 0 && <div><span><strong>Dispensing charge</strong><small>Pharmacy charge · patient collection</small></span><strong>{money(order.dispensingFee)}</strong></div>}
      </section>

      {!isPaid && isWorldpay && <div className="payment-callout pending"><Clock size={17} /><span><strong>Waiting for verified checkout</strong><small>The order remains here until Worldpay confirms the hosted payment through its signed webhook.</small></span></div>}

      {!isPaid && !isWorldpay && (
        <section className="payment-manual-form">
          <header><span className="payment-route-icon"><Banknote size={18} /></span><span><strong>Confirm pharmacy payment</strong><small>Record the payment only after the funds have been received through the pharmacy’s own route.</small></span></header>
          <div className="payment-manual-fields">
            <label><span>Payment method</span><select className="input select" value={form.tender} onChange={event => onFormChange({ tender: event.target.value as ManualTender })}><option value="epos-card">EPOS card</option><option value="cash">Cash</option><option value="bank-transfer">Bank transfer</option><option value="other">Other</option></select></label>
            <label><span>Receipt reference <small>(optional)</small></span><input className="input" value={form.reference} onChange={event => onFormChange({ reference: event.target.value })} placeholder="TILL-1048" /></label>
          </div>
          <label><span>Reconciliation note <small>(optional)</small></span><textarea className="input" value={form.notes} onChange={event => onFormChange({ notes: event.target.value })} placeholder="Anything useful for the audit trail" /></label>
          <label className="payment-confirmation"><input type="checkbox" checked={form.confirmed} onChange={event => onFormChange({ confirmed: event.target.checked })} /><span><strong>I confirm {money(payment.amount)} has been received</strong><small>This creates the pharmacy’s manual payment record.</small></span></label>
          <button type="button" className="btn btn-primary" disabled={!form.confirmed || busy} onClick={onRecordManual}><ReceiptText size={15} /> {busy ? 'Recording and submitting…' : 'Record payment and continue'}</button>
        </section>
      )}

      {isPaid && (
        <section className="payment-complete-action">
          <div className="payment-callout success"><ShieldCheck size={18} /><span><strong>{isWorldpay ? 'Settled to the pharmacy merchant' : 'Payment recorded by the pharmacy'}</strong><small>The prescription can now continue to Curaleaf fulfilment.</small></span></div>
          {allPlaced ? <span className="payment-submitted"><CheckCircle size={15} /> All prescription sub-orders are queued or confirmed with Curaleaf.</span> : <button type="button" className="btn btn-primary" disabled={busy} onClick={onPlaceOrder}><Send size={15} /> {busy ? 'Submitting to Curaleaf…' : 'Send to Curaleaf through HHH'}</button>}
        </section>
      )}
    </article>
  );
}
