import { useState } from 'react';
import { useApp, money, PHARMACY } from '../context/AppContext';
import { LogOut, AlertCircle } from 'lucide-react';

export default function PatientPortal() {
  const { state, dispatch } = useApp();
  const [emailInput, setEmailInput] = useState('marcus.v@gmail.com');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const attemptLogin = () => {
    setErrorMsg(null);
    const email = emailInput.trim().toLowerCase();
    if (!email) {
      setErrorMsg('Please enter your email.');
      return;
    }

    // Check if patient exists in submissions or CRM
    const submission = state.submissions.find(s => s.email.toLowerCase() === email);
    const crmObj = state.crm.find(p => p.email.toLowerCase() === email);
    const hasOrders = state.orders.some(o => {
      const pObj = state.crm.find(c => c.id === o.patientId);
      return pObj && pObj.email.toLowerCase() === email;
    });

    if (!submission && !crmObj && !hasOrders) {
      setErrorMsg('No records found for this email. Please submit an eligibility form first.');
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
    
    // Fetch info for toast
    const orderObj = state.orders.find(o => o.id === orderId);
    const patientObj = orderObj?.patientId ? state.crm.find(p => p.id === orderObj.patientId) : null;
    const name = patientObj?.name ?? 'Marcus Vance';

    dispatch({
      type: 'ADD_TOAST',
      message: `Patient Portal: Worldpay invoice paid securely by patient ${name} (£${orderObj?.payment.amount.toFixed(2)}).`,
      toastType: 'success'
    });
  };

  // If patient not logged in
  if (!state.patientEmail) {
    return (
      <div style={{
        maxWidth: 440,
        margin: '80px auto',
        padding: '32px 24px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
        textAlign: 'center'
      }}>
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1.5px dashed var(--color-primary)',
          color: 'var(--color-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 20,
          margin: '0 auto 16px'
        }}>
          {PHARMACY.logoText}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{PHARMACY.name}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 24px' }}>Patient Treatment Portal</p>

        {errorMsg && (
          <div className="banner banner-red" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Enter your email address</label>
          <input
            type="email"
            className="fi"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            placeholder="patient@example.com"
            style={{
              width: '100%',
              padding: '12px 14px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: '#090D1A',
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Demo hint: Try <b>marcus.v@gmail.com</b> or submit a new enquiry to test.</span>
        </div>

        <button className="btn btn-primary" style={{ width: '100%', padding: 12 }} onClick={attemptLogin}>
          Log In to Portal
        </button>
      </div>
    );
  }

  const email = state.patientEmail.toLowerCase();
  const submission = state.submissions.find(s => s.email.toLowerCase() === email);
  const crmObj = state.crm.find(p => p.email.toLowerCase() === email);
  const pId = crmObj ? crmObj.id : null;
  
  // Find active orders for this patient
  const activeOrder = state.orders.find(o => o.patientId === pId);
  const pName = crmObj ? crmObj.name : (submission ? submission.name : 'Patient');

  return (
    <div style={{ maxWidth: 640, margin: '20px auto', paddingBottom: 40 }}>
      {/* Header card */}
      <div className="card card-surface" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid var(--color-primary)',
            color: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16
          }}>
            {PHARMACY.logoText}
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{pName}</h2>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Logged into {PHARMACY.name}</span>
          </div>
        </div>
        <button className="btn btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleLogout}>
          <LogOut size={13} /> Exit Portal
        </button>
      </div>

      {/* 1. Intake Status */}
      {(submission || crmObj) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginTop: 0, marginBottom: 16 }}>
            Eligibility Referral Progress
          </h3>
          
          {submission ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {['New', 'Records uploaded', 'Referred to clinic', 'Completed'].map((stage, i) => {
                const stages = ['New', 'Records uploaded', 'Referred to clinic', 'Completed'];
                const labels = ['Referral Enquiry Created', 'Clinical Health Files Uploaded', 'Referred to Specialist Clinic', 'Approved & Registered in CRM'];
                const descs = [
                  'Enquiry submitted. Awaiting document scanner upload.',
                  'OCR parsed patient clinical files, verifying eligibility criteria.',
                  'Intake referred to doctor for final clinical check-off.',
                  'Approved by doctor. Patient record successfully generated.'
                ];
                
                const currentIdx = stages.indexOf(submission.status);
                let isDone = i < currentIdx || (submission.status === 'Completed' && i === currentIdx);
                let isActive = i === currentIdx;

                return (
                  <div key={stage} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: isDone ? 'var(--color-primary)' : 'var(--bg-root)',
                      border: isDone ? '2px solid var(--color-primary)' : (isActive ? '2px solid var(--color-primary)' : '2px solid var(--border)'),
                      color: isDone ? '#fff' : (isActive ? 'var(--color-primary)' : 'var(--text-secondary)'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      boxShadow: isActive ? '0 0 8px var(--color-primary)' : 'none',
                      zIndex: 1
                    }}>
                      {isDone ? '✓' : i + 1}
                    </div>
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: (isDone || isActive) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{labels[i]}</h4>
                      <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>{descs[i]}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--color-primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12
              }}>
                ✓
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>CRM Intake Completed</h4>
                <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>Your profile is fully active. You are registered under ID: <strong>{crmObj?.id}</strong>.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Active Orders & Prescriptions */}
      {activeOrder && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginTop: 0, marginBottom: 16 }}>
            Active Prescription &amp; Delivery Tracking
          </h3>

          {activeOrder.payment.status === 'sent' ? (
            <div>
              <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: '2px solid var(--color-primary)',
                  boxShadow: '0 0 8px var(--color-primary)',
                  background: 'var(--bg-root)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 'bold'
                }}>
                  !
                </div>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Awaiting Payment Clearance</h4>
                  <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: 12 }}>Your consultant doctor has issued a digital prescription. Secure payment is required to release the wholesaler shipment.</p>
                </div>
              </div>

              <div style={{ background: '#090D1A', border: '1px dashed var(--border)', borderRadius: '8px', padding: 16, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Payment Reference:</span>
                  <span style={{ fontWeight: 600 }}>{activeOrder.payment.ref || 'Pending'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Requested Amount:</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{money(activeOrder.payment.amount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Invoice Status:</span>
                  <span className="pill pill-amber" style={{ fontSize: 9 }}>Awaiting Payment</span>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => simulatePatientPayment(activeOrder.id)}>
                  💳 Pay Invoice Securely (Worldpay Sim)
                </button>
              </div>
            </div>
          ) : activeOrder.payment.status === 'paid' ? (
            <div>
              {activeOrder.prescriptions.length === 0 ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12
                  }}>
                    ✓
                  </div>
                  <div style={{ flex: 1, fontSize: 13 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Order Cleared</h4>
                    <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>Worldpay transaction confirmed. Prescription is being submitted to the Curaleaf wholesaler.</p>
                  </div>
                </div>
              ) : (
                <div>
                  {/* Render tracking statuses for the first active sub-order */}
                  {(() => {
                    const rx = activeOrder.prescriptions[0];
                    const rxStages = ['approved', 'dispatched', 'ready', 'collected'];
                    const rxLabels = ['Order Approved', 'Dispatched (In Transit)', 'Ready for Collection', 'Collected'];
                    const rxDescs = [
                      'Prescription cleared and approved by pharmacy team.',
                      `Shipped via DPD Courier. Tracking Code: ${rx.trackingNumber || 'Pending'}`,
                      'Box safely received at pharmacy. Ready for pickup.',
                      'Collected from pharmacy collection counter.'
                    ];
                    const curIdx = rxStages.indexOf(rx.status);

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {rxLabels.map((label, i) => {
                          let isDone = i < curIdx || (rx.status === 'collected' && i === curIdx);
                          let isActive = i === curIdx;

                          return (
                            <div key={label} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                              <div style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                background: isDone ? 'var(--color-primary)' : 'var(--bg-root)',
                                border: isDone ? '2px solid var(--color-primary)' : (isActive ? '2px solid var(--color-primary)' : '2px solid var(--border)'),
                                color: isDone ? '#fff' : (isActive ? 'var(--color-primary)' : 'var(--text-secondary)'),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                fontWeight: 700,
                                boxShadow: isActive ? '0 0 8px var(--color-primary)' : 'none',
                                zIndex: 1
                              }}>
                                {isDone ? '✓' : i + 1}
                              </div>
                              <div style={{ flex: 1, fontSize: 13 }}>
                                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: (isDone || isActive) ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</h4>
                                <p style={{ margin: '2px 0 0', color: 'var(--text-tertiary)', fontSize: 12 }}>{rxDescs[i]}</p>
                              </div>
                            </div>
                          );
                        })}

                        {/* Barcode box for counter collection */}
                        {rx.status === 'ready' && (
                          <div style={{
                            textAlign: 'center',
                            padding: '16px',
                            background: '#fff',
                            color: '#000',
                            borderRadius: '8px',
                            marginTop: '14px'
                          }}>
                            <span style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--text-tertiary)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Pharmacy Collection Pass</span>
                            <div style={{
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                              fontSize: 20,
                              letterSpacing: 6,
                              borderBottom: '3px double #000',
                              display: 'inline-block',
                              padding: '4px 10px',
                              marginBottom: 4
                            }}>
                              HH-{activeOrder.id}-{rx.id}
                            </div>
                            <p style={{ fontSize: 11, margin: '4px 0 0', color: '#64748B' }}>Show this barcode to the pharmacist at the counter to collect your prescription.</p>
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

      {/* Security note */}
      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>
        🔒 Your information is handled securely and shared only with your pharmacy and the specialist clinic.
      </p>
    </div>
  );
}
