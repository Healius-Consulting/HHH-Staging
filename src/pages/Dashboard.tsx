import { useState, useEffect } from 'react';
import { Activity, CreditCard, Package, CheckCircle, Smartphone, ArrowLeft, ShieldCheck, Wifi, Battery } from 'lucide-react';
import { useApp, money } from '../context/AppContext';

export default function Dashboard() {
  const { state, dispatch } = useApp();

  /* ── Phone Simulator State ── */
  const [phoneScreen, setPhoneScreen] = useState<'lock' | 'payment'>('lock');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [paymentState, setPaymentState] = useState<'idle' | 'scanning' | 'success'>('idle');
  const [sliderVal, setSliderVal] = useState(0);

  // Time clock state
  const [timeStr, setTimeStr] = useState('12:00');
  const [dateStr, setDateStr] = useState('MON, 29 JUN');

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTimeStr(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      setDateStr(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase());
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

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
  const latestPendingOrder = pendingPaymentOrders[pendingPaymentOrders.length - 1];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setSliderVal(val);
    if (val >= 90) {
      triggerPayment();
    }
  };

  const handleSliderRelease = () => {
    if (sliderVal < 90) {
      setSliderVal(0);
    }
  };

  const triggerPayment = () => {
    setPaymentState('scanning');
    setSliderVal(0);
    
    // Simulate payment authorization
    setTimeout(() => {
      setPaymentState('success');
      
      // Dispatch webhook payment confirmation & place order
      dispatch({ type: 'CONFIRM_PAYMENT', orderId: selectedOrderId! });
      dispatch({ type: 'PLACE_ORDER', orderId: selectedOrderId! });

      const orderObj = state.orders.find(o => o.id === selectedOrderId);
      const name = orderObj?.patientId ? state.crm.find(p => p.id === orderObj.patientId)?.name : 'Marcus Vance';
      
      dispatch({ 
        type: 'ADD_TOAST', 
        message: `Worldpay Webhook: Received £${orderObj?.payment.amount.toFixed(2)} from ${name}`, 
        toastType: 'success' 
      });

      // Return back to lock screen
      setTimeout(() => {
        setPhoneScreen('lock');
        setSelectedOrderId(null);
        setPaymentState('idle');
      }, 1500);
    }, 1500);
  };

  // Find active checkout details
  const activeCheckoutOrder = selectedOrderId ? state.orders.find(o => o.id === selectedOrderId) : null;
  const checkoutPatient = activeCheckoutOrder?.patientId 
    ? state.crm.find(c => c.id === activeCheckoutOrder.patientId) ?? null 
    : null;

  return (
    <div className="page-body">
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">Overview of your pharmacy operations</p>

      {/* ══ Stats Grid ══ */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
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
          style={{ cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}
        >
          <div className="stat-icon amber">
            <CreditCard size={18} />
          </div>
          <div className="stat-value">{awaitingPayment}</div>
          <div className="stat-label">Awaiting Payment</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
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
          style={{ cursor: 'pointer' }}
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
      <div className="flex gap-lg flex-wrap" style={{ alignItems: 'flex-start' }}>
        {/* ── Recent Activity ── */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <h3 className="card-title" style={{ marginBottom: 12 }}>Recent Activity</h3>
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
                        dispatch({ type: 'SET_SCREEN', screen: 'create' });
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

        {/* ── Simulated Patient Phone Mockup ── */}
        <div className="flex flex-col items-center" style={{ gap: 10 }}>
          <div className="text-xs text-muted font-bold flex items-center gap-xs">
            <Smartphone size={12} className="text-green" />
            SIMULATED PATIENT SMARTPHONE
          </div>

          <div className="phone-frame">
            {/* Dynamic camera island */}
            <div className="phone-island" />

            <div className="phone-screen">
              {/* STATUS BAR */}
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  padding: '8px 18px 4px', 
                  fontSize: 10, 
                  fontWeight: 600, 
                  background: 'transparent',
                  position: 'absolute',
                  top: 0,
                  width: '100%',
                  zIndex: 950
                }}
              >
                <span>{timeStr}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Wifi size={10} />
                  <Battery size={12} />
                </div>
              </div>

              {/* LOCK SCREEN VIEW */}
              {phoneScreen === 'lock' && (
                <div className="phone-screen-locked">
                  <div className="phone-clock-widget">
                    <div className="phone-clock-time">{timeStr}</div>
                    <div className="phone-clock-date">{dateStr}</div>
                  </div>

                  {/* Push notification overlay */}
                  {latestPendingOrder ? (
                    <div 
                      className="phone-notification-banner"
                      onClick={() => {
                        setSelectedOrderId(latestPendingOrder.id);
                        setPhoneScreen('payment');
                      }}
                    >
                      <div className="phone-notification-icon">HH</div>
                      <div className="phone-notification-body">
                        <div className="phone-notification-title">
                          <span>HHH Pharmacy</span>
                          <span>now</span>
                        </div>
                        <div className="phone-notification-desc font-semibold">
                          Worldpay Payment Request
                        </div>
                        <div className="phone-notification-desc">
                          Tap to pay {money(latestPendingOrder.payment.amount)} for medical cannabis prescription.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div 
                      style={{ 
                        margin: 'auto 20px', 
                        padding: '12px', 
                        borderRadius: 14, 
                        background: 'rgba(255,255,255,0.06)', 
                        border: '1px dashed rgba(255,255,255,0.15)',
                        textAlign: 'center', 
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.5)'
                      }}
                    >
                      Locked · No notifications
                    </div>
                  )}

                  <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                    Swipe up or tap notification to unlock
                  </div>
                </div>
              )}

              {/* PAYMENT CHECKOUT PORTAL VIEW */}
              {phoneScreen === 'payment' && (
                <div className="phone-portal-view">
                  <div className="phone-portal-header">
                    <button 
                      className="phone-portal-back"
                      onClick={() => {
                        setPhoneScreen('lock');
                        setSelectedOrderId(null);
                        setPaymentState('idle');
                      }}
                    >
                      <ArrowLeft size={12} /> Lock Screen
                    </button>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-500)' }}>Worldpay</span>
                  </div>

                  {paymentState === 'scanning' && (
                    <div className="phone-faceid-spinner">
                      <div className="spinner-ring" />
                      <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        Contacting Worldpay Gateway...
                      </span>
                    </div>
                  )}

                  {paymentState === 'success' && (
                    <div className="phone-faceid-spinner" style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', padding: 8, borderRadius: 9999, background: 'rgba(29,158,117,0.15)', marginBottom: 8 }}>
                        <CheckCircle size={32} className="text-green" />
                      </div>
                      <span className="text-sm font-bold text-green" style={{ display: 'block' }}>
                        Payment Confirmed!
                      </span>
                      <span className="text-xs text-muted" style={{ marginTop: 2 }}>
                        Order submitted to supplier.
                      </span>
                    </div>
                  )}

                  {paymentState === 'idle' && activeCheckoutOrder && (
                    <div className="flex flex-col justify-between" style={{ flex: 1 }}>
                      <div style={{ overflowY: 'auto' }}>
                        <div style={{ textAlign: 'center', margin: '8px 0 16px' }}>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
                            HHH PHARMACY BILLING
                          </div>
                          <div style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>
                            {money(activeCheckoutOrder.payment.amount)}
                          </div>
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12, fontSize: 11, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 12 }}>
                          <div className="flex justify-between" style={{ marginBottom: 6 }}>
                            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Patient</span>
                            <span className="font-semibold">{checkoutPatient?.name}</span>
                          </div>
                          <div className="flex justify-between" style={{ marginBottom: 6 }}>
                            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Reference</span>
                            <span className="font-semibold" style={{ fontSize: 9 }}>{activeCheckoutOrder.payment.ref}</span>
                          </div>
                          <div className="flex justify-between">
                            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Shipment Carrier</span>
                            <span className="font-semibold">DPD Direct</span>
                          </div>
                        </div>

                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                          Prescription Items
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {activeCheckoutOrder.prescriptions.flatMap(rx => rx.items).map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 4 }}>
                              <div style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', paddingRight: 8 }}>
                                {item.name}
                              </div>
                              <div style={{ fontWeight: 600 }}>
                                {item.qty}x
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Interactive slide to pay track */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                          <ShieldCheck size={11} className="text-green" />
                          <span>Secure 3D-L2 Worldpay Connection</span>
                        </div>

                        <div className="slide-pay-track">
                          <div className="slide-pay-progress" style={{ width: `${sliderVal}%` }} />
                          <span className="slide-pay-label">
                            {sliderVal > 15 ? '' : 'Swipe to pay'}
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={sliderVal}
                            onChange={handleSliderChange}
                            onMouseUp={handleSliderRelease}
                            onTouchEnd={handleSliderRelease}
                            style={{
                              position: 'absolute',
                              width: '100%',
                              height: '100%',
                              opacity: 0,
                              cursor: 'pointer',
                              zIndex: 5
                            }}
                          />
                          <div 
                            className="slide-pay-handle" 
                            style={{ 
                              transform: `translateX(${Math.min(sliderVal * 2.3, 202)}px)`, 
                              transition: sliderVal === 0 ? 'transform 0.2s ease' : 'none' 
                            }}
                          >
                            ➔
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
