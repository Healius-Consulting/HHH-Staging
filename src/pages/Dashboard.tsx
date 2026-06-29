import { Activity, CreditCard, Package, CheckCircle, Smartphone } from 'lucide-react';
import { useApp, money } from '../context/AppContext';

export default function Dashboard() {
  const { state, dispatch } = useApp();

  /* ── Computed stats ── */
  const newReferrals = state.submissions.filter(s => s.status !== 'Completed').length;

  const awaitingPayment = state.orders.filter(o => o.payment.status === 'sent').length;

  const inFulfilment = state.orders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.some(rx => rx.status !== 'ready')
  ).length;

  const readyForCollection = state.orders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.length > 0 &&
    o.prescriptions.every(rx => rx.status === 'ready')
  ).length;

  /* ── Recent orders (last 5) ── */
  const recentOrders = [...state.orders]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return state.crm.find(p => p.id === patientId)?.name ?? 'Unknown';
  };

  const paymentPill = (status: string) => {
    switch (status) {
      case 'paid': return <span className="pill pill-green">Paid</span>;
      case 'sent': return <span className="pill pill-amber">Awaiting</span>;
      default:     return <span className="pill pill-neutral">None</span>;
    }
  };

  /* ── Orders awaiting payment (for phone widget) ── */
  const pendingPaymentOrders = state.orders.filter(o => o.payment.status === 'sent');

  const handleConfirmPayment = (orderId: number) => {
    dispatch({ type: 'CONFIRM_PAYMENT', orderId });
    dispatch({ type: 'PLACE_ORDER', orderId });
  };

  return (
    <div className="page-body">
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">Overview of your pharmacy operations</p>

      {/* ══ Stats Grid ══ */}
      <div className="stats-grid">
        <div
          className="stat-card"
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}
        >
          <div className="stat-icon info">
            <Activity size={18} />
          </div>
          <div className="stat-value">{newReferrals}</div>
          <div className="stat-label">New Referrals</div>
        </div>

        <div
          className="stat-card"
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="stat-icon amber">
            <CreditCard size={18} />
          </div>
          <div className="stat-value">{awaitingPayment}</div>
          <div className="stat-label">Awaiting Payment</div>
        </div>

        <div
          className="stat-card"
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="stat-icon green">
            <Package size={18} />
          </div>
          <div className="stat-value">{inFulfilment}</div>
          <div className="stat-label">In Fulfilment</div>
        </div>

        <div
          className="stat-card"
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="stat-icon green">
            <CheckCircle size={18} />
          </div>
          <div className="stat-value">{readyForCollection}</div>
          <div className="stat-label">Ready for Collection</div>
        </div>
      </div>

      {/* ══ Main + Phone side-by-side ══ */}
      <div className="flex gap-lg" style={{ alignItems: 'flex-start' }}>
        {/* ── Recent Activity ── */}
        <div style={{ flex: 1 }}>
          <h3 className="card-title" style={{ marginBottom: 10 }}>Recent Activity</h3>
          {recentOrders.length === 0 ? (
            <div className="empty-state">No orders yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Date</th>
                    <th>Payment</th>
                    <th className="text-right">Rxs</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(order => (
                    <tr
                      key={order.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        dispatch({ type: 'SET_ACTIVE_ORDER', orderId: order.id });
                        dispatch({ type: 'SET_SCREEN', screen: 'review' });
                      }}
                    >
                      <td className="font-semibold">{patientName(order.patientId)}</td>
                      <td className="text-muted text-sm">
                        {new Date(order.date).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td>{paymentPill(order.payment.status)}</td>
                      <td className="text-right">{order.prescriptions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Simulated Patient Phone ── */}
        <div className="phone-widget">
          <div className="phone-header">
            <div className="flex items-center gap-sm">
              <Smartphone size={14} />
              <span>Patient Payment Portal — Demo</span>
            </div>
          </div>
          <div className="phone-body">
            {pendingPaymentOrders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <CreditCard size={22} />
                </div>
                No pending payment links.
              </div>
            ) : (
              pendingPaymentOrders.map(order => (
                <div key={order.id} className="card" style={{ marginBottom: 12 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <span className="font-semibold text-sm">
                      {patientName(order.patientId)}
                    </span>
                    <span className="pill pill-amber">Pending</span>
                  </div>
                  <div className="kv-line">
                    <span className="text-muted text-sm">Amount due</span>
                    <span className="font-semibold">{money(order.payment.amount)}</span>
                  </div>
                  <button
                    className="phone-pay-btn"
                    onClick={() => handleConfirmPayment(order.id)}
                  >
                    ✓ Confirm Payment
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
