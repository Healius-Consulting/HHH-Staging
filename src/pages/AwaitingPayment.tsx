import { useState } from 'react';
import { Banknote, Clock, CheckCircle, CreditCard, ExternalLink, ReceiptText, Send } from 'lucide-react';
import { useApp, money, rxRevenue, type ManualTender, type PatientOrder } from '../context/AppContext';

type ManualPaymentForm = { tender: ManualTender; reference: string; notes: string; confirmed: boolean };
const DEFAULT_MANUAL_FORM: ManualPaymentForm = { tender: 'epos-card', reference: '', notes: '', confirmed: false };

export default function AwaitingPayment() {
  const { state, dispatch } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'awaiting' | 'paid'>('awaiting');
  const [manualForms, setManualForms] = useState<Record<number, ManualPaymentForm>>({});

  const tenantOrders = state.orders.filter(order => order.organisationId === state.currentOrganisationId);

  // Awaiting payments: status === 'sent'
  const awaitingOrders = tenantOrders.filter(o => o.payment.status === 'sent');

  // Paid payments: status === 'paid'
  const paidOrders = tenantOrders.filter(o => o.payment.status === 'paid');

  const matchingOrders = activeSubTab === 'all'
    ? [...awaitingOrders, ...paidOrders].sort((a, b) => b.id - a.id)
    : activeSubTab === 'awaiting'
      ? awaitingOrders
      : paidOrders;

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return state.crm.find(p => p.organisationId === state.currentOrganisationId && p.id === patientId)?.name ?? 'Unknown';
  };

  const handlePlaceOrder = (orderId: number) => {
    dispatch({ type: 'PLACE_ORDER', orderId });
    dispatch({ type: 'ADD_TOAST', message: 'HHH transmitted the approved, paid prescription order to Curaleaf.', toastType: 'success' });
  };

  const updateManualForm = (orderId: number, patch: Partial<ManualPaymentForm>) => {
    setManualForms(current => ({ ...current, [orderId]: { ...(current[orderId] ?? DEFAULT_MANUAL_FORM), ...patch } }));
  };

  const handleRecordManualPayment = (order: PatientOrder) => {
    const form = manualForms[order.id] ?? DEFAULT_MANUAL_FORM;
    if (!form.confirmed) return;
    dispatch({ type: 'RECORD_MANUAL_PAYMENT', orderId: order.id, tender: form.tender, reference: form.reference, notes: form.notes });
    dispatch({ type: 'PLACE_ORDER', orderId: order.id });
    const label = form.tender === 'epos-card' ? 'EPOS card' : form.tender === 'bank-transfer' ? 'bank transfer' : form.tender;
    dispatch({ type: 'ADD_TOAST', message: `${money(order.payment.amount)} ${label} payment recorded. HHH transmitted the order to Curaleaf.`, toastType: 'success' });
  };

  const renderCard = (order: PatientOrder) => {
    const { payment, prescriptions } = order;
    const isSent = payment.status === 'sent';
    const isPaid = payment.status === 'paid';
    const allPlaced = prescriptions.length > 0 && prescriptions.every(rx => rx.placed);

    return (
      <div className="card card-spaced" key={order.id}>
        <div className="card-header">
          <div className="flex items-center gap-sm">
            <CreditCard size={16} className="text-secondary" />
            <span className="card-title-md">{patientName(order.patientId)}</span>
            <span className="text-muted text-sm">&mdash; Order Session #{order.id}</span>
          </div>
          {isSent && <span className="pill pill-amber">{payment.route === 'worldpay' ? 'Worldpay link active' : 'Awaiting pharmacy confirmation'}</span>}
          {isPaid && <span className="pill pill-green"><CheckCircle size={12} /> {payment.route === 'worldpay' ? 'Paid online' : 'Paid at pharmacy'}</span>}
        </div>

        <div className="divider" />

        <div className="detail-grid">
          <div className="kv-line">
            <span className="text-muted text-sm">Requested Amount:</span>
            <span className="font-bold text-primary">{money(payment.amount)}</span>
          </div>
          <div className="kv-line">
            <span className="text-muted text-sm">Payment route:</span>
            <span className="text-sm font-semibold">{payment.route === 'worldpay' ? 'Worldpay online checkout' : 'Pharmacy-managed / EPOS'}</span>
          </div>
          {payment.route === 'worldpay' && payment.ref && (
            <div className="kv-line">
              <span className="text-muted text-sm">Worldpay Reference:</span>
              <span className="text-sm font-semibold">{payment.ref}</span>
            </div>
          )}
          {payment.manualTender && <div className="kv-line"><span className="text-muted text-sm">Tender received:</span><span className="text-sm font-semibold">{{ 'epos-card': 'EPOS card', cash: 'Cash', 'bank-transfer': 'Bank transfer', other: 'Other' }[payment.manualTender]}</span></div>}
          {payment.manualReference && <div className="kv-line"><span className="text-muted text-sm">Invoice / receipt reference:</span><span className="text-sm font-semibold">{payment.manualReference}</span></div>}
          {payment.manualNotes && <div className="kv-line"><span className="text-muted text-sm">Payment notes:</span><span className="text-sm">{payment.manualNotes}</span></div>}
          {payment.manualRecordedBy && <div className="kv-line"><span className="text-muted text-sm">Recorded by:</span><span className="text-sm font-semibold">{payment.manualRecordedBy}</span></div>}
          {payment.paidAt && <div className="kv-line"><span className="text-muted text-sm">Payment confirmed:</span><span className="text-sm">{new Date(payment.paidAt).toLocaleString('en-GB')}</span></div>}
          {isPaid && <div className="kv-line settlement-net-line"><span className="text-muted text-sm">Settled to:</span><span className="font-bold text-green">{payment.route === 'worldpay' ? 'Pharmacy Worldpay merchant' : 'Pharmacy directly'}</span></div>}
          {payment.sentAt && (
            <div className="kv-line">
              <span className="text-muted text-sm">{payment.route === 'worldpay' ? 'Payment link sent:' : 'Payment route selected:'}</span>
              <span className="text-sm">
                {new Date(payment.sentAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )}
        </div>

        <div className="divider" />

        {/* ── Prescriptions List ── */}
        <div style={{ marginBottom: 12 }}>
          <span className="section-label">Prescription sub-orders in this session</span>
          {prescriptions.map((rx, idx) => (
            <div key={rx.id} className="rx-sub-line">
              <div className="flex items-center gap-sm">
                <ExternalLink size={14} className="text-secondary" />
                <span className="text-sm font-semibold">Rx #{idx + 1} &mdash; {rx.prescriber || 'Pending prescriber'}</span>
                <span className="text-muted text-xs">
                  &middot; {rx.items.length} item{rx.items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-sm font-bold text-green">{money(rxRevenue(rx))}</span>
            </div>
          ))}
        </div>

        <div className="divider" />

        {/* ── Status / Actions ── */}
        {isSent && payment.route === 'worldpay' && (
          <div className="flex flex-col gap-sm" style={{ marginTop: 8 }}>
            <div className="banner-amber flex items-center gap-sm" style={{ margin: 0 }}>
              <Clock size={16} />
              <span className="text-xs font-semibold">
                Awaiting verified Worldpay payment. This order will remain pending until the hosted checkout and webhook integration is connected.
              </span>
            </div>
          </div>
        )}

        {isSent && payment.route === 'pharmacy' && (() => {
          const form = manualForms[order.id] ?? DEFAULT_MANUAL_FORM;
          return (
            <div className="manual-payment-panel">
              <div className="manual-payment-heading"><div className="payment-route-icon"><Banknote size={18} /></div><div><strong>Record pharmacy payment</strong><span>Take payment using the pharmacy’s own EPOS, till or banking process, then confirm it here.</span></div></div>
              <div className="manual-payment-grid">
                <label>Payment method<select className="input select" value={form.tender} onChange={event => updateManualForm(order.id, { tender: event.target.value as ManualTender })}><option value="epos-card">EPOS card</option><option value="cash">Cash</option><option value="bank-transfer">Bank transfer</option><option value="other">Other</option></select></label>
                <label>Invoice / receipt reference <span className="text-muted">(optional)</span><input className="input" value={form.reference} onChange={event => updateManualForm(order.id, { reference: event.target.value })} placeholder="e.g. TILL-1048 or invoice ID" /></label>
              </div>
              <label>Additional payment notes <span className="text-muted">(optional)</span><textarea className="input manual-payment-notes" value={form.notes} onChange={event => updateManualForm(order.id, { notes: event.target.value })} placeholder="Anything useful for reconciliation or the audit trail" /></label>
              <label className="manual-payment-confirm"><input type="checkbox" checked={form.confirmed} onChange={event => updateManualForm(order.id, { confirmed: event.target.checked })} /><span><strong>I confirm {money(payment.amount)} has been received by the pharmacy</strong><small>This manual check replaces a Worldpay webhook for this order.</small></span></label>
              <button className="btn btn-primary" disabled={!form.confirmed} onClick={() => handleRecordManualPayment(order)}><ReceiptText size={14} /> Record payment and send through HHH</button>
            </div>
          );
        })()}

        {isPaid && (
          <div style={{ marginTop: 8 }}>
            {allPlaced ? (
              <div className="banner-green flex items-center gap-sm" style={{ margin: 0, padding: 8 }}>
                <CheckCircle size={16} />
                <span className="text-xs font-semibold">HHH transmitted all sub-orders to Curaleaf.</span>
              </div>
            ) : (
              <button
                className="btn btn-primary flex items-center gap-sm"
                onClick={() => handlePlaceOrder(order.id)}
              >
                <Send size={14} />
                Send to Curaleaf through HHH
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-body">
      {/* ══ Payment Stage Switchers ══ */}
      <div className="filter-grid">
        <div className={`card card-surface filter-card ${activeSubTab === 'all' ? 'active' : ''}`} onClick={() => setActiveSubTab('all')}>
          <div className="filter-card__head">
            <span>All Payments</span>
            <CreditCard size={14} className={activeSubTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{awaitingOrders.length + paidOrders.length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeSubTab === 'awaiting' ? 'active' : ''}`} onClick={() => setActiveSubTab('awaiting')}>
          <div className="filter-card__head">
            <span>Awaiting Payment</span>
            <Clock size={14} className={activeSubTab === 'awaiting' ? 'text-amber' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{awaitingOrders.length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeSubTab === 'paid' ? 'active' : ''}`} onClick={() => setActiveSubTab('paid')}>
          <div className="filter-card__head">
            <span>Paid / Cleared</span>
            <CheckCircle size={14} className={activeSubTab === 'paid' ? 'text-green' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{paidOrders.length}</span>
        </div>
      </div>

      {matchingOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            {activeSubTab === 'awaiting' ? <Clock size={28} /> : <CheckCircle size={28} />}
          </div>
          <p className="empty-desc">
            {activeSubTab === 'awaiting' 
              ? 'No pending patient billing requests active.' 
              : 'No completed transactions recorded in this session.'}
          </p>
        </div>
      ) : (
        matchingOrders.map(order => renderCard(order))
      )}
    </div>
  );
}
