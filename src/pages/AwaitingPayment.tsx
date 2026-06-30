import { useState, useEffect } from 'react';
import { Clock, CheckCircle, CreditCard, ExternalLink, Send } from 'lucide-react';
import { useApp, money, rxRevenue, type PatientOrder } from '../context/AppContext';

export default function AwaitingPayment() {
  const { state, dispatch } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'awaiting' | 'paid'>('awaiting');
  const [prevOrders, setPrevOrders] = useState<PatientOrder[]>(state.orders);
  const [exitingOrderId, setExitingOrderId] = useState<number | null>(null);

  useEffect(() => {
    // Find if any order transitioned from 'sent' to 'paid'
    const transitioned = state.orders.find(order => {
      const prev = prevOrders.find(p => p.id === order.id);
      return prev && prev.payment.status === 'sent' && order.payment.status === 'paid';
    });

    if (transitioned) {
      if (activeSubTab === 'awaiting' && exitingOrderId !== transitioned.id) {
        setExitingOrderId(transitioned.id);
        const timer = setTimeout(() => {
          setExitingOrderId(null);
          setPrevOrders(state.orders);
        }, 400);
        return () => clearTimeout(timer);
      }
    }

    if (!exitingOrderId) {
      setPrevOrders(state.orders);
    }
  }, [state.orders, prevOrders, activeSubTab, exitingOrderId]);

  // Awaiting payments: status === 'sent'
  const awaitingOrders = prevOrders.filter(o => o.payment.status === 'sent');

  // Paid payments: status === 'paid'
  const paidOrders = state.orders.filter(o => o.payment.status === 'paid');

  const matchingOrders = activeSubTab === 'all'
    ? [...awaitingOrders, ...paidOrders].sort((a, b) => b.id - a.id)
    : activeSubTab === 'awaiting'
      ? awaitingOrders
      : paidOrders;

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
    const isExiting = exitingOrderId === order.id;

    return (
      <div className={`card card-spaced ${isExiting ? 'card-exit' : ''}`} key={order.id}>
        <div className="card-header">
          <div className="flex items-center gap-sm">
            <CreditCard size={16} className="text-secondary" />
            <span className="card-title-md">{patientName(order.patientId)}</span>
            <span className="text-muted text-sm">&mdash; Order Session #{order.id}</span>
          </div>
          {isSent && <span className="pill pill-amber">Link Active</span>}
          {isPaid && <span className="pill pill-green"><CheckCircle size={12} /> Paid</span>}
        </div>

        <div className="divider" />

        <div className="detail-grid">
          <div className="kv-line">
            <span className="text-muted text-sm">Requested Amount:</span>
            <span className="font-bold text-primary">{money(payment.amount)}</span>
          </div>
          {payment.ref && (
            <div className="kv-line">
              <span className="text-muted text-sm">Worldpay Reference:</span>
              <span className="text-sm font-semibold">{payment.ref}</span>
            </div>
          )}
          {payment.sentAt && (
            <div className="kv-line">
              <span className="text-muted text-sm">Dispatched Date:</span>
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
        {isSent && (
          <div className="flex flex-col gap-sm" style={{ marginTop: 8 }}>
            <div className="banner-amber flex items-center gap-sm" style={{ margin: 0 }}>
              <Clock size={16} />
              <span className="text-xs font-semibold">
                Waiting for patient Worldpay transaction. Callback simulator completes automatically in 7 seconds.
              </span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => handleSimulatePaymentClear(order.id)}
              style={{ alignSelf: 'flex-start' }}
            >
              ⚡ Simulate Immediate Worldpay Webhook Payment
            </button>
          </div>
        )}

        {isPaid && (
          <div style={{ marginTop: 8 }}>
            {allPlaced ? (
              <div className="banner-green flex items-center gap-sm" style={{ margin: 0, padding: 8 }}>
                <CheckCircle size={16} />
                <span className="text-xs font-semibold">All sub-orders placed with Curaleaf supplier.</span>
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
