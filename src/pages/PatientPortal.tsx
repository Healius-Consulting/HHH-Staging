import { useState } from 'react';
import { useApp, money, PHARMACY } from '../context/AppContext';
import { 
  LogOut, AlertCircle, CreditCard, Clock, CheckCircle, 
  Clipboard, Shield, ArrowRight, Check, Barcode
} from 'lucide-react';

export default function PatientPortal() {
  const { state, dispatch } = useApp();
  const [emailInput, setEmailInput] = useState('m.khan@email.com');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const attemptLogin = (emailStr?: string) => {
    setErrorMsg(null);
    const email = (emailStr || emailInput).trim().toLowerCase();
    if (!email) {
      setErrorMsg('Please enter your email.');
      return;
    }

    const submission = state.submissions.find(s => s.email.toLowerCase() === email);
    const crmObj = state.crm.find(p => p.email.toLowerCase() === email);
    const hasOrders = state.orders.some(o => {
      const pObj = state.crm.find(c => c.id === o.patientId);
      return pObj && pObj.email.toLowerCase() === email;
    });

    if (!submission && !crmObj && !hasOrders) {
      setErrorMsg('No records found for this email. Please check the spelling or submit a pre-screening form first.');
      return;
    }

    dispatch({ type: 'SET_PATIENT_EMAIL', email });
  };

  const handleLogout = () => {
    dispatch({ type: 'LOGOUT_PATIENT' });
  };

  const simulatePatientPayment = (orderId: number) => {
    dispatch({ type: 'CONFIRM_PAYMENT', orderId });
    dispatch({ type: 'PLACE_ORDER', orderId });
    
    const orderObj = state.orders.find(o => o.id === orderId);
    const patientObj = orderObj?.patientId ? state.crm.find(p => p.id === orderObj.patientId) : null;
    const name = patientObj?.name ?? 'Marcus Vance';

    dispatch({
      type: 'ADD_TOAST',
      message: `Worldpay Gateway: Payment of £${orderObj?.payment.amount.toFixed(2)} processed securely for ${name}. Order dispatched to Curaleaf wholesaler.`,
      toastType: 'success'
    });
  };

  // ═══════════════════════════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════
  if (!state.patientEmail) {
    return (
      <div className="patient-shell">
        <div className="patient-panel">
          <div className="patient-hero">
            <div className="patient-hero__logo">{PHARMACY.logoText}</div>
            <h1 className="patient-hero__title">{PHARMACY.name}</h1>
            <p className="patient-hero__subtitle">Patient Treatment &amp; Prescription Portal</p>
          </div>

          {errorMsg && (
            <div className="banner banner-red patient-error">
              <AlertCircle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="persona-section">
            <span className="persona-section__label">Quick Demo Accounts (Click to Log In)</span>
            <div className="persona-grid">
              <div className="persona-card gateway-card-hover" onClick={() => attemptLogin('m.khan@email.com')}>
                <div className="persona-card__head">
                  <span className="persona-card__name">Mohammed Khan</span>
                  <span className="pill pill-amber persona-pill">Awaiting Pay</span>
                </div>
                <span className="persona-card__email">m.khan@email.com</span>
                <span className="persona-card__meta">Outstanding Order: <b>£79.00</b></span>
              </div>

              <div className="persona-card gateway-card-hover" onClick={() => attemptLogin('a.smith@email.com')}>
                <div className="persona-card__head">
                  <span className="persona-card__name">Aisha Smith</span>
                  <span className="pill pill-green persona-pill">Meds Ready</span>
                </div>
                <span className="persona-card__email">a.smith@email.com</span>
                <span className="persona-card__meta">Counter Collection Pass Active</span>
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="patient-login-form">
            <label className="form-label">Or log in with your email address</label>
            <div className="patient-login-row">
              <input
                type="email"
                className="input"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="patient@example.com"
              />
              <button className="btn btn-primary patient-login-btn" onClick={() => attemptLogin()}>
                Log In <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className="patient-security">
            <Shield size={14} className="text-muted" />
            <span>NHS patient data sharing and GDPR compliance standards applied.</span>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // LOGGED-IN PORTAL DASHBOARD
  // ═══════════════════════════════════════════════════════════
  const email = state.patientEmail.toLowerCase();
  const submission = state.submissions.find(s => s.email.toLowerCase() === email);
  const crmObj = state.crm.find(p => p.email.toLowerCase() === email);
  const pId = crmObj ? crmObj.id : null;
  
  // Find active orders for this patient
  const activeOrder = state.orders.find(o => o.patientId === pId);
  const pName = crmObj ? crmObj.name : (submission ? submission.name : 'Patient');

  // Find all orders for this patient sorted by date descending
  const patientOrders = state.orders
    .filter(o => o.patientId === pId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const currentOrder = patientOrders[0];
  const pastOrders = patientOrders.slice(1);

  const getRepeatEligibility = () => {
    if (patientOrders.length === 0) return null;
    const latest = patientOrders[0];
    const latestDate = new Date(latest.date);
    const nextEligibleDate = new Date(latestDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const diffTime = nextEligibleDate.getTime() - Date.now();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return {
        status: 'eligible',
        label: '🟢 Eligible for Repeat Reorder',
        desc: `It has been ${Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24))} days since your last order. You can request a repeat assessment below.`
      };
    } else {
      return {
        status: 'pending',
        label: `⏳ Next Repeat Opens in ${diffDays} Days`,
        desc: `Eligible from ${nextEligibleDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} (30-day clinical cycle).`
      };
    }
  };
  const eligibility = getRepeatEligibility();

  return (
    <div className="patient-app">
      <div className="patient-app-header">
        <div className="patient-app-header__brand">
          <div className="patient-app-header__logo">{PHARMACY.logoText}</div>
          <div>
            <h2 className="patient-app-header__name">
              {pName}
              {crmObj ? (
                <span className="pill pill-green persona-pill">Registered Care</span>
              ) : (
                <span className="pill pill-info persona-pill">Pre-Screening Stage</span>
              )}
            </h2>
            <span className="patient-app-header__meta">Logged into {PHARMACY.name} &middot; {email}</span>
          </div>
        </div>

        <button className="btn btn-sm flex items-center gap-sm" onClick={handleLogout}>
          <LogOut size={14} /> Log Out &amp; Exit
        </button>
      </div>

      <div className="patient-app-grid">
        <div className="patient-app-col">
          
          {/* 1. Secure billing checker / counters */}
          {activeOrder && (
            <div className="card card-surface patient-card-section">
              <div className="patient-section-head">
                <h3 className="patient-section-title">
                  <CreditCard size={18} className="text-info" /> Active Prescription Billing &amp; Invoicing
                </h3>
                <span className="text-xs text-tertiary">Order ID: #{activeOrder.id}</span>
              </div>

              {activeOrder.payment.status === 'sent' ? (
                <div>
                  <div className="banner banner-amber flex gap-sm" style={{ marginBottom: 20 }}>
                    <Clock size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <h4 className="font-semibold text-sm" style={{ margin: 0 }}>Worldpay Payment Link Active</h4>
                      <p className="text-xs text-secondary" style={{ margin: '2px 0 0', lineHeight: 1.5 }}>
                        Your specialist clinician has uploaded the digital prescription. Secure Worldpay settlement is required to release the pharmaceutical cargo from the Wholesaler.
                      </p>
                    </div>
                  </div>

                  <div className="invoice-panel">
                    <div className="invoice-line">
                      <span>Wholesale Invoice Amount:</span>
                      <strong>{money(activeOrder.payment.amount)}</strong>
                    </div>
                    <div className="invoice-line">
                      <span>Dispensing Counter Fee:</span>
                      <strong>Included (£0.00)</strong>
                    </div>
                    <div className="divider" style={{ margin: '4px 0' }} />
                    <div className="invoice-total">
                      <span>Total Amount Due:</span>
                      <span>{money(activeOrder.payment.amount)}</span>
                    </div>
                    <div className="invoice-line">
                      <span>Billing Gateway:</span>
                      <strong>Worldpay API Secure Checkout</strong>
                    </div>

                    <button 
                      className="btn btn-primary invoice-pay-btn" 
                      onClick={() => simulatePatientPayment(activeOrder.id)}
                    >
                      <CreditCard size={18} /> Pay Invoice via Worldpay Gateway
                    </button>
                  </div>
                </div>
              ) : activeOrder.payment.status === 'paid' ? (
                <div>
                  <div className="banner banner-green" style={{ display: 'flex', gap: 12, padding: '12px 14px', marginBottom: 20 }}>
                    <CheckCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Worldpay Payment Cleared &amp; Confirmed</h4>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                        Transaction ref: <b>{activeOrder.payment.ref || 'WP-8812'}</b> cleared. Prescriptions checked in with the Curaleaf fulfillment wholesaler.
                      </p>
                    </div>
                  </div>

                  {activeOrder.prescriptions.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      {/* Render tracking statuses for the first sub-order */}
                      {(() => {
                        const rx = activeOrder.prescriptions[0];
                        const rxStages = ['approved', 'dispatched', 'ready', 'collected'];
                        const rxLabels = ['Prescription Checked & Approved', 'Dispatched (In Transit)', 'Ready for Counter Pickup', 'Collected from Counter'];
                        const rxDescs = [
                          'Specialist digital copy received and cleared by counter staff.',
                          `Dispatched from Curaleaf wholesaler. Tracking Code: ${rx.trackingNumber || 'DPD-Pending'} via DPD Courier.`,
                          'Dispensing checked in at local counter. Ready for counter pickup.',
                          'Prescription successfully claimed and checked out.'
                        ];
                        const curIdx = rxStages.indexOf(rx.status);

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 12px' }}>
                            {rxLabels.map((label, i) => {
                              let isDone = i < curIdx || (rx.status === 'collected' && i === curIdx);
                              let isActive = i === curIdx;

                              return (
                                <div key={label} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                                  {/* Connector Line */}
                                  {i < 3 && (
                                    <div style={{
                                      position: 'absolute',
                                      left: 11,
                                      top: 22,
                                      bottom: -22,
                                      width: 2,
                                      background: i < curIdx ? 'var(--green-500)' : 'var(--border)',
                                      zIndex: 0
                                    }} />
                                  )}
                                  
                                  {/* Milestone Ring */}
                                  <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    background: isDone ? 'var(--green-500)' : 'var(--bg-root)',
                                    border: isDone ? '2px solid var(--green-500)' : (isActive ? '2px solid var(--green-500)' : '2px solid var(--border)'),
                                    color: isDone ? '#fff' : (isActive ? 'var(--green-100)' : 'var(--text-secondary)'),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    boxShadow: isActive ? '0 0 10px rgba(16, 185, 129, 0.4)' : 'none',
                                    zIndex: 1,
                                    flexShrink: 0
                                  }}>
                                    {isDone ? <Check size={12} /> : i + 1}
                                  </div>

                                  <div style={{ flex: 1 }}>
                                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: (isDone || isActive) ? '#fff' : 'var(--text-secondary)' }}>{label}</h4>
                                    <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.4 }}>{rxDescs[i]}</p>
                                  </div>
                                </div>
                              );
                            })}

                            {/* Counter Barcode Boarding Pass */}
                            {rx.status === 'ready' && (
                              <div style={{
                                background: '#FFFFFF',
                                color: '#090D1A',
                                borderRadius: '16px',
                                padding: '20px',
                                marginTop: '16px',
                                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                                borderLeft: '5px solid var(--green-500)',
                                position: 'relative',
                                overflow: 'hidden'
                              }}>
                                {/* Pass styling dots */}
                                <div style={{ position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-surface)' }} />
                                <div style={{ position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-surface)' }} />

                                <div style={{ textAlign: 'center' }}>
                                  <span style={{ fontSize: 10, fontWeight: 800, color: '#64748B', display: 'block', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                                    Pharmacy Dispensing Pass
                                  </span>
                                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                                    <Barcode size={32} style={{ color: '#000' }} />
                                    <span style={{
                                      fontFamily: 'monospace',
                                      fontWeight: 800,
                                      fontSize: 22,
                                      letterSpacing: 4,
                                      color: '#000'
                                    }}>
                                      HH-{activeOrder.id}-{rx.id}
                                    </span>
                                  </div>
                                  <p style={{ fontSize: 12, margin: '8px 0 0', color: '#475569', fontWeight: 500 }}>
                                    Present this barcode at the counter to retrieve your prescription.
                                  </p>
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })()}
                    </div>
                  )}

                </div>
              ) : null}
            </div>
          )}

          {/* 2. Clinical Referral Checklist (Pre-screening Flow) */}
          {(submission || crmObj) && (
            <div className="card card-surface patient-card-section">
              <h3 className="patient-section-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
                <Clipboard size={18} className="text-info" /> Clinical Eligibility Intake Roadmap
              </h3>
              
              {submission ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingLeft: 8 }}>
                  {['New', 'Records uploaded', 'Referred to clinic', 'Completed'].map((stage, i) => {
                    const stages = ['New', 'Records uploaded', 'Referred to clinic', 'Completed'];
                    const labels = ['Referral Enquiry Created', 'Clinical Health Files Uploaded', 'Referred to Specialist Clinic', 'Approved & Registered in CRM'];
                    const descs = [
                      'Pre-screening form submitted. Medical records verification pending.',
                      'OCR parsed medical history, verifying tried/failed criteria.',
                      'Eligibility cleared. Folder referred to specialist doctor clinic.',
                      'B2B reference confirmed. Patient profile created in CRM.'
                    ];
                    
                    const currentIdx = stages.indexOf(submission.status);
                    let isDone = i < currentIdx || (submission.status === 'Completed' && i === currentIdx);
                    let isActive = i === currentIdx;

                    return (
                      <div key={stage} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                        {/* Vertical line connector */}
                        {i < 3 && (
                          <div style={{
                            position: 'absolute',
                            left: 11,
                            top: 22,
                            bottom: -22,
                            width: 2,
                            background: i < currentIdx ? 'var(--green-500)' : 'var(--border)'
                          }} />
                        )}

                        <div style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: isDone ? 'var(--green-500)' : 'var(--bg-root)',
                          border: isDone ? '2px solid var(--green-500)' : (isActive ? '2px solid var(--green-500)' : '2px solid var(--border)'),
                          color: isDone ? '#fff' : (isActive ? 'var(--green-100)' : 'var(--text-secondary)'),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          boxShadow: isActive ? '0 0 8px rgba(16, 185, 129, 0.3)' : 'none',
                          zIndex: 1,
                          flexShrink: 0
                        }}>
                          {isDone ? <Check size={12} /> : i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: (isDone || isActive) ? '#fff' : 'var(--text-secondary)' }}>{labels[i]}</h4>
                          <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.4 }}>{descs[i]}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="crm-complete-banner">
                  <div className="crm-complete-banner__icon">
                    <Check size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 className="font-semibold text-sm" style={{ margin: 0 }}>CRM Registration Fully Active</h4>
                    <p className="text-xs text-secondary" style={{ margin: '2px 0 0' }}>
                      Your clinical intake has completed successfully. You are officially registered in the local pharmacy network.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: SERVICES, TREATMENTS, SECURITY */}
        <div className="patient-app-col">
          <div className="card card-surface patient-card-section">
            <h3 className="patient-sidebar-title">Pharmacy Care Desk</h3>
            <p className="text-xs text-secondary" style={{ lineHeight: 1.4, marginBottom: 16 }}>
              Alert your counter staff or schedule a follow-up medical cannabis assessment in one click:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              
              {/* Repeat Rx request */}
              <button
                className="btn btn-sm"
                disabled={!crmObj}
                style={{ 
                  padding: '12px 14px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'flex-start', 
                  height: 'auto', 
                  width: '100%', 
                  textAlign: 'left',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'var(--border)'
                }}
                onClick={() => {
                  if (!crmObj) return;
                  dispatch({
                    type: 'LOG_INTERACTION',
                    patientId: crmObj.id,
                    interactionType: 'Repeat Requested',
                    detail: 'Patient requested repeat prescription copy of previous order via patient portal.'
                  });
                  dispatch({
                    type: 'ADD_TOAST',
                    message: 'Repeat prescription request submitted to pharmacy dashboard.',
                    toastType: 'success'
                  });
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔁 Request Repeat Rx
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Order copy of last verified meds</span>
              </button>

              {/* Follow-up / Appointment request */}
              <button
                className="btn btn-sm"
                disabled={!crmObj}
                style={{ 
                  padding: '12px 14px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'flex-start', 
                  height: 'auto', 
                  width: '100%', 
                  textAlign: 'left',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'var(--border)'
                }}
                onClick={() => {
                  if (!crmObj) return;
                  dispatch({
                    type: 'LOG_INTERACTION',
                    patientId: crmObj.id,
                    interactionType: 'Appointment Requested',
                    detail: 'Patient requested check-up call/appointment scheduling via patient portal.'
                  });
                  dispatch({
                    type: 'ADD_TOAST',
                    message: 'Check-up callback request submitted to pharmacy dashboard.',
                    toastType: 'success'
                  });
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                  📅 Schedule Check-up Call
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Request call with pharmacist</span>
              </button>

              {!crmObj && (
                <div className="banner banner-info" style={{ margin: 0, padding: 8, fontSize: 11 }}>
                  Requests will activate once clinician pre-screening verification completes.
                </div>
              )}
            </div>
          </div>

          {/* B. Repeat Eligibility Card */}
          {eligibility && (
            <div className="card card-surface patient-card-section">
              <h3 className="patient-sidebar-title">Repeat Reorder Schedule</h3>
              <div className="flex flex-col gap-sm">
                <span className={`font-semibold text-sm ${eligibility.status === 'eligible' ? 'text-green' : 'text-amber'}`}>
                  {eligibility.label}
                </span>
                <span className="text-xs text-secondary" style={{ lineHeight: 1.4 }}>
                  {eligibility.desc}
                </span>
              </div>
            </div>
          )}

          {currentOrder && (
            <div className="card card-surface patient-card-section">
              <h3 className="patient-sidebar-title">
                Current Prescription ({new Date(currentOrder.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {currentOrder.prescriptions.flatMap(rx => rx.items).map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 8 }}>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: '#fff', display: 'block' }}>{item.name}</span>
                      <span style={{ color: 'var(--text-tertiary)', display: 'block', marginTop: 2 }}>Qty: {item.qty} &times; 10g/30ml</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-100)' }}>{money(item.retail * item.qty)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* D. Past Prescriptions History Card */}
          <div className="card card-surface patient-card-section">
            <h3 className="patient-sidebar-title">Prescription History</h3>
            {pastOrders.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: '10px 0' }}>
                No past prescriptions on file.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pastOrders.map(order => {
                  const itemsSummary = order.prescriptions.flatMap(rx => rx.items).map(i => `${i.name} (x${i.qty})`).join(', ');
                  const dateStr = new Date(order.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  return (
                    <div key={order.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{dateStr}</span>
                        <span className="pill pill-neutral" style={{ fontSize: 9 }}>Order #{order.id}</span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 260 }} title={itemsSummary}>
                        {itemsSummary}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Total billing: <b>{money(order.prescriptions.reduce((t, r) => t + r.items.reduce((s, i) => s + i.retail * i.qty, 0), 0))}</b></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* C. Trust / NHS Info */}
          <div className="card card-surface patient-card-section" style={{ background: 'transparent' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Shield size={16} className="text-info" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>Clinical Governance Guard</strong><br />
                All medical cannabis assessments are handled by GMC-registered clinicians in accordance with UK home office regulations.
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
