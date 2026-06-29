import { useState, useMemo } from 'react';
import { Search, ChevronRight, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
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

/* ── Status derivation ── */
function deriveStatus(p: UnifiedPatient): { label: string; pill: string } {
  // 1. Check orders (highest-priority signals first)
  if (p.orders.length > 0) {
    // Ready for collection: paid + any Rx ready
    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status === 'ready'),
      )
    )
      return { label: 'Ready for collection', pill: 'pill-green' };

    // In fulfilment: paid but not ready yet
    if (
      p.orders.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status !== 'ready'),
      )
    )
      return { label: 'In fulfilment', pill: 'pill-info' };

    // Awaiting payment
    if (p.orders.some(o => o.payment.status === 'sent'))
      return { label: 'Awaiting payment', pill: 'pill-amber' };

    // Order in progress (has items, payment not yet sent)
    if (
      p.orders.some(
        o =>
          o.payment.status === 'none' &&
          o.prescriptions.some(rx => rx.items.length > 0),
      )
    )
      return { label: 'Order in progress', pill: 'pill-info' };
  }

  // 2. Check submission status
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

  // 3. CRM patient with no orders or submissions
  if (p.crmPatient) return { label: 'Referred', pill: 'pill-green' };

  // 4. Fallback
  return { label: '—', pill: 'pill-neutral' };
}

/* ── Initials helper ── */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Patients() {
  const { state, dispatch } = useApp();
  const [search, setSearch] = useState('');

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

    // Sort alphabetically
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

  /* ── Navigate on click ── */
  const handleClick = (p: UnifiedPatient) => {
    const status = deriveStatus(p);

    // If the patient has active orders, go to the review screen for the most recent one
    if (
      p.orders.length > 0 &&
      ['Ready for collection', 'In fulfilment', 'Awaiting payment', 'Order in progress'].includes(
        status.label,
      )
    ) {
      const latestOrder = p.orders[p.orders.length - 1];
      dispatch({ type: 'SET_ACTIVE_ORDER', orderId: latestOrder.id });
      dispatch({ type: 'SET_SCREEN', screen: 'review' });
      return;
    }

    // If the patient has a submission, go to referrals
    if (p.submission) {
      dispatch({ type: 'SET_SCREEN', screen: 'referrals' });
      return;
    }

    // CRM patient with no orders — go to orders (could create one)
    dispatch({ type: 'SET_SCREEN', screen: 'orders' });
  };

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
              onClick={() => handleClick(p)}
              style={{ cursor: 'pointer' }}
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
