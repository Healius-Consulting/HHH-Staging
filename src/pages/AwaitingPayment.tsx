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
      <div className={`card ${isExiting ? 'card-exit' : ''}`} key={order.id} style={{ marginBottom: 16 }}>
        {/* ── Card Header ── */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div className="flex items-center gap-sm">
            <CreditCard size={16} className="text-secondary" />
            <span className="font-semibold" style={{ fontSize: 15 }}>{patientName(order.patientId)}</span>
            <span className="text-muted text-sm">&mdash; Order Session #{order.id}</span>
          </div>
          {isSent && <span className="pill pill-amber">Link Active</span>}
          {isPaid && <span className="pill pill-green"><CheckCircle size={12} /> Paid</span>}
        </div>

        <div className="divider" />

        {/* ── Payment Details ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
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
          <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 6 }}>Prescription sub-orders in this session</span>
          {prescriptions.map((rx, idx) => (
            <div key={rx.id} className="flex items-center justify-between" style={{ padding: '6px 0', background: 'rgba(0,0,0,0.15)', paddingLeft: 12, paddingRight: 12, borderRadius: 6, marginBottom: 6 }}>
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
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {/* Card 1: All Payments */}
        <div
          className="card card-surface"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            border: activeSubTab === 'all' ? '1px solid var(--green-500)' : '1px solid var(--border)',
            background: activeSubTab === 'all' ? 'rgba(16, 185, 129, 0.05)' : 'var(--card-bg)',
            transition: 'all 0.2s ease'
          }}
          onClick={() => setActiveSubTab('all')}
        >
          <div className="flex justify-between items-center text-xs font-bold text-muted uppercase">
            <span>All Payments</span>
            <CreditCard size={14} className={activeSubTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span style={{ fontSize: 22, fontWeight: 700, display: 'block', marginTop: 4, color: activeSubTab === 'all' ? 'var(--green-100)' : 'inherit' }}>
            {awaitingOrders.length + paidOrders.length}
          </span>
        </div>

        {/* Card 2: Awaiting Payment */}
        <div
          className="card card-surface"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            border: activeSubTab === 'awaiting' ? '1px solid var(--green-500)' : '1px solid var(--border)',
            background: activeSubTab === 'awaiting' ? 'rgba(16, 185, 129, 0.05)' : 'var(--card-bg)',
            transition: 'all 0.2s ease'
          }}
          onClick={() => setActiveSubTab('awaiting')}
        >
          <div className="flex justify-between items-center text-xs font-bold text-muted uppercase">
            <span>Awaiting Payment</span>
            <Clock size={14} className={activeSubTab === 'awaiting' ? 'text-amber' : 'text-muted'} />
          </div>
          <span style={{ fontSize: 22, fontWeight: 700, display: 'block', marginTop: 4, color: activeSubTab === 'awaiting' ? 'var(--green-100)' : 'inherit' }}>
            {awaitingOrders.length}
          </span>
        </div>

        {/* Card 3: Paid Transactions */}
        <div
          className="card card-surface"
          style={{
            margin: 0,
            padding: 12,
            cursor: 'pointer',
            border: activeSubTab === 'paid' ? '1px solid var(--green-500)' : '1px solid var(--border)',
            background: activeSubTab === 'paid' ? 'rgba(16, 185, 129, 0.05)' : 'var(--card-bg)',
            transition: 'all 0.2s ease'
          }}
          onClick={() => setActiveSubTab('paid')}
        >
          <div className="flex justify-between items-center text-xs font-bold text-muted uppercase">
            <span>Paid / Cleared</span>
            <CheckCircle size={14} className={activeSubTab === 'paid' ? 'text-green' : 'text-muted'} />
          </div>
          <span style={{ fontSize: 22, fontWeight: 700, display: 'block', marginTop: 4, color: activeSubTab === 'paid' ? 'var(--green-100)' : 'inherit' }}>
            {paidOrders.length}
          </span>
        </div>
      </div>

      {matchingOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            {activeSubTab === 'awaiting' ? <Clock size={28} /> : <CheckCircle size={28} />}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
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
