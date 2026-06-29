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
      <div style={{
        maxWidth: 680,
        margin: '60px auto',
        fontFamily: 'var(--font-family)',
      }}>
        {/* Portal card wrapper */}
        <div style={{
          background: 'rgba(18, 24, 41, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          borderRadius: '24px',
          padding: '40px 32px',
          boxShadow: 'var(--shadow-lg), 0 0 40px rgba(16, 185, 129, 0.05)',
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--green-600) 0%, var(--green-700) 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 26,
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.25)'
            }}>
              {PHARMACY.logoText}
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>{PHARMACY.name}</h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>Patient Treatment &amp; Prescription Portal</p>
          </div>

          {errorMsg && (
            <div className="banner banner-red" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '10px 14px' }}>
              <AlertCircle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Interactive Demo Personas Selector */}
          <div style={{ marginBottom: 28 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: 12, letterSpacing: '0.05em' }}>
              Quick Demo Accounts (Click to Log In)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }} className="portal-grid">
              
              {/* Persona 1: Mohammed Khan */}
              <div 
                onClick={() => attemptLogin('m.khan@email.com')}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
                className="gateway-card-hover"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>Mohammed Khan</span>
                  <span className="pill pill-amber" style={{ fontSize: 9 }}>Awaiting Pay</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>m.khan@email.com</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginTop: 4 }}>Outstanding Order: <b>£79.00</b></span>
              </div>

              {/* Persona 2: Aisha Smith */}
              <div 
                onClick={() => attemptLogin('a.smith@email.com')}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
                className="gateway-card-hover"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>Aisha Smith</span>
                  <span className="pill pill-green" style={{ fontSize: 9 }}>Meds Ready</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>a.smith@email.com</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginTop: 4 }}>Counter Collection Pass Active</span>
              </div>

            </div>
          </div>

          <div style={{ height: '1px', background: 'var(--border)', margin: '24px 0' }} />

          {/* Form input login */}
          <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Or log in with your email address
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="patient@example.com"
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: '#090D1A',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  outline: 'none',
                  fontSize: 14
                }}
              />
              <button 
                className="btn btn-primary" 
                style={{ padding: '0 20px', display: 'inline-flex', gap: 8, whiteSpace: 'nowrap' }} 
                onClick={() => attemptLogin()}
              >
                Log In <ArrowRight size={16} />
              </button>
            </div>
          </div>

          {/* Security details info */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
            <Shield size={14} className="text-muted" />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>NHS patient data sharing and GDPR compliance standards applied.</span>
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
  
  const activeOrder = state.orders.find(o => o.patientId === pId);
  const pName = crmObj ? crmObj.name : (submission ? submission.name : 'Patient');

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 60, fontFamily: 'var(--font-family)' }}>
      
      {/* ── App Shell Header ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-sidebar)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '16px 24px',
        marginBottom: 24,
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--green-600) 0%, var(--green-700) 100%)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 20
          }}>
            {PHARMACY.logoText}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#fff' }}>{pName}</h2>
              {crmObj ? (
                <span className="pill pill-green" style={{ fontSize: 10 }}>Registered Care</span>
              ) : (
                <span className="pill pill-info" style={{ fontSize: 10 }}>Pre-Screening Stage</span>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Logged into {PHARMACY.name} &middot; {email}</span>
          </div>
        </div>

        <button className="btn btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px' }} onClick={handleLogout}>
          <LogOut size={14} /> Log Out &amp; Exit
        </button>
      </div>

      {/* ── Dashboard Content Layout Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }} className="portal-grid">
        
        {/* LEFT COLUMN: ACTIVE CARE & TIMELINES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* 1. Secure billing checker / counters */}
          {activeOrder && (
            <div className="card card-surface" style={{ padding: 24, margin: 0, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CreditCard size={18} className="text-info" /> Active Prescription Billing &amp; Invoicing
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Order ID: #{activeOrder.id}</span>
              </div>

              {activeOrder.payment.status === 'sent' ? (
                <div>
                  <div className="banner banner-amber" style={{ display: 'flex', gap: 12, padding: '12px 14px', marginBottom: 20 }}>
                    <Clock size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Worldpay Payment Link Active</h4>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Your specialist clinician has uploaded the digital prescription. Secure Worldpay settlement is required to release the pharmaceutical cargo from the Wholesaler.
                      </p>
                    </div>
                  </div>

                  <div style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Wholesale Invoice Amount:</span>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{money(activeOrder.payment.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Dispensing Counter Fee:</span>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Included (£0.00)</span>
                    </div>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                      <span style={{ color: '#fff' }}>Total Amount Due:</span>
                      <span style={{ color: 'var(--green-100)', fontSize: 18 }}>{money(activeOrder.payment.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>Billing Gateway:</span>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Worldpay API Secure Checkout</span>
                    </div>

                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700, marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }} 
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
            <div className="card card-surface" style={{ padding: 24, margin: 0, border: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginTop: 0, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'rgba(16, 185, 129, 0.05)', padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--green-500)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0
                  }}>
                    <Check size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fff' }}>CRM Registration Fully Active</h4>
                    <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>
                      Your clinical intake has completed successfully. You are officially registered in the local pharmacy network.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: SERVICES, TREATMENTS, SECURITY */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* A. Quick Patient Service Requests */}
          <div className="card card-surface" style={{ padding: 20, margin: 0, border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginTop: 0, marginBottom: 16 }}>
              Pharmacy Care Desk
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 16 }}>
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

          {/* B. Prescribed items list */}
          {activeOrder && activeOrder.prescriptions.length > 0 && (
            <div className="card card-surface" style={{ padding: 20, margin: 0, border: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginTop: 0, marginBottom: 16 }}>
                Prescribed Products
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeOrder.prescriptions[0].items.map(item => (
                  <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 8 }}>
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

          {/* C. Trust / NHS Info */}
          <div className="card card-surface" style={{ padding: 16, margin: 0, border: '1px solid var(--border)', background: 'transparent' }}>
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
