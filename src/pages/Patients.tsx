import { useState, useMemo } from 'react';
import { Search, ChevronRight, Plus, X, Users, Clipboard, Package, CheckCircle } from 'lucide-react';
import { useApp, money, orderRevenue, RX_STATUS_LABELS, PHARMACY } from '../context/AppContext';
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

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready', 'Collected'] as const;

function stepsCompleted(status: string): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'approved':          return 1;
    case 'dispatched':        return 2;
    case 'ready':             return 3;
    case 'collected':         return 4;
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
          o.prescriptions.some(rx => rx.status !== 'ready' && rx.status !== 'collected'),
      )
    )
      return { label: 'In fulfilment', pill: 'pill-info' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.every(rx => rx.status === 'collected')
      )
    )
      return { label: 'Collected by patient', pill: 'pill-neutral' };

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
        return { label: 'CRM Active', pill: 'pill-green' };
    }
  }

  if (p.crmPatient) return { label: 'CRM Active', pill: 'pill-green' };

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

type FilterTab = 'all' | 'enquiries' | 'active' | 'on-order';
type SortKey = 'name' | 'status' | 'id';

export default function Patients() {
  const { state, dispatch } = useApp();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
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

    return Array.from(map.values());
  }, [state.crm, state.submissions, state.orders]);

  /* ── Filtered & Sorted list ── */
  const processedPatients = useMemo(() => {
    let list = [...patients];

    // 1. Search Query Filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          p.mobile.includes(q)
      );
    }

    // 2. Tab Filter
    if (activeTab === 'enquiries') {
      list = list.filter(p => p.submission && p.submission.status !== 'Completed');
    } else if (activeTab === 'active') {
      list = list.filter(p => p.crmPatient !== null);
    } else if (activeTab === 'on-order') {
      list = list.filter(p => 
        p.crmPatient && 
        p.orders.some(o => o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))
      );
    }

    // 3. Sorting
    if (sortKey === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    } else if (sortKey === 'status') {
      list.sort((a, b) => deriveStatus(a).label.localeCompare(deriveStatus(b).label));
    } else if (sortKey === 'id') {
      list.sort((a, b) => b.id.localeCompare(a.id));
    }

    return list;
  }, [patients, search, activeTab, sortKey]);

  const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;

  const handleCreateOrder = (patient: UnifiedPatient) => {
    let finalPatientId = patient.crmPatient?.id || null;
    
    if (!finalPatientId && patient.submission) {
      dispatch({ type: 'EMAIL_REFERRAL', subId: patient.submission.id });
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
      <div className="orders-timeline-container" style={{ margin: '8px 0' }}>
        <div className="orders-timeline" style={{ height: 16 }}>
          <div 
            className="orders-timeline-progress" 
            style={{ width: `${progressWidth}%` }} 
          />
          {TRACK_STEPS.map((label, i) => {
            let cls = 'timeline-step';
            if (i < done || (status === 'collected' && i <= done)) cls += ' done';
            else if (i === done && status !== 'collected') cls += ' active';
            return (
              <div key={label} className={cls}>
                <div className="timeline-dot" style={{ width: 14, height: 14, fontSize: 8 }}>
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Metrics counts
  const totalCRM = state.crm.length;
  const activeEnquiries = state.submissions.filter(s => s.status !== 'Completed').length;
  const onOrderCount = patients.filter(p => p.crmPatient && p.orders.some(o => o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))).length;

  return (
    <div className="page-body" style={{ position: 'relative' }}>
      
      {/* ══ Metrics Grid / Tab Switchers ══ */}
      <div className="filter-grid">
        <div className={`card card-surface filter-card ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          <div className="filter-card__head">
            <span>All Patients</span>
            <Users size={14} className={activeTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{patients.length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'enquiries' ? 'active' : ''}`} onClick={() => setActiveTab('enquiries')}>
          <div className="filter-card__head">
            <span>Enquiries</span>
            <Clipboard size={14} className={activeTab === 'enquiries' ? 'text-red' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{activeEnquiries}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <div className="filter-card__head">
            <span>Active Treatments</span>
            <CheckCircle size={14} className={activeTab === 'active' ? 'text-green' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{totalCRM}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'on-order' ? 'active' : ''}`} onClick={() => setActiveTab('on-order')}>
          <div className="filter-card__head">
            <span>On Order</span>
            <Package size={14} className={activeTab === 'on-order' ? 'text-amber' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{onOrderCount}</span>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="search-row">
          <Search size={16} />
          <input
            className="input"
            placeholder="Search CRM directory by name, email, or mobile..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Sort selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span className="text-muted font-semibold">Sort by:</span>
          <select 
            value={sortKey} 
            onChange={e => setSortKey(e.target.value as SortKey)}
            style={{
              padding: '6px 12px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              outline: 'none'
            }}
          >
            <option value="name">Name (A-Z)</option>
            <option value="status">Status</option>
            <option value="id">Newest Created</option>
          </select>
        </div>
      </div>

      {/* ══ Patients directory list ══ */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Email</th>
              <th>Mobile</th>
              <th>CRM status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {processedPatients.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">No matching patient records found in this category.</div>
                </td>
              </tr>
            ) : (
              processedPatients.map(p => {
                const status = deriveStatus(p);
                const hasUncollectedWarning = p.orders.some(o =>
                  o.payment.status === 'paid' &&
                  o.prescriptions.some(rx => {
                    if (rx.status !== 'ready' || !rx.readyAt) return false;
                    const readyDate = new Date(rx.readyAt);
                    const diffDays = Math.floor((Date.now() - readyDate.getTime()) / (1000 * 60 * 60 * 24));
                    return diffDays >= 10;
                  })
                );
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="font-semibold">
                      <div className="flex items-center gap-sm">
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{initials(p.name)}</div>
                        <span>{p.name}</span>
                      </div>
                    </td>
                    <td>{p.email}</td>
                    <td>{p.mobile}</td>
                    <td>
                      <div className="flex items-center gap-xs">
                        <span className={`pill ${status.pill}`}>{status.label}</span>
                        {hasUncollectedWarning && (
                          <span className="pill pill-red" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}>
                            ⚠️ 10d+ Overdue
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <button 
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPatientId(p.id);
                        }}
                      >
                        Details <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ══ Right Slide-over Detail Drawer ══ */}
      {selectedPatient && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedPatientId(null)} />
          <div className="drawer">
            <div className="drawer-header">
              <div className="flex items-center gap-md">
                <div className="avatar" style={{ width: 50, height: 50, fontSize: 18 }}>{initials(selectedPatient.name)}</div>
                <div>
                  <h3 className="font-bold" style={{ fontSize: 18, color: 'var(--text-primary)' }}>{selectedPatient.name}</h3>
                  <span className={`pill ${deriveStatus(selectedPatient).pill}`} style={{ fontSize: 12, marginTop: 4 }}>
                    {deriveStatus(selectedPatient).label}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-sm">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleCreateOrder(selectedPatient)}
                >
                  <Plus size={12} /> Create Order
                </button>
                <button
                  className="toast-close"
                  onClick={() => setSelectedPatientId(null)}
                  style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="drawer-body">
              {/* Check for uncollected warnings */}
              {(() => {
                const hasWarning = selectedPatient.orders.some(o =>
                  o.payment.status === 'paid' &&
                  o.prescriptions.some(rx => {
                    if (rx.status !== 'ready' || !rx.readyAt) return false;
                    const readyDate = new Date(rx.readyAt);
                    const diffDays = Math.floor((Date.now() - readyDate.getTime()) / (1000 * 60 * 60 * 24));
                    return diffDays >= 10;
                  })
                );
                if (!hasWarning) return null;
                return (
                  <div className="card" style={{ margin: 0, padding: 14, background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#f87171', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="font-bold text-sm" style={{ textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                      ⚠️ 10-DAY COLLECTION WARNING
                    </span>
                    <span>This patient has a prescription that has remained uncollected for 10 or more days. Please follow up.</span>
                  </div>
                );
              })()}

              {/* Contact info card */}
              <div className="card card-surface" style={{ margin: 0, padding: 14 }}>
                <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 8 }}>Contact &amp; Address</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <div><strong className="text-secondary">Email:</strong> {selectedPatient.email}</div>
                  <div><strong className="text-secondary">Mobile:</strong> {selectedPatient.mobile}</div>
                  {selectedPatient.crmPatient?.address && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                      <strong className="text-secondary" style={{ whiteSpace: 'nowrap' }}>Address:</strong>
                      <span>{selectedPatient.crmPatient.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Whitelabel Affiliation Info Card */}
              <div className="card card-surface" style={{ margin: 0, padding: 14, borderLeft: '3px solid var(--accent-info)' }}>
                <span className="text-xs font-bold text-info uppercase" style={{ display: 'block', marginBottom: 8 }}>Pharmacy Account Details</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <div><strong className="text-secondary">Primary Pharmacy:</strong> {PHARMACY.name}</div>
                  <div><strong className="text-secondary">Whitelabel Site:</strong> <span className="text-info">{PHARMACY.formUrl}</span></div>
                  <div><strong className="text-secondary">System ID:</strong> <code style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 4px', borderRadius: 4 }}>{selectedPatient.id}</code></div>
                </div>
              </div>

              {/* Interaction Audit History Log */}
              <div className="card card-surface" style={{ margin: 0, padding: 14 }}>
                <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 10 }}>Audit &amp; Interaction Log</span>
                {(!selectedPatient.crmPatient?.interactions || selectedPatient.crmPatient.interactions.length === 0) ? (
                  <div className="text-xs text-muted text-center" style={{ padding: '8px 0' }}>No interactions logged yet for this patient.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', paddingLeft: 14, borderLeft: '1px solid var(--border)' }}>
                    {selectedPatient.crmPatient.interactions.map((log, idx) => (
                      <div key={idx} style={{ position: 'relative', fontSize: 12 }}>
                        <div style={{
                          position: 'absolute',
                          left: -18,
                          top: 4,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: 
                            log.type.includes('Reminder') || log.type.includes('Resent') ? '#f59e0b' :
                            log.type.includes('Collected') || log.type.includes('Cleared') ? '#10b981' :
                            '#3b82f6'
                        }} />
                        <div className="flex justify-between" style={{ fontWeight: '600', marginBottom: 2 }}>
                          <span className="text-primary">{log.type}</span>
                          <span className="text-tertiary" style={{ fontSize: 10 }}>
                            {new Date(log.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} &middot; {new Date(log.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-muted text-xs">{log.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Referral records details */}
              {selectedPatient.submission ? (
                <div className="card" style={{ margin: 0, padding: 14 }}>
                  <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 10 }}>Eligibility Intake File</span>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    <div className="kv-line">
                      <span className="text-secondary">Target Condition:</span>
                      <span className="font-semibold text-primary">{selectedPatient.submission.condition}</span>
                    </div>
                    <div className="kv-line">
                      <span className="text-secondary">Clinic Referral Code:</span>
                      <span className="font-semibold text-info">{selectedPatient.submission.clinicRef || 'Awaiting clinic code'}</span>
                    </div>
                    
                    <div className="divider" style={{ margin: '4px 0' }} />

                    <div className="kv-line">
                      <span className="text-secondary">Tried ≥2 treatments:</span>
                      <span className={selectedPatient.submission.tried2 ? 'text-green' : 'text-red'}>
                        {selectedPatient.submission.tried2 ? 'Yes (Pass)' : 'No'}
                      </span>
                    </div>
                    <div className="kv-line">
                      <span className="text-secondary">Psychosis exclusion check:</span>
                      <span className={selectedPatient.submission.psychExclusion ? 'text-red' : 'text-green'}>
                        {selectedPatient.submission.psychExclusion ? 'Excluded' : 'Passed'}
                      </span>
                    </div>

                    {selectedPatient.submission.calls.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 4 }}>Call Log history</span>
                        <div style={{ background: 'var(--bg-root)', padding: 8, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {selectedPatient.submission.calls.map((call, idx) => (
                            <div key={idx} className="text-xs text-muted">
                              📞 Call logged &middot; {fmtDate(call.ts)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card text-muted text-xs text-center" style={{ margin: 0, padding: '16px 10px' }}>
                  💡 Added directly via CRM. No eligibility submission history exists.
                </div>
              )}

              {/* Order history */}
              <div>
                <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 8 }}>Prescription Orders History ({selectedPatient.orders.length})</span>
                {selectedPatient.orders.length === 0 ? (
                  <div className="card text-muted text-xs text-center" style={{ padding: '24px 12px', margin: 0 }}>
                    No sessions or orders placed yet.
                  </div>
                ) : (
                  [...selectedPatient.orders]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(order => (
                      <div className="card" key={order.id} style={{ marginBottom: 12, padding: 12 }}>
                        <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                          <span className="font-semibold text-sm">Order Session #{order.id}</span>
                          <span className="text-xs text-muted">{fmtDate(order.date)}</span>
                        </div>

                        <div className="kv-line text-xs">
                          <span className="text-secondary">Worldpay Payment:</span>
                          <span className={`pill ${
                            order.payment.status === 'paid' ? 'pill-green' : 
                            order.payment.status === 'sent' ? 'pill-amber' : 'pill-neutral'
                          }`} style={{ fontSize: 9, padding: '2px 6px' }}>
                            {order.payment.status === 'paid' ? 'Paid' : 
                             order.payment.status === 'sent' ? 'Sent' : 'Draft'}
                          </span>
                        </div>

                        <div className="kv-line text-xs" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
                          <span className="text-secondary">Amount Cleared:</span>
                          <span className="font-semibold text-primary">{money(orderRevenue(order))}</span>
                        </div>

                        {/* Rxs list inside this order */}
                        {order.prescriptions.map((rx, idx) => (
                          <div key={rx.id} style={{ background: 'var(--bg-root)', padding: 10, borderRadius: 8, marginTop: 6 }}>
                            <div className="flex justify-between text-xs" style={{ marginBottom: 4 }}>
                              <span className="font-semibold text-green">Rx #{idx + 1} &mdash; {rx.prescriber || 'No prescriber'}</span>
                              {rx.poRef && <span className="text-tertiary">{rx.poRef}</span>}
                            </div>

                            {/* Products inside this Rx */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
                              {rx.items.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex justify-between text-xs text-muted" style={{ fontSize: 11 }}>
                                  <span>{item.name} &times; {item.qty}</span>
                                  <span>{money(item.retail * item.qty + (item.fee || 0))}</span>
                                </div>
                              ))}
                            </div>

                            {/* DPD progress bar inside the drawer */}
                            {rx.placed && (
                              <div style={{ marginTop: 8 }}>
                                <div className="flex justify-between text-xs" style={{ marginBottom: 4 }}>
                                  <span className="text-muted" style={{ fontSize: 10 }}>Supplier Status:</span>
                                  <span className="font-semibold text-primary" style={{ fontSize: 10 }}>{RX_STATUS_LABELS[rx.status]}</span>
                                </div>
                                {renderTrackBar(rx.status)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
