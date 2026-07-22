import { useState, useMemo } from 'react';
import { Activity, AlertTriangle, Building2, FileText, Hash, Link2, Mail, MapPin, Phone, Search, ChevronRight, Plus, X, Users, Clipboard, Package, CheckCircle } from 'lucide-react';
import { useApp, money, orderRevenue, RX_STATUS_LABELS, PHARMACY } from '../context/AppContext';
import type { CRMPatient, EligibilitySubmission, PatientOrder } from '../context/AppContext';
import { useModalFocus } from '../accessibility/useModalFocus';
import { onboardingStatusLabel, onboardingStatusPillClass } from '../utils/onboardingStatus';
import { compactPatientName } from '../utils/patientName';

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

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Received', 'Ready', 'Collected'] as const;

function stepsCompleted(status: string): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'approved': return 1;
    case 'dispatched': return 2;
    case 'partially-received': return 3;
    case 'received': return 3;
    case 'ready': return 4;
    case 'collected': return 5;
    default: return -1;
  }
}

/* ── Status derivation ── */
function deriveStatus(p: UnifiedPatient): { label: string; compactLabel: string; pill: string } {
  if (p.orders.length > 0) {
    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status === 'ready'),
      )
    )
      return { label: 'Ready for collection', compactLabel: 'Ready', pill: 'pill-green' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status !== 'ready' && rx.status !== 'collected'),
      )
    )
      return { label: 'In fulfilment', compactLabel: 'Fulfilment', pill: 'pill-info' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.every(rx => rx.status === 'collected')
      )
    )
      return { label: 'Collected', compactLabel: 'Collected', pill: 'pill-neutral' };

    if (p.orders.some(o => o.payment.status === 'sent'))
      return { label: 'Awaiting payment', compactLabel: 'Awaiting payment', pill: 'pill-amber' };

    if (
      p.orders.some(
        o =>
          o.payment.status === 'none' &&
          o.prescriptions.some(rx => rx.items.length > 0),
      )
    )
      return { label: 'Order in progress', compactLabel: 'In progress', pill: 'pill-info' };
  }

  if (p.submission) {
    switch (p.submission.status) {
      case 'Under HHH review':
        return { label: onboardingStatusLabel(p.submission.status), compactLabel: 'Review', pill: onboardingStatusPillClass(p.submission.status) };
      case 'New':
        return { label: onboardingStatusLabel(p.submission.status), compactLabel: 'New', pill: onboardingStatusPillClass(p.submission.status) };
      case 'Approved':
        return { label: onboardingStatusLabel(p.submission.status), compactLabel: 'Onboarded', pill: onboardingStatusPillClass(p.submission.status) };
      case 'Declined':
        return { label: onboardingStatusLabel(p.submission.status), compactLabel: 'Declined', pill: onboardingStatusPillClass(p.submission.status) };
    }
  }

  if (p.crmPatient) {
    const label = onboardingStatusLabel(p.crmPatient.status);
    return { label, compactLabel: label, pill: onboardingStatusPillClass(p.crmPatient.status) };
  }

  return { label: '—', compactLabel: '—', pill: 'pill-neutral' };
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
  const patientDrawerRef = useModalFocus<HTMLDivElement>(Boolean(selectedPatientId), () => setSelectedPatientId(null));

  /* ── Build merged patient list ── */
  const patients = useMemo(() => {
    const map = new Map<string, UnifiedPatient>();

    // Add CRM patients keyed by email
    for (const crm of state.crm.filter(patient => patient.organisationId === state.currentOrganisationId)) {
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
    for (const sub of state.submissions.filter(item => item.organisationId === state.currentOrganisationId)) {
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
  }, [state.crm, state.submissions, state.orders, state.currentOrganisationId]);

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
      list = list.filter(p => p.submission && p.submission.status !== 'Approved' && p.submission.status !== 'Declined');
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
    const finalPatientId = patient.crmPatient?.status === 'HHH approved' ? patient.crmPatient.id : null;
    if (!finalPatientId) {
      dispatch({ type: 'ADD_TOAST', message: `${patient.name} cannot be added to an order until HHH approves programme onboarding.`, toastType: 'warning' });
      return;
    }
    dispatch({ type: 'NEW_ORDER', patientId: finalPatientId });
    dispatch({ type: 'ADD_TOAST', message: `Created new order draft linked to ${patient.name}`, toastType: 'success' });
    dispatch({ type: 'SET_SCREEN', screen: 'create' });
  };

  const renderTrackBar = (status: string) => {
    const done = stepsCompleted(status);
    const progressWidth = done >= 0
      ? (done / (TRACK_STEPS.length - 1)) * (100 - (100 / TRACK_STEPS.length))
      : 0;
    return (
      <div className="patient-order-progress" aria-label={`Supplier progress: ${RX_STATUS_LABELS[status as keyof typeof RX_STATUS_LABELS] ?? status}`}>
        <div className="orders-timeline-progress" style={{ width: `${progressWidth}%` }} />
        {TRACK_STEPS.map((label, i) => {
          let cls = 'patient-order-progress__step';
          if (i < done || (status === 'collected' && i <= done) || (status === 'received' && i === done)) cls += ' done';
          else if (i === done && status !== 'collected') cls += ' active';
          return (
            <div key={label} className={cls} title={label}>
              <span>{i + 1}</span>
              <small>{label}</small>
            </div>
          );
        })}
      </div>
    );
  };

  // Metrics counts
  const totalCRM = state.crm.filter(patient => patient.organisationId === state.currentOrganisationId).length;
  const activeEnquiries = state.submissions.filter(s => s.organisationId === state.currentOrganisationId && (s.status === 'New' || s.status === 'Under HHH review')).length;
  const onOrderCount = patients.filter(p => p.crmPatient && p.orders.some(o => o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))).length;

  return (
    <div className="page-body" style={{ position: 'relative' }}>

      {/* ══ Metrics Grid / Tab Switchers ══ */}
      <div className="filter-grid" role="group" aria-label="Filter patient directory">
        <button type="button" aria-pressed={activeTab === 'all'} className={`card card-surface filter-card ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          <div className="filter-card__head">
            <span>All Patients</span>
            <Users size={14} className={activeTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{patients.length}</span>
        </button>

        <button type="button" aria-pressed={activeTab === 'enquiries'} className={`card card-surface filter-card ${activeTab === 'enquiries' ? 'active' : ''}`} onClick={() => setActiveTab('enquiries')}>
          <div className="filter-card__head">
            <span>Enquiries</span>
            <Clipboard size={14} className={activeTab === 'enquiries' ? 'text-red' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{activeEnquiries}</span>
        </button>

        <button type="button" aria-pressed={activeTab === 'active'} className={`card card-surface filter-card ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <div className="filter-card__head">
            <span>Active Treatments</span>
            <CheckCircle size={14} className={activeTab === 'active' ? 'text-green' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{totalCRM}</span>
        </button>

        <button type="button" aria-pressed={activeTab === 'on-order'} className={`card card-surface filter-card ${activeTab === 'on-order' ? 'active' : ''}`} onClick={() => setActiveTab('on-order')}>
          <div className="filter-card__head">
            <span>On Order</span>
            <Package size={14} className={activeTab === 'on-order' ? 'text-amber' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{onOrderCount}</span>
        </button>
      </div>

      <div className="toolbar-row">
        <div className="search-row">
          <Search size={16} />
          <input
            className="input"
            placeholder="Search CRM directory by name, email, or mobile..."
            aria-label="Search patient directory"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Sort selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span className="text-muted font-semibold">Sort by:</span>
          <select
            aria-label="Sort patient directory"
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
        <table className="patient-directory-table">
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
                  <tr key={p.id}>
                    <td className="font-semibold">
                      <div className="flex items-center gap-sm">
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{initials(p.name)}</div>
                        <span className="compact-patient-name" title={p.name} aria-label={p.name}>{compactPatientName(p.name)}</span>
                      </div>
                    </td>
                    <td><span className="compact-email" title={p.email}>{p.email}</span></td>
                    <td><span className="compact-mobile">{p.mobile}</span></td>
                    <td>
                      <div className="flex items-center gap-xs">
                        <span className={`pill crm-status-pill ${status.pill}`} aria-label={status.label} title={status.label}>
                          <span className="crm-status-pill__full">{status.label}</span>
                          <span className="crm-status-pill__compact" aria-hidden="true">{status.compactLabel}</span>
                        </span>
                        {hasUncollectedWarning && (
                          <span className="pill crm-status-warning pill-red" aria-label="Collection overdue by at least 10 days">
                            <AlertTriangle size={11} aria-hidden="true" /> 10d+
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
          <div className="drawer-backdrop" aria-hidden="true" onClick={() => setSelectedPatientId(null)} />
          <div ref={patientDrawerRef} className="drawer patient-record-drawer" role="dialog" aria-modal="true" aria-labelledby="patient-drawer-title" tabIndex={-1}>
            <div className="drawer-header patient-record-drawer__header">
              <div className="patient-record-drawer__identity">
                <div className="avatar patient-record-drawer__avatar">{initials(selectedPatient.name)}</div>
                <div>
                  <span className="section-label">Patient record</span>
                  <h3 id="patient-drawer-title">{selectedPatient.name}</h3>
                  <span className={`pill patient-record-drawer__status ${deriveStatus(selectedPatient).pill}`}>
                    {deriveStatus(selectedPatient).label}
                  </span>
                </div>
              </div>
              <div className="patient-record-drawer__actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={selectedPatient.crmPatient?.status !== 'HHH approved'}
                  title={selectedPatient.crmPatient?.status === 'HHH approved'
                    ? 'Create a new prescription order'
                    : 'HHH onboarding approval is required before creating an order'}
                  onClick={() => handleCreateOrder(selectedPatient)}
                >
                  <Plus size={12} /> New order
                </button>
                <button
                  type="button"
                  className="icon-button patient-record-drawer__close"
                  aria-label="Close patient details"
                  onClick={() => setSelectedPatientId(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="drawer-body patient-record-drawer__body">
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
                  <div className="patient-record-alert" role="alert">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <span><strong>Collection follow-up overdue</strong><small>A prescription has remained uncollected for at least 10 days. Contact the patient.</small></span>
                  </div>
                );
              })()}

              <div className="patient-record-facts">
                <section className="patient-record-panel" aria-labelledby="patient-contact-title">
                  <header><Mail size={15} aria-hidden="true" /><h4 id="patient-contact-title">Contact</h4></header>
                  <dl>
                    <div><dt><Mail size={13} /> Email</dt><dd title={selectedPatient.email}>{selectedPatient.email}</dd></div>
                    <div><dt><Phone size={13} /> Mobile</dt><dd className="compact-mobile">{selectedPatient.mobile}</dd></div>
                    {selectedPatient.crmPatient?.address && <div><dt><MapPin size={13} /> Address</dt><dd>{selectedPatient.crmPatient.address}</dd></div>}
                  </dl>
                </section>

                <section className="patient-record-panel" aria-labelledby="patient-account-title">
                  <header><Building2 size={15} aria-hidden="true" /><h4 id="patient-account-title">Account</h4></header>
                  <dl>
                    <div><dt><Building2 size={13} /> Pharmacy</dt><dd>{PHARMACY.name}</dd></div>
                    <div><dt><Link2 size={13} /> Eligibility link</dt><dd className="patient-record-ellipsis" title={PHARMACY.formUrl}>{PHARMACY.formUrl}</dd></div>
                    <div><dt><Hash size={13} /> System ID</dt><dd><code>{selectedPatient.id}</code></dd></div>
                  </dl>
                </section>
              </div>

              {/* Interaction Audit History Log */}
              <section className="patient-record-panel patient-record-audit" aria-labelledby="patient-audit-title">
                <header><Activity size={15} aria-hidden="true" /><h4 id="patient-audit-title">Activity</h4><span>{selectedPatient.crmPatient?.interactions?.length ?? 0} events</span></header>
                {(!selectedPatient.crmPatient?.interactions || selectedPatient.crmPatient.interactions.length === 0) ? (
                  <div className="patient-record-empty">No interactions logged yet.</div>
                ) : (
                  <div className="patient-audit-list">
                    {selectedPatient.crmPatient.interactions.map((log, idx) => (
                      <div className="patient-audit-item" key={idx}>
                        <i style={{ background:
                            log.type.includes('Reminder') || log.type.includes('Resent') ? '#f59e0b' :
                              log.type.includes('Collected') || log.type.includes('Cleared') ? '#10b981' :
                              '#3b82f6'
                        }} />
                        <div><strong>{log.type}</strong><time dateTime={new Date(log.ts).toISOString()}>
                            {new Date(log.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} &middot; {new Date(log.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </time><p>{log.detail}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Referral records details */}
              {selectedPatient.submission ? (
                <section className="patient-record-panel patient-eligibility-panel" aria-labelledby="patient-eligibility-title">
                  <header><FileText size={15} aria-hidden="true" /><h4 id="patient-eligibility-title">Eligibility intake</h4><span>{onboardingStatusLabel(selectedPatient.submission.status)}</span></header>

                  <div className="patient-eligibility-grid">
                    <div className="kv-line">
                      <span className="text-secondary">Target Condition:</span>
                      <span className="font-semibold text-primary">{selectedPatient.submission.condition}</span>
                    </div>
                    <div className="kv-line">
                      <span className="text-secondary">HHH onboarding decision:</span>
                      <span className="font-semibold text-info">{onboardingStatusLabel(selectedPatient.submission.status)}</span>
                    </div>
                    {selectedPatient.submission.reviewedBy && <div className="kv-line"><span className="text-secondary">Reviewed by:</span><span className="font-semibold text-primary">{selectedPatient.submission.reviewedBy}</span></div>}

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
                      <div className="patient-call-history">
                        <span>Patient calls</span>
                        <div>
                          {selectedPatient.submission.calls.map((call, idx) => (
                            <div key={idx}>
                              <Phone size={12} aria-hidden="true" /> Call logged &middot; {fmtDate(call.ts)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <div className="patient-record-note">
                  <FileText size={15} aria-hidden="true" /><span><strong>Direct CRM record</strong><small>No eligibility submission history is attached.</small></span>
                </div>
              )}

              <section className="patient-order-history" aria-labelledby="patient-orders-title">
                <header className="patient-order-history__header"><span><small>Prescription activity</small><h4 id="patient-orders-title">Order history</h4></span><strong>{selectedPatient.orders.length}</strong></header>
                {selectedPatient.orders.length === 0 ? (
                  <div className="patient-record-empty">No prescription sessions or orders yet.</div>
                ) : (
                  [...selectedPatient.orders]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(order => {
                      const paymentLabel = order.payment.status === 'paid' ? 'Paid' : order.payment.status === 'sent' ? 'Awaiting payment' : 'Draft';
                      const paymentRoute = order.payment.route === 'worldpay' ? 'Worldpay' : order.payment.route === 'pharmacy' ? 'Pharmacy payment' : 'Not selected';
                      return (
                        <article className="patient-order-card" key={order.id}>
                          <header>
                            <span><small>Order {order.id}</small><strong>{fmtDate(order.date)}</strong></span>
                            <span className={`pill ${order.payment.status === 'paid' ? 'pill-green' : order.payment.status === 'sent' ? 'pill-amber' : 'pill-neutral'}`}>{paymentLabel}</span>
                          </header>
                          <div className="patient-order-summary">
                            <div><span>Order total</span><strong>{money(orderRevenue(order))}</strong></div>
                            <div><span>Payment route</span><strong>{paymentRoute}</strong></div>
                            <div><span>Prescriptions</span><strong>{order.prescriptions.length}</strong></div>
                          </div>

                          <div className="patient-order-rx-list">
                            {order.prescriptions.map((rx, idx) => (
                              <article className="patient-order-rx" key={rx.id}>
                                <header><span><small>Prescription {String(idx + 1).padStart(2, '0')}</small><strong>{rx.prescriber || 'Prescriber pending'}</strong></span>{rx.poRef && <code>{rx.poRef}</code>}</header>
                                <div className="patient-order-products">
                                  {rx.items.length ? rx.items.map((item, itemIdx) => (
                                    <div key={itemIdx}><span><strong>{item.name}</strong><small>Quantity {item.qty}</small></span><strong>{money(item.retail * item.qty)}</strong></div>
                                  )) : <div className="patient-record-empty">No prescribed products recorded.</div>}
                                </div>
                                <footer>
                                  <span><small>Fulfilment</small><strong>{rx.placed ? RX_STATUS_LABELS[rx.status] : 'Not submitted'}</strong></span>
                                  {rx.placed && renderTrackBar(rx.status)}
                                </footer>
                              </article>
                            ))}
                          </div>
                        </article>
                      );
                    })
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
