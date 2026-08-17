import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CalendarDays, FileText, Inbox, Mail, MapPin, Phone, Search, ChevronRight, Plus, Users, Package, CheckCircle, HeartPulse, Route, Lock, UserRound } from 'lucide-react';
import { getUnresolvedReason, orderReference, useApp, money, orderRevenue, RX_STATUS_LABELS, PHARMACY } from '../context/AppContext';
import type { CRMPatient, EligibilitySubmission, PatientOrder, PendingEnquiry } from '../context/AppContext';
import { onboardingStatusLabel, onboardingStatusPillClass } from '../utils/onboardingStatus';
import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';
import { conditionLabel } from '@hhh/domain';
import ConditionList from '../components/ConditionList';
import { canCreateOrderForPatient } from '../utils/patientOrderEligibility';
import { isNegativeEligibilityStatus, pharmacyDecisionReason } from '../utils/eligibilityPresentation';
import {
  derivePatientJourneyStage,
  PATIENT_JOURNEY_STEPS,
  patientClinicalProfile,
  patientJourneyStepIndex,
  portalSourceLabel,
  type PatientJourneyStage,
} from '../utils/pharmacyPatientDirectory';
import { directoryContextFromHistory, patientIdFromSearch, patientProfileUrl, type PatientDirectoryContext, type PatientDirectoryFilter, type PatientDirectorySort } from '../utils/patientDirectoryNavigation';

/* ── Unified patient row model ── */
interface UnifiedPatient {
  id: string;
  name: string;
  email: string;
  mobile: string;
  dob: string;
  crmPatient: CRMPatient | null;
  submission: EligibilitySubmission | null;
  orders: PatientOrder[];
}

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Received', 'Ready', 'Collected'] as const;

function stepsCompleted(status: string): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'processing': return 1;
    case 'approved': return 1;
    case 'dispatched': return 2;
    case 'partially-received': return 3;
    case 'received': return 3;
    case 'ready': return 4;
    case 'collected': return 5;
    default: return -1;
  }
}

function orderExceptionReason(order: PatientOrder): 'rejected' | 'expired' | null {
  if (order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.status === 'collected')) return null;
  if (order.unresolvedReason === 'rejected' || order.quoteReview) return 'rejected';
  if (order.unresolvedReason === 'expired' || order.lifecycleStatus === 'archived' || order.isExpired) return 'expired';
  return getUnresolvedReason(order);
}

function operationalOrder(order: PatientOrder) {
  return order.lifecycleStatus !== 'cancelled' && !orderExceptionReason(order);
}

function orderNeedsResolution(order: PatientOrder) {
  return Boolean(orderExceptionReason(order)) && !order.redoneByOrderId && order.refund?.status !== 'completed';
}

/* ── Status derivation ── */
function deriveStatus(p: UnifiedPatient): { label: string; compactLabel: string; pill: string } {
  if (p.orders.length > 0) {
    const cancellationAction = p.orders.find(order => order.refund?.status !== 'completed' && (
      order.curaleafCancellation?.status === 'contact_required'
      || order.curaleafCancellation?.status === 'awaiting_confirmation'
      || order.cancellation?.status === 'refund_required'
    ));
    if (cancellationAction) return { label: 'Cancellation needs action', compactLabel: 'Action needed', pill: 'pill-red' };
    const unresolved = p.orders.find(order => orderExceptionReason(order) && !order.redoneByOrderId);
    if (unresolved?.refund?.status === 'pending_confirmation') return { label: 'Refund confirmation needed', compactLabel: 'Refund pending', pill: 'pill-amber' };
    if (unresolved?.refund?.status === 'completed') return { label: 'Refunded', compactLabel: 'Refunded', pill: 'pill-neutral' };
    if (unresolved) {
      const replacementDraft = p.orders.some(order => order.payment.status === 'none' && order.redoContext?.originalOrderId === unresolved.id);
      return replacementDraft
        ? { label: 'Replacement in progress', compactLabel: 'Replacing', pill: 'pill-info' }
        : { label: 'Paid order needs resolution', compactLabel: 'Action needed', pill: 'pill-red' };
    }
    const operational = p.orders.filter(operationalOrder);
    if (
      operational.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status === 'ready'),
      )
    )
      return { label: 'Ready for collection', compactLabel: 'Ready', pill: 'pill-green' };

    if (
      operational.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.some(rx => rx.status !== 'ready' && rx.status !== 'collected'),
      )
    )
      return { label: 'In fulfilment', compactLabel: 'Fulfilment', pill: 'pill-info' };

    if (
      operational.some(
        o =>
          o.payment.status === 'paid' &&
          o.prescriptions.every(rx => rx.status === 'collected')
      )
    )
      return { label: 'Collected', compactLabel: 'Collected', pill: 'pill-neutral' };

    if (operational.some(o => o.payment.status === 'sent'))
      return { label: 'Awaiting payment', compactLabel: 'Awaiting payment', pill: 'pill-amber' };

    if (
      operational.some(
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
      case 'Rejected':
        return { label: onboardingStatusLabel(p.submission.status), compactLabel: 'Rejected', pill: onboardingStatusPillClass(p.submission.status) };
    }
  }

  if (p.crmPatient) {
    const label = onboardingStatusLabel(p.crmPatient.status);
    return { label, compactLabel: label, pill: onboardingStatusPillClass(p.crmPatient.status) };
  }

  return { label: '—', compactLabel: '—', pill: 'pill-neutral' };
}

type PatientIndicatorTone = 'active' | 'journey' | 'ready' | 'attention' | 'complete';

function patientIndicatorTone(status: ReturnType<typeof deriveStatus>): PatientIndicatorTone {
  const label = status.label.toLowerCase();
  if (label.includes('needs resolution') || label.includes('needs action') || label.includes('refund confirmation') || label.includes('declined')) return 'attention';
  if (label.includes('ready for collection')) return 'ready';
  if (label.includes('collected') || label === 'refunded') return 'complete';
  if (label === 'active' || label.includes('approved')) return 'active';
  return 'journey';
}

type JourneyStage = PatientJourneyStage;

const JOURNEY_STEPS = PATIENT_JOURNEY_STEPS;

function deriveJourneyStage(p: UnifiedPatient): JourneyStage {
  return derivePatientJourneyStage({
    crmPatient: p.crmPatient,
    submission: p.submission,
    orderCount: p.orders.length,
    isNegativeEligibility: isNegativeEligibilityStatus,
  });
}

function journeyStepIndex(stage: JourneyStage): number {
  return patientJourneyStepIndex(stage);
}

function PatientJourneyTrack({ stage, compact = false }: { stage: JourneyStage; compact?: boolean }) {
  const activeIndex = journeyStepIndex(stage);
  const halted = stage === 'declined' || stage === 'suspended';
  return (
    <ol
      className={`patient-journey${compact ? ' patient-journey--compact' : ''}${halted ? ' is-halted' : ''}`}
      aria-label={`Care journey: ${JOURNEY_STEPS[activeIndex]?.label ?? 'Enquiry'}${halted ? ` (${stage})` : ''}`}
    >
      {JOURNEY_STEPS.map((step, index) => {
        let stepClass = 'patient-journey__step';
        if (index < activeIndex) stepClass += ' is-complete';
        else if (index === activeIndex && !halted) stepClass += ' is-current';
        else if (halted && index === activeIndex) stepClass += ' is-halted';
        return (
          <li key={step.key} className={stepClass}>
            <span className="patient-journey__marker" aria-hidden="true">{index + 1}</span>
            <span className="patient-journey__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function directoryEmptyCopy(tab: PatientDirectoryFilter, hasSearch: boolean): { title: string; detail: string; icon: typeof Users } {
  if (hasSearch) {
    return tab === 'enquiries'
      ? {
          title: 'No matching enquiries',
          detail: 'Try a different case reference.',
          icon: Search,
        }
      : {
          title: 'No matching patients',
          detail: 'Try a different name, contact detail, condition, or date of birth.',
          icon: Search,
        };
  }
  switch (tab) {
    case 'enquiries':
      return {
        title: 'No open enquiries',
        detail: 'New eligibility enquiries remain with HHH admin until review completes and a patient record is activated.',
        icon: Inbox,
      };
    case 'active':
      return {
        title: 'No active patients yet',
        detail: 'Patients appear here once HHH completes referral and activates their pharmacy record.',
        icon: CheckCircle,
      };
    case 'on-order':
      return {
        title: 'No patients on order',
        detail: 'Patients with draft, awaiting payment, or in-fulfilment orders will show in this view.',
        icon: Package,
      };
    default:
      return {
        title: 'Patient directory is empty',
        detail: 'Referred and active patients will appear here as HHH activates records for this pharmacy.',
        icon: Users,
      };
  }
}

function newOrderGateMessage(workspaceLive: boolean, patient: UnifiedPatient): string | null {
  if (!workspaceLive) return 'Full pharmacy activation is required before creating an order.';
  if (!canCreateOrderForPatient(patient.crmPatient)) {
    return 'Orders unlock once HHH marks the patient Referred or Active. Enquiry and review stages must complete first.';
  }
  if (patient.crmPatient?.status === 'Referred') return 'Create this approved referral’s first prescription order.';
  return 'Create a new prescription order.';
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

type FilterTab = PatientDirectoryFilter;
type SortKey = PatientDirectorySort;

export default function Patients() {
  const { state, dispatch } = useApp();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(() => patientIdFromSearch(window.location.search));
  const directoryRef = useRef<HTMLDivElement>(null);
  const pendingDirectoryContext = useRef<PatientDirectoryContext | null>(directoryContextFromHistory(window.history.state));

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
        dob: crm.dob ?? '',
        crmPatient: crm,
        submission: null,
        orders: state.orders.filter(o => o.patientId === crm.id),
      });
    }

    // Training workspace still merges legacy submission fixtures for demo flows.
    if (state.workspaceMode === 'training') {
      for (const sub of state.submissions.filter(item => item.organisationId === state.currentOrganisationId)) {
        const key = sub.email.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          existing.submission = sub;
          if (!existing.dob) existing.dob = sub.dob;
        }
      }
    }

    return Array.from(map.values());
  }, [state.crm, state.submissions, state.orders, state.currentOrganisationId, state.workspaceMode]);

  const enquiries = useMemo(() => (
    state.enquiries.filter(enquiry => enquiry.organisationId === state.currentOrganisationId)
  ), [state.enquiries, state.currentOrganisationId]);

  /* ── Filtered & Sorted list ── */
  const processedEnquiries = useMemo(() => {
    let list = [...enquiries];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(enquiry => enquiry.caseReference.toLowerCase().includes(q));
    }
    if (sortKey === 'status') {
      list.sort((a, b) => a.displayStatus.localeCompare(b.displayStatus));
    } else if (sortKey === 'id') {
      list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } else {
      list.sort((a, b) => a.caseReference.localeCompare(b.caseReference, 'en', { sensitivity: 'base' }));
    }
    return list;
  }, [enquiries, search, sortKey]);

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
          p.mobile.includes(q) ||
          p.dob.toLowerCase().includes(q) ||
          formatPatientDob(p.dob).toLowerCase().includes(q) ||
          (p.submission?.conditions ?? p.crmPatient?.conditions ?? []).some(condition => conditionLabel(condition).toLowerCase().includes(q))
      );
    }

    // 2. Tab Filter
    if (activeTab === 'active') {
      list = list.filter(p => p.crmPatient !== null);
    } else if (activeTab === 'on-order') {
      list = list.filter(p =>
        p.crmPatient &&
        p.orders.some(o => orderExceptionReason(o) ? orderNeedsResolution(o) : o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))
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

  const selectedPatient = patients.find(patient => patient.id === selectedPatientId) ?? null;
  const selectedClinical = selectedPatient
    ? patientClinicalProfile({ crmPatient: selectedPatient.crmPatient, submission: selectedPatient.submission })
    : null;
  const selectedConditions = selectedClinical?.conditions ?? [];
  const selectedPrimaryCondition = selectedClinical?.primaryCondition ?? '';
  const selectedMarketingConsent = selectedClinical?.marketingConsent ?? null;

  const currentDirectoryContext = useCallback((): PatientDirectoryContext => ({
    search,
    filter: activeTab,
    sort: sortKey,
    scrollTop: directoryRef.current?.scrollTop ?? 0,
    pageScrollY: window.scrollY,
    focusPatientId: null,
  }), [activeTab, search, sortKey]);

  const restoreDirectoryContext = useCallback((context: PatientDirectoryContext | null) => {
    if (!context) return;
    setSearch(context.search);
    setActiveTab(context.filter);
    setSortKey(context.sort);
    pendingDirectoryContext.current = context;
  }, []);

  const openPatientProfile = useCallback((patientId: string) => {
    const context = { ...currentDirectoryContext(), focusPatientId: patientId };
    const historyState = { ...(window.history.state ?? {}), patientDirectoryContext: context };
    window.history.replaceState(historyState, '', window.location.href);
    window.history.pushState(historyState, '', patientProfileUrl(window.location.href, patientId));
    setSelectedPatientId(patientId);
  }, [currentDirectoryContext]);

  const backToDirectory = useCallback(() => {
    const context = directoryContextFromHistory(window.history.state);
    restoreDirectoryContext(context);
    if (context) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, '', patientProfileUrl(window.location.href, null));
    setSelectedPatientId(null);
  }, [restoreDirectoryContext]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const patientId = patientIdFromSearch(window.location.search);
      if (!patientId) restoreDirectoryContext(directoryContextFromHistory(event.state));
      setSelectedPatientId(patientId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [restoreDirectoryContext]);

  useEffect(() => {
    if (selectedPatientId || !pendingDirectoryContext.current) return;
    const context = pendingDirectoryContext.current;
    const frame = window.requestAnimationFrame(() => {
      if (directoryRef.current) directoryRef.current.scrollTop = context.scrollTop;
      window.scrollTo({ top: context.pageScrollY });
      const focusTarget = context.focusPatientId
        ? [...document.querySelectorAll<HTMLElement>('[data-patient-id]')].find(element => element.dataset.patientId === context.focusPatientId)
        : null;
      focusTarget?.focus({ preventScroll: true });
      pendingDirectoryContext.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, processedEnquiries.length, processedPatients.length, search, selectedPatientId, sortKey]);

  useEffect(() => {
    const target = state.navigationTarget;
    if (target?.kind !== 'patient') return;
    const patient = patients.find(item => item.id === target.id);
    if (patient) {
      setActiveTab('all');
      setSearch('');
      openPatientProfile(patient.id);
    }
    dispatch({ type: 'CLEAR_NAVIGATION_TARGET' });
  }, [dispatch, openPatientProfile, patients, state.navigationTarget]);

  const handleCreateOrder = (patient: UnifiedPatient) => {
    if (state.workspaceMode !== 'live') {
      dispatch({ type: 'ADD_TOAST', message: 'Prescription ordering remains locked until full pharmacy activation.', toastType: 'warning' });
      return;
    }
    const crmPatient = patient.crmPatient;
    if (!canCreateOrderForPatient(crmPatient)) {
      dispatch({ type: 'ADD_TOAST', message: `${patient.name} cannot be added to an order until HHH completes programme onboarding.`, toastType: 'warning' });
      return;
    }
    dispatch({ type: 'NEW_ORDER', patientId: crmPatient.id });
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
  const enquiryCount = enquiries.length;
  const onOrderCount = patients.filter(p => p.crmPatient && p.orders.some(o => orderExceptionReason(o) ? orderNeedsResolution(o) : o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))).length;
  const directoryEmpty = directoryEmptyCopy(activeTab, Boolean(search.trim()));
  const DirectoryEmptyIcon = directoryEmpty.icon;
  const currentOrganisation = state.organisations.find(organisation => organisation.id === state.currentOrganisationId);
  const selectedProfileStatus = selectedPatient ? deriveStatus(selectedPatient) : null;
  const selectedEligibilityLabel = selectedPatient?.submission ? onboardingStatusLabel(selectedPatient.submission.status) : null;
  const showDistinctProfileStatus = Boolean(selectedPatient && selectedProfileStatus && (
    !selectedPatient.submission
    || selectedPatient.orders.length > 0
    || (selectedPatient.crmPatient && selectedProfileStatus.label !== selectedEligibilityLabel)
  ));

  return (
    <div className={`page-body patients-page${selectedPatientId ? ' patient-profile-view' : ' patient-directory-view'}`}>
      {!selectedPatientId && <>
      <div className="filter-grid" role="group" aria-label="Filter patient directory">
        <button type="button" aria-pressed={activeTab === 'all'} className={`filter-card ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          <div className="filter-card__head"><span>All patients</span><Users size={14} className={activeTab === 'all' ? 'text-info' : 'text-muted'} /></div>
          <span className="filter-card__value">{patients.length}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'enquiries'} className={`filter-card ${activeTab === 'enquiries' ? 'active' : ''}`} onClick={() => setActiveTab('enquiries')}>
          <div className="filter-card__head"><span>Enquiries</span><Inbox size={14} className={activeTab === 'enquiries' ? 'text-info' : 'text-muted'} /></div>
          <span className="filter-card__value">{enquiryCount}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'active'} className={`filter-card ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <div className="filter-card__head"><span>Active</span><CheckCircle size={14} className={activeTab === 'active' ? 'text-green' : 'text-muted'} /></div>
          <span className="filter-card__value">{totalCRM}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'on-order'} className={`filter-card ${activeTab === 'on-order' ? 'active' : ''}`} onClick={() => setActiveTab('on-order')}>
          <div className="filter-card__head"><span>On order</span><Package size={14} className={activeTab === 'on-order' ? 'text-amber' : 'text-muted'} /></div>
          <span className="filter-card__value">{onOrderCount}</span>
        </button>
      </div>

      <div className="filter-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder={activeTab === 'enquiries' ? 'Search by case reference...' : 'Search by name, condition, DOB, email, or mobile...'}
            aria-label={activeTab === 'enquiries' ? 'Search enquiry directory' : 'Search patient directory'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <label className="sort-control">
          <span>Sort</span>
          <select aria-label="Sort patient directory" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
            {activeTab === 'enquiries' ? (
              <>
                <option value="name">Case reference (A–Z)</option>
                <option value="status">Status</option>
                <option value="id">Newest</option>
              </>
            ) : (
              <>
                <option value="name">Name (A–Z)</option>
                <option value="status">Status</option>
                <option value="id">Newest</option>
              </>
            )}
          </select>
        </label>
      </div>

      {/* ══ Patients / enquiries directory list ══ */}
      <div className="patient-directory" ref={directoryRef}>
        {activeTab === 'enquiries' ? (
          <>
            <header className="patient-directory-key">
              <div className="patient-directory-key__title"><span>HHH-managed enquiries</span><strong>{processedEnquiries.length}</strong></div>
              <p className="patient-directory-key__lead">Patient identity stays with HHH until referral is activated. No orders can be created from this view.</p>
            </header>

            {processedEnquiries.length === 0 ? (
              <div className="patient-directory-empty" role="status">
                <span className="patient-directory-empty__icon" aria-hidden="true"><DirectoryEmptyIcon size={28} /></span>
                <h3>{directoryEmpty.title}</h3>
                <p>{directoryEmpty.detail}</p>
              </div>
            ) : (
              <ul className="patient-directory-list">
                {processedEnquiries.map((enquiry: PendingEnquiry) => (
                  <li key={enquiry.id}>
                    <article className="patient-directory-card patient-directory-card--enquiry" aria-label={`Enquiry ${enquiry.caseReference}`}>
                      <div className="patient-directory-card__identity">
                        <div className="avatar patient-directory-card__avatar"><Inbox size={14} aria-hidden="true" /></div>
                        <div className="patient-directory-card__copy">
                          <strong title={enquiry.caseReference}>{enquiry.caseReference}</strong>
                          <span className="patient-directory-card__meta">
                            <span><CalendarDays size={12} aria-hidden="true" />{fmtDate(enquiry.submittedAt)}</span>
                            <span>HHH intake case</span>
                          </span>
                        </div>
                      </div>
                      <div className="patient-directory-card__status">
                        <span className={`pill ${onboardingStatusPillClass(enquiry.displayStatus === 'New enquiry' ? 'New' : enquiry.displayStatus)}`}>
                          {enquiry.displayStatus}
                        </span>
                      </div>
                      <span className="patient-directory-card__referral text-muted text-sm">Awaiting HHH referral</span>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
        <header className="patient-directory-key">
          <div className="patient-directory-key__title"><span>Patient directory</span><strong>{processedPatients.length}</strong></div>
          <p className="patient-directory-key__lead">Browse referred and active patients. Journey shows Enquiry → Referred → Active care.</p>
          <div className="patient-status-key" aria-hidden="true">
            <span><i className="patient-status-dot is-journey" />In journey</span>
            <span><i className="patient-status-dot is-active" />Approved / active</span>
            <span><i className="patient-status-dot is-ready" />Ready for collection</span>
            <span><i className="patient-status-dot is-attention" />Needs action</span>
          </div>
        </header>

        {processedPatients.length === 0 ? (
          <div className="patient-directory-empty" role="status">
            <span className="patient-directory-empty__icon" aria-hidden="true"><DirectoryEmptyIcon size={28} /></span>
            <h3>{directoryEmpty.title}</h3>
            <p>{directoryEmpty.detail}</p>
          </div>
        ) : (
          <ul className="patient-directory-list">
            {processedPatients.map(p => {
              const status = deriveStatus(p);
              const journeyStage = deriveJourneyStage(p);
              const indicatorTone = patientIndicatorTone(status);
              const eligibilityLabel = p.submission ? onboardingStatusLabel(p.submission.status) : null;
              const negativeReason = p.submission ? pharmacyDecisionReason(p.submission) : null;
              const operationalStatusIsDistinct = !p.submission || p.orders.length > 0 || Boolean(p.crmPatient && status.label !== eligibilityLabel);
              const primaryCondition = p.submission?.primaryCondition ?? p.crmPatient?.primaryCondition ?? p.submission?.conditions?.[0] ?? p.crmPatient?.conditions?.[0] ?? '';
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
                <li key={p.id}>
                  <article
                    className="patient-directory-card"
                    role="link"
                    tabIndex={0}
                    data-patient-id={p.id}
                    aria-label={`Open patient profile for ${p.name}`}
                    onClick={() => openPatientProfile(p.id)}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      openPatientProfile(p.id);
                    }}
                  >
                    <div className="patient-directory-card__identity">
                      <div className="avatar patient-directory-card__avatar">{initials(p.name)}</div>
                      <div className="patient-directory-card__copy">
                        <strong title={p.name}>{compactPatientName(p.name)}</strong>
                        <span className="patient-directory-card__meta">
                          <span><CalendarDays size={12} aria-hidden="true" />{formatPatientDob(p.dob)}</span>
                          <span><Mail size={12} aria-hidden="true" />{p.email}</span>
                          <span><Phone size={12} aria-hidden="true" />{p.mobile}</span>
                        </span>
                        {primaryCondition ? (
                          <span className="patient-directory-card__condition">{conditionLabel(primaryCondition)}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="patient-directory-card__journey">
                      <PatientJourneyTrack stage={journeyStage} compact />
                    </div>

                    <div className="patient-directory-card__status">
                      <div className="patient-directory-status">
                        {p.submission ? (
                          <span className={`pill ${onboardingStatusPillClass(p.submission.status)}`}>{eligibilityLabel}</span>
                        ) : (
                          <span className={`pill ${status.pill}`}>{status.label}</span>
                        )}
                        {operationalStatusIsDistinct && p.submission ? (
                          <small><i className={`patient-status-dot is-${indicatorTone}`} aria-hidden="true" />Care: {status.label}</small>
                        ) : null}
                        {negativeReason ? <span className="patient-directory-reason" title={negativeReason}>{negativeReason}</span> : null}
                        {hasUncollectedWarning ? (
                          <small className="patient-directory-warning"><AlertTriangle size={12} aria-hidden="true" /> Collection follow-up overdue</small>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="patient-directory-open"
                      aria-label={`Open ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openPatientProfile(p.id);
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
          </>
        )}
      </div>
      </>}

      {selectedPatientId && !selectedPatient && (
        <section className="patient-profile-unavailable" role="status">
          <button type="button" className="btn btn-secondary" onClick={backToDirectory}><ArrowLeft size={15} /> Back to list</button>
          <div><FileText size={24} /><h2>Patient record unavailable</h2><p>The record may not exist or may be outside this pharmacy’s authorised scope.</p></div>
        </section>
      )}

      {/* ══ Full-page patient record ══ */}
      {selectedPatient && (
          <section className="patient-record-drawer patient-record-page" aria-labelledby="patient-drawer-title">
            <div className="patient-profile-toolbar">
              <button type="button" className="btn btn-secondary" onClick={backToDirectory}><ArrowLeft size={15} /> Back to list</button>
            </div>

            <header className="patient-profile-hero">
              <div className="patient-profile-hero__main">
                <div className="avatar patient-profile-hero__avatar">{initials(selectedPatient.name)}</div>
                <div className="patient-profile-hero__copy">
                  <span className="section-label">Patient record</span>
                  <h2 id="patient-drawer-title">{selectedPatient.name}</h2>
                  <PatientJourneyTrack stage={deriveJourneyStage(selectedPatient)} />
                  <div className="patient-profile-hero__badges">
                    {showDistinctProfileStatus && selectedProfileStatus ? (
                      <span className={`pill patient-record-drawer__status ${selectedProfileStatus.pill}`}>{selectedProfileStatus.label}</span>
                    ) : null}
                    {selectedPatient.submission ? (
                      <span className={`pill ${onboardingStatusPillClass(selectedPatient.submission.status)}`}>{onboardingStatusLabel(selectedPatient.submission.status)}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="patient-profile-hero__actions">
                {(() => {
                  const canOrder = state.workspaceMode === 'live' && canCreateOrderForPatient(selectedPatient.crmPatient);
                  const gateMessage = newOrderGateMessage(state.workspaceMode === 'live', selectedPatient);
                  return (
                    <div className={`patient-order-gate${canOrder ? ' is-enabled' : ''}`}>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!canOrder}
                        aria-describedby={!canOrder ? 'patient-order-gate-tip' : undefined}
                        onClick={() => handleCreateOrder(selectedPatient)}
                      >
                        {!canOrder ? <Lock size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                        New order
                      </button>
                      {!canOrder && gateMessage ? (
                        <span id="patient-order-gate-tip" role="tooltip" className="patient-order-gate__tooltip">{gateMessage}</span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </header>

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

              {/* Structured profile panels */}
              <div className="patient-profile-panels">
                <section className="patient-record-panel patient-profile-panel patient-profile-panel--contact" aria-labelledby="patient-contact-title">
                  <header><UserRound size={15} aria-hidden="true" /><h4 id="patient-contact-title">Contact</h4></header>
                  <dl>
                    <div><dt><Mail size={13} aria-hidden="true" /> Email</dt><dd title={selectedPatient.email}>{selectedPatient.email}</dd></div>
                    <div><dt><CalendarDays size={13} aria-hidden="true" /> Date of birth</dt><dd className="compact-mobile">{formatPatientDob(selectedPatient.dob)}</dd></div>
                    <div><dt><Phone size={13} aria-hidden="true" /> Mobile</dt><dd className="compact-mobile">{selectedPatient.mobile}</dd></div>
                    {selectedPatient.crmPatient?.address ? (
                      <div><dt><MapPin size={13} aria-hidden="true" /> Address</dt><dd>{selectedPatient.crmPatient.address}</dd></div>
                    ) : null}
                  </dl>
                  <div className="patient-profile-panel__account">
                    <div><span>Pharmacy</span><strong>{currentOrganisation?.tradingName ?? PHARMACY.name}</strong></div>
                    <div><span>Record ID</span><strong><code>{selectedPatient.id}</code></strong></div>
                  </div>
                </section>

                <section className="patient-record-panel patient-profile-panel patient-profile-panel--clinical" aria-labelledby="patient-clinical-title">
                  <header><HeartPulse size={15} aria-hidden="true" /><h4 id="patient-clinical-title">Clinical intake</h4><span>{selectedClinical?.fromSubmission ? 'HHH eligibility record' : 'Patient record'}</span></header>

                  {selectedClinical?.onboardingPillStatus ? (
                    <div className="patient-clinical-grid">
                      <div className="patient-clinical-grid__decision">
                        <span>{selectedClinical.fromSubmission ? 'HHH onboarding decision' : 'Patient status'}</span>
                        <span className={`pill ${onboardingStatusPillClass(selectedClinical.onboardingPillStatus)}`}>{onboardingStatusLabel(selectedClinical.onboardingPillStatus)}</span>
                      </div>
                      {selectedPatient.submission && isNegativeEligibilityStatus(selectedPatient.submission.status) ? (
                        <div className="patient-eligibility-reason"><span>Reason</span><strong>{pharmacyDecisionReason(selectedPatient.submission)}</strong></div>
                      ) : null}
                      {selectedPatient.submission?.reviewerDisplay ? (
                        <div className="kv-line"><span className="text-secondary">Reviewed by</span><span className="font-semibold text-primary">{selectedPatient.submission.reviewerDisplay}</span></div>
                      ) : null}
                      {selectedPatient.submission?.reviewedAt ? (
                        <div className="kv-line"><span className="text-secondary">Decision recorded</span><span className="font-semibold text-primary">{fmtDate(selectedPatient.submission.reviewedAt)}</span></div>
                      ) : null}
                      <div className="kv-line">
                        <span className="text-secondary">Tried ≥2 treatments</span>
                        <span className={selectedClinical.triedTwoTreatments ? 'text-green' : 'text-red'}>
                          {selectedClinical.triedTwoTreatments ? 'Yes (Pass)' : selectedClinical.triedTwoTreatments === false ? 'No' : 'Not recorded'}
                        </span>
                      </div>
                      <div className="kv-line">
                        <span className="text-secondary">Psychosis exclusion check</span>
                        <span className={selectedClinical.psychiatricExclusion ? 'text-red' : 'text-green'}>
                          {selectedClinical.psychiatricExclusion ? 'Excluded' : selectedClinical.psychiatricExclusion === false ? 'Passed' : 'Not recorded'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="patient-record-note patient-profile-panel__note">
                      <FileText size={15} aria-hidden="true" /><span><strong>No clinical intake attached</strong><small>This record has not been linked to an eligibility submission yet.</small></span>
                    </div>
                  )}

                  <div className="patient-clinical-context">
                    <div className="patient-clinical-context__conditions">
                      <span>Conditions disclosed</span>
                      {selectedConditions.length > 0 && selectedPrimaryCondition ? (
                        <ConditionList conditions={selectedConditions} primaryCondition={selectedPrimaryCondition} />
                      ) : (
                        <strong className="patient-care-context__empty">Not recorded</strong>
                      )}
                    </div>
                    <dl className="patient-clinical-context__details">
                      <div>
                        <dt><Route size={13} aria-hidden="true" /> How they found the service</dt>
                        <dd>{selectedClinical?.heardAbout || portalSourceLabel(selectedClinical?.referralSource) || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Primary condition</dt>
                        <dd>{selectedPrimaryCondition ? conditionLabel(selectedPrimaryCondition) : 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Marketing contact</dt>
                        <dd>{selectedMarketingConsent === null ? 'Not recorded' : selectedMarketingConsent ? 'Consent given' : 'No consent'}</dd>
                      </div>
                    </dl>
                  </div>

                  {selectedPatient.submission && selectedPatient.submission.calls.length > 0 ? (
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
                  ) : null}
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

              <section className="patient-order-history" aria-labelledby="patient-orders-title">
                <header className="patient-order-history__header"><span><small>Prescription activity</small><h4 id="patient-orders-title">Order history</h4></span><strong>{selectedPatient.orders.length}</strong></header>
                {selectedPatient.orders.length === 0 ? (
                  <div className="patient-record-empty patient-order-empty">
                    <Package size={22} aria-hidden="true" />
                    <strong>No orders yet</strong>
                    <span>{canCreateOrderForPatient(selectedPatient.crmPatient) ? 'Create the first prescription order when the patient is ready.' : 'Orders unlock after HHH marks the patient Referred or Active.'}</span>
                  </div>
                ) : (
                  [...selectedPatient.orders]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(order => {
                      const exceptionReason = orderExceptionReason(order);
                      const paymentLabel = order.refund?.status === 'completed' ? 'Refunded' : order.refund?.status === 'pending_confirmation' ? 'Refund pending' : exceptionReason && order.payment.status === 'paid' ? 'Paid · needs resolution' : order.payment.status === 'paid' ? 'Paid' : order.payment.status === 'sent' ? 'Awaiting payment' : 'Draft';
                      const paymentRoute = order.payment.route === 'worldpay' ? 'Worldpay' : order.payment.route === 'pharmacy' ? 'Pharmacy payment' : 'Not selected';
                      const paymentPill = order.refund?.status === 'completed' ? 'pill-neutral' : order.refund?.status === 'pending_confirmation' ? 'pill-amber' : exceptionReason ? 'pill-red' : order.payment.status === 'paid' ? 'pill-green' : order.payment.status === 'sent' ? 'pill-amber' : 'pill-neutral';
                      return (
                        <article className="patient-order-card" key={order.id}>
                          <header>
                            <span><small>{order.redoContext ? 'Replacement' : 'Order'} {orderReference(order)}</small><strong>{fmtDate(order.date)}</strong></span>
                            <span className={`pill ${paymentPill}`}>{paymentLabel}</span>
                          </header>
                          <div className="patient-order-summary">
                            <div><span>Patient charged</span><strong>{money(order.payment.amount || orderRevenue(order))}</strong></div>
                            <div><span>Payment route</span><strong>{paymentRoute}</strong></div>
                            <div><span>Prescriptions</span><strong>{order.prescriptions.length}</strong></div>
                          </div>

                          {exceptionReason ? (
                            <div className={`patient-order-resolution${order.refund?.status === 'completed' ? ' is-complete' : ''}`}>
                              <AlertTriangle size={16} />
                              <span><strong>{order.refund?.status === 'completed' ? 'Patient refund recorded' : order.redoneByOrderId ? 'Replacement order created' : exceptionReason === 'rejected' ? 'Paid Curaleaf rejection' : 'Paid prescription expired'}</strong><small>{order.refund ? `${order.refund.method === 'worldpay_portal' ? 'Worldpay portal' : 'Pharmacy'} · ${money(order.refund.amountPence / 100)} · ${order.refund.paymentReference}` : order.redoneByOrderId ? `Continued as replacement order ${order.redoneByOrderId}.` : 'This is not awaiting payment. Choose replacement or refund in Orders.'}</small></span>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSelectedPatientId(null); dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'order', key: String(order.id) } }); dispatch({ type: 'SET_SCREEN', screen: 'orders' }); }}>Open order</button>
                            </div>
                          ) : null}

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
                                  <span><small>{exceptionReason ? 'Resolution' : 'Fulfilment'}</small><strong>{exceptionReason ? exceptionReason === 'rejected' ? 'Curaleaf rejected' : 'Prescription expired' : rx.placed ? RX_STATUS_LABELS[rx.status] : 'Not submitted'}</strong></span>
                                  {!exceptionReason && rx.placed && renderTrackBar(rx.status)}
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
          </section>
      )}
    </div>
  );
}
