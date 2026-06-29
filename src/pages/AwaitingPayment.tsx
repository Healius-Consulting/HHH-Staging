import { Clock, CheckCircle, CreditCard, ExternalLink, Send } from 'lucide-react';
import { useApp, money, rxRevenue, type PatientOrder } from '../context/AppContext';

export default function AwaitingPayment() {
  const { state, dispatch } = useApp();

  /* ── Filter orders with sent or paid payment status (that haven't been submitted to Curaleaf yet) ── */
  const matchingOrders = state.orders.filter(
    o => o.payment.status === 'sent' || (o.payment.status === 'paid' && o.prescriptions.some(rx => !rx.placed))
  );

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return state.crm.find(p => p.id === patientId)?.name ?? 'Unknown';
  };

  const handlePlaceOrder = (orderId: number) => {
    dispatch({ type: 'PLACE_ORDER', orderId });
  };

  const handleSimulatePaymentClear = (orderId: number) => {
    dispatch({ type: 'CONFIRM_PAYMENT', orderId });
    dispatch({ type: 'PLACE_ORDER', orderId });

    const orderObj = state.orders.find(o => o.id === orderId);
    const name = orderObj?.patientId ? state.crm.find(p => p.id === orderObj.patientId)?.name : 'Marcus Vance';
    dispatch({ 
      type: 'ADD_TOAST', 
      message: `Worldpay Webhook: Payment cleared instantly for ${name} (£${orderObj?.payment.amount.toFixed(2)}). Order submitted directly to Curaleaf.`, 
      toastType: 'success' 
    });
  };

  const renderCard = (order: PatientOrder) => {
    const { payment, prescriptions } = order;
    const isSent = payment.status === 'sent';
    const isPaid = payment.status === 'paid';
    const allPlaced = prescriptions.length > 0 && prescriptions.every(rx => rx.placed);

    return (
      <div className="card" key={order.id} style={{ marginBottom: 16 }}>
        {/* ── Card Header ── */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div className="flex items-center gap-sm">
            <CreditCard size={18} className="text-muted" />
            <span className="font-semibold">{patientName(order.patientId)}</span>
            <span className="text-muted text-sm">— Order #{order.id}</span>
          </div>
          {isSent && <span className="pill pill-amber">Link sent</span>}
          {isPaid && <span className="pill pill-green">✓ Paid</span>}
        </div>

        <div className="divider" />

        {/* ── Payment Details ── */}
        <div style={{ marginBottom: 12 }}>
          <div className="kv-line">
            <span className="text-muted text-sm">Amount</span>
            <span className="font-semibold">{money(payment.amount)}</span>
          </div>
          {payment.ref && (
            <div className="kv-line">
              <span className="text-muted text-sm">Reference</span>
              <span className="text-sm">{payment.ref}</span>
            </div>
          )}
          {payment.sentAt && (
            <div className="kv-line">
              <span className="text-muted text-sm">Sent at</span>
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
          {prescriptions.map(rx => (
            <div key={rx.id} className="flex items-center justify-between" style={{ padding: '6px 0' }}>
              <div className="flex items-center gap-sm">
                <ExternalLink size={14} className="text-muted" />
                <span className="text-sm font-semibold">{rx.prescriber || 'No prescriber'}</span>
                <span className="text-muted text-xs">
                  · {rx.items.length} item{rx.items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-sm font-semibold">{money(rxRevenue(rx))}</span>
            </div>
          ))}
        </div>

        <div className="divider" />

        {/* ── Status / Actions ── */}
        {isSent && (
          <div className="flex flex-col gap-sm" style={{ marginTop: 8 }}>
            <div className="banner-amber flex items-center gap-sm">
              <Clock size={16} />
              <span className="text-sm">
                Waiting for patient to complete payment via Worldpay link. Clears automatically in 7 seconds.
              </span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => handleSimulatePaymentClear(order.id)}
              style={{ alignSelf: 'flex-start' }}
            >
              ⚡ Simulate Webhook Clearance (Instant)
            </button>
          </div>
        )}

        {isPaid && (
          <div style={{ marginTop: 8 }}>
            {allPlaced ? (
              <div className="banner-green flex items-center gap-sm">
                <CheckCircle size={16} />
                <span className="text-sm font-semibold">Submitted to Curaleaf</span>
              </div>
            ) : (
              <button
                className="btn btn-primary flex items-center gap-sm"
                onClick={() => handlePlaceOrder(order.id)}
              >
                <Send size={14} />
                Place order with Curaleaf
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-body">
      <h2 className="page-title">Awaiting payment</h2>
      <p className="page-subtitle">
        Orders with payment links sent to patients. Payment clearing automatically redirects orders directly to Curaleaf fulfillment.
      </p>

      {matchingOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <CreditCard size={28} />
          </div>
          No payment links outstanding.
        </div>
      ) : (
        matchingOrders.map(order => renderCard(order))
      )}
    </div>
  );
}
