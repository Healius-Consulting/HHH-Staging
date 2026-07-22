import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, Banknote, CheckCircle, Clock, CreditCard, ReceiptText, Send, ShieldCheck } from 'lucide-react';
import { useApp, money, rxRevenue, type ManualTender, type PatientOrder } from '../context/AppContext';
import { compactPatientName } from '../utils/patientName';

type PaymentFilter = 'all' | 'awaiting' | 'paid';
type ManualPaymentForm = { tender: ManualTender; reference: string; notes: string; confirmed: boolean };
const DEFAULT_MANUAL_FORM: ManualPaymentForm = { tender: 'epos-card', reference: '', notes: '', confirmed: false };

export default function AwaitingPayment() {
  const { state, dispatch } = useApp();
  const [activeFilter, setActiveFilter] = useState<PaymentFilter>('awaiting');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [manualForms, setManualForms] = useState<Record<number, ManualPaymentForm>>({});
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

  const handleRecordManualPayment = (order: PatientOrder) => {
    const form = manualForms[order.id] ?? DEFAULT_MANUAL_FORM;
    if (!form.confirmed) return;
    dispatch({ type: 'RECORD_MANUAL_PAYMENT', orderId: order.id, tender: form.tender, reference: form.reference, notes: form.notes });
    dispatch({ type: 'PLACE_ORDER', orderId: order.id });
    const label = form.tender === 'epos-card' ? 'EPOS card' : form.tender === 'bank-transfer' ? 'bank transfer' : form.tender;
    dispatch({ type: 'ADD_TOAST', message: `${money(order.payment.amount)} ${label} payment recorded. Curaleaf submission queued for backend confirmation.`, toastType: 'success' });
  };

  const handlePlaceOrder = (orderId: number) => {
    dispatch({ type: 'PLACE_ORDER', orderId });
    dispatch({ type: 'ADD_TOAST', message: 'Curaleaf submission queued. The supplier reference will appear after backend confirmation.', toastType: 'success' });
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
            onRecordManual={() => handleRecordManualPayment(selectedOrder)}
            onPlaceOrder={() => handlePlaceOrder(selectedOrder.id)}
          />}
        </div>
      )}
    </div>
  );
}

function PaymentDetail({ order, patientName, form, onFormChange, onRecordManual, onPlaceOrder }: {
  order: PatientOrder;
  patientName: string;
  form: ManualPaymentForm;
  onFormChange: (patch: Partial<ManualPaymentForm>) => void;
  onRecordManual: () => void;
  onPlaceOrder: () => void;
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
          <button type="button" className="btn btn-primary" disabled={!form.confirmed} onClick={onRecordManual}><ReceiptText size={15} /> Record payment and continue</button>
        </section>
      )}

      {isPaid && (
        <section className="payment-complete-action">
          <div className="payment-callout success"><ShieldCheck size={18} /><span><strong>{isWorldpay ? 'Settled to the pharmacy merchant' : 'Payment recorded by the pharmacy'}</strong><small>The prescription can now continue to Curaleaf fulfilment.</small></span></div>
          {allPlaced ? <span className="payment-submitted"><CheckCircle size={15} /> All prescription sub-orders are queued or confirmed with Curaleaf.</span> : <button type="button" className="btn btn-primary" onClick={onPlaceOrder}><Send size={15} /> Send to Curaleaf through HHH</button>}
        </section>
      )}
    </article>
  );
}
