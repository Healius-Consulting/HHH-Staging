import { useState, useMemo } from 'react';
import { Search, ChevronRight, User, ArrowLeft, Plus, CreditCard } from 'lucide-react';
import { useApp, money, orderRevenue } from '../context/AppContext';
import type { CRMPatient, EligibilitySubmission, PatientOrder } from '../context/AppContext';

/* ── Unified patient row model ── */
interface UnifiedPatient {
  id: string;
  name: string;
  email: string;
  mobile: string;
  crmPatient: CRMPatient | null;
  submission: EligibilitySubmission | null;
  orders: PatientOrder[];
}

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready'] as const;

function stepsCompleted(status: string): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'approved':          return 1;
    case 'dispatched':        return 2;
    case 'ready':             return 3;
    default:                  return -1;
  }
}

/* ── Status derivation ── */
function deriveStatus(p: UnifiedPatient): { label: string; pill: string } {
  if (p.orders.length > 0) {
    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status === 'ready'),
      )
    )
      return { label: 'Ready for collection', pill: 'pill-green' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status !== 'ready'),
      )
    )
      return { label: 'In fulfilment', pill: 'pill-info' };

    if (p.orders.some(o => o.payment.status === 'sent'))
      return { label: 'Awaiting payment', pill: 'pill-amber' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'none' &&
          o.prescriptions.some(rx => rx.items.length > 0),
      )
    )
      return { label: 'Order in progress', pill: 'pill-info' };
  }

  if (p.submission) {
    switch (p.submission.status) {
      case 'Referred to clinic':
        return { label: 'Referred to clinic', pill: 'pill-info' };
      case 'Records uploaded':
        return { label: 'Records uploaded', pill: 'pill-amber' };
      case 'New':
        return { label: 'New enquiry', pill: 'pill-red' };
      case 'Completed':
        return { label: 'Referred', pill: 'pill-green' };
    }
  }

  if (p.crmPatient) return { label: 'Referred', pill: 'pill-green' };

  return { label: '—', pill: 'pill-neutral' };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Patients() {
  const { state, dispatch } = useApp();
  const [search, setSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  /* ── Build merged patient list ── */
  const patients = useMemo(() => {
    const map = new Map<string, UnifiedPatient>();

    // Add CRM patients keyed by email
    for (const crm of state.crm) {
      const key = crm.email.toLowerCase();
      map.set(key, {
        id: crm.id,
        name: crm.name,
        email: crm.email,
        mobile: crm.mobile,
        crmPatient: crm,
        submission: null,
        orders: state.orders.filter(o => o.patientId === crm.id),
      });
    }

    // Merge submissions
    for (const sub of state.submissions) {
      const key = sub.email.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.submission = sub;
      } else {
        map.set(key, {
          id: `sub-${sub.id}`,
          name: sub.name,
          email: sub.email,
          mobile: sub.mobile,
          crmPatient: null,
          submission: sub,
          orders: [],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
  }, [state.crm, state.submissions, state.orders]);

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    if (!search.trim()) return patients;
    const q = search.toLowerCase();
    return patients.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q),
    );
  }, [patients, search]);

  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handleCreateOrder = (patient: UnifiedPatient) => {
    // If patient is a CRM patient, create order directly. Otherwise, add to CRM first
    let finalPatientId = patient.crmPatient?.id || null;
    
    if (!finalPatientId && patient.submission) {
      // Simulate adding to CRM if they are not there yet
      dispatch({ type: 'EMAIL_REFERRAL', subId: patient.submission.id });
      // Use next expected ID
      finalPatientId = 'P-' + state.nextIds.patient;
    }

    dispatch({ type: 'NEW_ORDER', patientId: finalPatientId || undefined });
    dispatch({ type: 'ADD_TOAST', message: `Created new order draft linked to ${patient.name}`, toastType: 'success' });
    dispatch({ type: 'SET_SCREEN', screen: 'create' });
  };

  const renderTrackBar = (status: string) => {
    const done = stepsCompleted(status);
    const progressWidth = done >= 0 ? done * 25 : 0;
    return (
      <div className="orders-timeline" style={{ margin: '12px 0 6px' }}>
        <div 
          className="orders-timeline-progress" 
          style={{ width: `${progressWidth}%` }} 
        />
        {TRACK_STEPS.map((label, i) => {
          let cls = 'timeline-step';
          if (i < done || (status === 'ready' && i <= done)) cls += ' done';
          else if (i === done && status !== 'ready') cls += ' active';
          return (
            <div key={label} className={cls}>
              <div className="timeline-dot" style={{ width: 18, height: 18, fontSize: 8 }}>
                {i + 1}
              </div>
              <span className="timeline-label" style={{ fontSize: 9 }}>{label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ── DETAILED VIEW ──
  if (selectedPatient) {
    const status = deriveStatus(selectedPatient);
    return (
      <div className="page-body">
        {/* Back navigation */}
        <button 
          className="btn" 
          onClick={() => setSelectedPatientId(null)}
          style={{ marginBottom: 16, gap: 6 }}
        >
          <ArrowLeft size={14} /> Back to Patients
        </button>

        {/* Profile Header Card */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="flex items-center gap-md flex-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="flex items-center gap-md">
              <div className="avatar" style={{ width: 50, height: 50, fontSize: 18 }}>{initials(selectedPatient.name)}</div>
              <div>
                <h3 className="font-bold" style={{ fontSize: 18, margin: 0 }}>{selectedPatient.name}</h3>
                <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>
                  {selectedPatient.email} &middot; {selectedPatient.mobile}
                </p>
                {selectedPatient.crmPatient?.address && (
                  <p className="text-xs text-faint" style={{ margin: '2px 0 0' }}>
                    {selectedPatient.crmPatient.address}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-md">
              <span className={`pill ${status.pill}`} style={{ fontSize: 11, padding: '6px 12px' }}>
                {status.label}
              </span>
              <button 
                className="btn btn-primary btn-sm"
                onClick={() => handleCreateOrder(selectedPatient)}
              >
                <Plus size={14} /> Create Order
              </button>
            </div>
          </div>
        </div>

        {/* Split Grid */}
        <div className="flex gap-lg flex-wrap" style={{ alignItems: 'flex-start' }}>
          
          {/* LEFT COLUMN: Order History */}
          <div style={{ flex: 1, minWidth: 320 }}>
            <h3 className="card-title" style={{ marginBottom: 12 }}>Order & Prescription History</h3>
            
            {selectedPatient.orders.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-icon"><CreditCard size={20} /></div>
                No orders placed yet. Click "Create Order" to build a prescription.
              </div>
            ) : (
              [...selectedPatient.orders]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map(order => (
                  <div className="card" key={order.id} style={{ marginBottom: 16 }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                      <span className="font-semibold text-sm">Order #{order.id}</span>
                      <span className="text-xs text-muted">{fmtDate(order.date)}</span>
                    </div>

                    <div className="kv-line" style={{ padding: '4px 0' }}>
                      <span className="text-xs text-muted">Worldpay Status</span>
                      <span className={`pill ${
                        order.payment.status === 'paid' ? 'pill-green' : 
                        order.payment.status === 'sent' ? 'pill-amber' : 'pill-neutral'
                      }`} style={{ fontSize: 9 }}>
                        {order.payment.status === 'paid' ? 'Paid' : 
                         order.payment.status === 'sent' ? 'Awaiting Payment' : 'Draft'}
                      </span>
                    </div>

                    <div className="kv-line" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                      <span className="text-xs text-muted">Total Charged</span>
                      <span className="font-semibold text-sm">{money(orderRevenue(order))}</span>
                    </div>

                    {/* Prescriptions inside this order */}
                    {order.prescriptions.map(rx => (
                      <div key={rx.id} style={{ background: 'var(--bg-surface)', padding: 10, borderRadius: 8, marginTop: 8 }}>
                        <div className="flex justify-between text-xs" style={{ marginBottom: 6 }}>
                          <span className="font-semibold text-green">Rx #{rx.id} ({rx.prescriber || 'No prescriber'})</span>
                          {rx.poRef && <span className="text-faint">{rx.poRef}</span>}
                        </div>

                        {/* Items list */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                          {rx.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-xs text-muted">
                              <span>{item.name} &times; {item.qty}</span>
                              <span>{money(item.retail * item.qty + (item.fee || 0))}</span>
                            </div>
                          ))}
                        </div>

                        {/* Stepper tracking */}
                        {rx.placed && renderTrackBar(rx.status)}
                      </div>
                    ))}
                  </div>
                ))
            )}
          </div>

          {/* RIGHT COLUMN: Referral Details / Intake logs */}
          <div style={{ width: 340, minWidth: 300 }}>
            <h3 className="card-title" style={{ marginBottom: 12 }}>CRM Referral Records</h3>
            
            {selectedPatient.submission ? (
              <div className="card">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  
                  <div>
                    <span className="text-xs text-faint" style={{ display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Medical Condition</span>
                    <span className="text-sm font-semibold text-primary">{selectedPatient.submission.condition}</span>
                  </div>

                  <div>
                    <span className="text-xs text-faint" style={{ display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Clinic Referral Ref</span>
                    <span className="text-sm font-semibold text-primary">{selectedPatient.submission.clinicRef || 'Pending assignment'}</span>
                  </div>

                  <div className="divider" style={{ margin: '4px 0' }} />

                  <div className="kv-line">
                    <span className="text-xs text-muted">Tried ≥2 treatments</span>
                    <span className={`text-xs font-semibold ${selectedPatient.submission.tried2 ? 'text-green' : 'text-red'}`}>
                      {selectedPatient.submission.tried2 ? 'Yes' : 'No'}
                    </span>
                  </div>

                  <div className="kv-line">
                    <span className="text-xs text-muted">Psychosis exclusion</span>
                    <span className={`text-xs font-semibold ${selectedPatient.submission.psychExclusion ? 'text-red' : 'text-green'}`}>
                      {selectedPatient.submission.psychExclusion ? 'Yes (Excluded)' : 'No (Passed)'}
                    </span>
                  </div>

                  <div className="divider" style={{ margin: '4px 0' }} />

                  <div className="kv-line">
                    <span className="text-xs text-muted">Intake consent</span>
                    <span className="text-xs font-semibold">
                      {selectedPatient.submission.consentReferral ? '✓ Referral' : ''} {selectedPatient.submission.consentShare ? '✓ Share' : ''}
                    </span>
                  </div>

                  <div className="kv-line">
                    <span className="text-xs text-muted">Submitted date</span>
                    <span className="text-xs">{fmtDate(selectedPatient.submission.submittedAt)}</span>
                  </div>

                  {/* Processing log */}
                  {selectedPatient.submission.calls.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <span className="text-xs font-bold text-muted" style={{ display: 'block', marginBottom: 4 }}>Call History Logs</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-surface)', padding: 8, borderRadius: 6 }}>
                        {selectedPatient.submission.calls.map((call, i) => (
                          <div key={i} className="text-xs text-muted">
                            📞 Call logged &middot; {fmtDate(call.ts)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </div>
            ) : (
              <div className="card text-muted text-sm text-center" style={{ padding: '24px 12px' }}>
                💡 Patient added directly to CRM. No eligibility submission history available.
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  // ── LIST VIEW ──
  return (
    <div className="page-body">
      <h2 className="page-title">Patients</h2>
      <p className="page-subtitle">
        Everyone who has interacted with the service — from eligibility enquiry
        through to collection.
      </p>

      {/* ══ Search ══ */}
      <div className="search-row">
        <Search size={16} />
        <input
          className="input"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ══ Count ══ */}
      <p className="text-sm text-muted" style={{ margin: '12px 0 8px' }}>
        {filtered.length} patient{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* ══ Patient rows ══ */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <User size={22} />
          </div>
          No patients match.
        </div>
      ) : (
        filtered.map(p => {
          const status = deriveStatus(p);
          return (
            <div
              key={p.id}
              className="patient-row"
              onClick={() => setSelectedPatientId(p.id)}
              style={{ cursor: 'pointer', transition: 'background var(--transition-fast)' }}
            >
              <div className="flex items-center gap-md" style={{ flex: 1 }}>
                <div className="avatar">{initials(p.name)}</div>
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-faint">
                    {p.email} · {p.mobile}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-sm">
                <span className={`pill ${status.pill}`}>{status.label}</span>
                <ChevronRight size={16} className="text-faint" />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
