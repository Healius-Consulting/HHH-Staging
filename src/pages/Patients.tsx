import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, FileText, Inbox, Mail, Phone, Search, ChevronRight, Plus, Users, Package, CheckCircle, Lock } from 'lucide-react';
import { getUnresolvedReason, orderReference, useApp, money, orderRevenue, RX_STATUS_LABELS } from '../context/AppContext';
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

function orderExceptionReason(order: PatientOrder): 'rejected' | 'expired' | 'cancelled' | null {
  if (order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.status === 'collected')) return null;
  if (order.unresolvedReason === 'rejected' || order.quoteReview?.status === 'recreate_required') return 'rejected';
  if (order.unresolvedReason === 'expired' || order.lifecycleStatus === 'archived' || order.isExpired) return 'expired';
  const unresolved = getUnresolvedReason(order);
  if (unresolved === 'cancelled' || unresolved === 'rejected' || unresolved === 'expired') return unresolved;
  return null;
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

function deriveJourneyStage(p: UnifiedPatient): JourneyStage {
  return derivePatientJourneyStage({
    crmPatient: p.crmPatient,
    submission: p.submission,
    orderCount: p.orders.length,
    isNegativeEligibility: isNegativeEligibilityStatus,
  });
}

function journeyLabel(stage: JourneyStage) {
  if (stage === 'declined') return 'Declined';
  if (stage === 'suspended') return 'Suspended';
  return PATIENT_JOURNEY_STEPS[patientJourneyStepIndex(stage)]?.label ?? 'Enquiry';
}

function hasOverdueCollection(orders: PatientOrder[]) {
  return orders.some(order => (
    order.payment.status === 'paid'
    && order.prescriptions.some(rx => {
      if (rx.status !== 'ready' || !rx.readyAt) return false;
      const diffDays = Math.floor((Date.now() - new Date(rx.readyAt).getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 10;
    })
  ));
}

function PatientDirectoryTag({ status }: { status: ReturnType<typeof deriveStatus> }) {
  const tone = patientIndicatorTone(status);
  return (
    <span className={`patient-directory-tag patient-directory-tag--${tone}`}>
      <i className={`patient-status-dot is-${tone}`} aria-hidden="true" />
      <span>{status.compactLabel}</span>
    </span>
  );
}

function enquiryDisplayName(enquiry: PendingEnquiry) {
  return `${enquiry.firstName} ${enquiry.surname}`.trim() || enquiry.caseReference;
}

function directoryEmptyCopy(tab: PatientDirectoryFilter, hasSearch: boolean): { title: string; detail: string; icon: typeof Users } {
  if (hasSearch) {
    return tab === 'enquiries'
      ? {
          title: 'No matching enquiries',
          detail: 'Try a different name, contact detail, condition, or case reference.',
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
        detail: 'New QR or website-chosen enquiries appear here until HHH refers them or moves them to another pharmacy.',
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
      list = list.filter(enquiry => {
        const name = enquiryDisplayName(enquiry).toLowerCase();
        return (
          name.includes(q)
          || enquiry.caseReference.toLowerCase().includes(q)
          || (enquiry.email ?? '').toLowerCase().includes(q)
          || (enquiry.mobile ?? '').includes(q)
          || (enquiry.dob ?? '').toLowerCase().includes(q)
          || formatPatientDob(enquiry.dob).toLowerCase().includes(q)
          || (enquiry.conditions ?? []).some(condition => conditionLabel(condition).toLowerCase().includes(q))
        );
      });
    }
    if (sortKey === 'status') {
      list.sort((a, b) => a.displayStatus.localeCompare(b.displayStatus));
    } else if (sortKey === 'id') {
      list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    } else {
      list.sort((a, b) => enquiryDisplayName(a).localeCompare(enquiryDisplayName(b), 'en', { sensitivity: 'base' }));
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
  const selectedDob = selectedPatient && formatPatientDob(selectedPatient.dob) !== 'Not recorded'
    ? formatPatientDob(selectedPatient.dob)
    : null;
  const selectedContactLine = selectedPatient
    ? [selectedDob, selectedPatient.mobile || null, selectedPatient.email || null].filter(Boolean).join(' · ')
    : '';
  const selectedAddress = selectedPatient?.crmPatient?.address || null;
  const selectedPostcode = selectedPatient?.crmPatient?.postcode || null;
  const selectedJourneyStage = selectedPatient ? deriveJourneyStage(selectedPatient) : null;
  const selectedCanOrder = Boolean(selectedPatient && state.workspaceMode === 'live' && canCreateOrderForPatient(selectedPatient.crmPatient));
  const selectedOrderGate = selectedPatient ? newOrderGateMessage(state.workspaceMode === 'live', selectedPatient) : null;
  const selectedFoundService = selectedClinical?.heardAbout || portalSourceLabel(selectedClinical?.referralSource) || null;
  const selectedTreatmentCheck = selectedClinical?.triedTwoTreatments === true
    ? 'Yes'
    : selectedClinical?.triedTwoTreatments === false
      ? 'No'
      : null;
  const selectedPsychosisCheck = selectedClinical?.psychiatricExclusion === true
    ? 'Excluded'
    : selectedClinical?.psychiatricExclusion === false
      ? 'Passed'
      : null;
  const selectedMarketing = selectedMarketingConsent === null ? null : selectedMarketingConsent ? 'Consent given' : 'No consent';
  const selectedHasClinical = selectedConditions.length > 0
    || Boolean(selectedPrimaryCondition)
    || Boolean(selectedFoundService)
    || Boolean(selectedTreatmentCheck)
    || Boolean(selectedPsychosisCheck)
    || selectedMarketing !== null
    || Boolean(selectedPatient?.submission?.reviewerDisplay)
    || Boolean(selectedPatient?.submission && isNegativeEligibilityStatus(selectedPatient.submission.status));

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

  // Metrics counts
  const totalCRM = state.crm.filter(patient => patient.organisationId === state.currentOrganisationId).length;
  const enquiryCount = enquiries.length;
  const onOrderCount = patients.filter(p => p.crmPatient && p.orders.some(o => orderExceptionReason(o) ? orderNeedsResolution(o) : o.payment.status === 'sent' || o.prescriptions.some(rx => rx.status !== 'collected'))).length;
  const directoryEmpty = directoryEmptyCopy(activeTab, Boolean(search.trim()));
  const DirectoryEmptyIcon = directoryEmpty.icon;
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
            placeholder={activeTab === 'enquiries' ? 'Search by name, condition, DOB, email, or mobile...' : 'Search by name, condition, DOB, email, or mobile...'}
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
                <option value="name">Name (A–Z)</option>
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
              <div className="patient-directory-key__title"><span>Assigned enquiries</span><strong>{processedEnquiries.length}</strong></div>
              <p className="patient-directory-key__lead">These people are currently assigned to this pharmacy. HHH may still move them. Referral marks them referred; orders stay locked until then.</p>
            </header>

            {processedEnquiries.length === 0 ? (
              <div className="patient-directory-empty" role="status">
                <span className="patient-directory-empty__icon" aria-hidden="true"><DirectoryEmptyIcon size={28} /></span>
                <h3>{directoryEmpty.title}</h3>
                <p>{directoryEmpty.detail}</p>
              </div>
            ) : (
              <ul className="patient-directory-list">
                {processedEnquiries.map((enquiry: PendingEnquiry) => {
                  const name = enquiryDisplayName(enquiry);
                  const primaryCondition = enquiry.primaryCondition ?? enquiry.conditions?.[0] ?? '';
                  const sourceLabel = portalSourceLabel(enquiry.sourceType);
                  return (
                  <li key={enquiry.id}>
                    <article className="patient-directory-card patient-directory-card--enquiry" aria-label={`Enquiry ${name}`}>
                      <div className="patient-directory-card__identity">
                        <div className="avatar patient-directory-card__avatar">{initials(name)}</div>
                        <div className="patient-directory-card__copy">
                          <strong title={name}>{compactPatientName(name)}</strong>
                          <span className="patient-directory-card__meta">
                            <span><CalendarDays size={12} aria-hidden="true" />{formatPatientDob(enquiry.dob)}</span>
                            <span><Mail size={12} aria-hidden="true" />{enquiry.email}</span>
                            <span><Phone size={12} aria-hidden="true" />{enquiry.mobile}</span>
                          </span>
                          {primaryCondition ? (
                            <span className="patient-directory-card__condition">{conditionLabel(primaryCondition)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="patient-directory-card__status">
                        <span className={`pill ${onboardingStatusPillClass(enquiry.displayStatus === 'New enquiry' ? 'New' : enquiry.displayStatus)}`}>
                          {enquiry.displayStatus}
                        </span>
                      </div>
                      <span className="patient-directory-card__referral text-muted text-sm">
                        {sourceLabel ? `${sourceLabel} · ` : ''}Awaiting HHH referral
                      </span>
                    </article>
                  </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
        <header className="patient-directory-key">
          <div className="patient-directory-key__title"><span>Patient directory</span><strong>{processedPatients.length}</strong></div>
          <p className="patient-directory-key__lead">Browse referred and active patients. Status tags reflect current care stage and any action needed.</p>
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

                    <div className="patient-directory-card__status">
                      <div className="patient-directory-status">
                        <PatientDirectoryTag status={status} />
                        {p.submission && operationalStatusIsDistinct ? (
                          <span className={`pill ${onboardingStatusPillClass(p.submission.status)}`}>{eligibilityLabel}</span>
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

      {selectedPatient && (
          <section className="patient-record-drawer patient-record-page patient-chart" aria-labelledby="patient-drawer-title">
            <div className="patient-profile-toolbar">
              <button type="button" className="btn btn-secondary" onClick={backToDirectory}><ArrowLeft size={15} /> Back to list</button>
            </div>

            <header className="patient-chart__hero">
              <div className="patient-chart__identity">
                <div className="avatar patient-chart__avatar">{initials(selectedPatient.name)}</div>
                <div className="patient-chart__copy">
                  <h2 id="patient-drawer-title">{selectedPatient.name}</h2>
                  {selectedContactLine ? <p className="patient-chart__meta">{selectedContactLine}</p> : null}
                  <div className="patient-chart__badges">
                    {showDistinctProfileStatus && selectedProfileStatus ? (
                      <span className={`pill ${selectedProfileStatus.pill}`}>{selectedProfileStatus.label}</span>
                    ) : null}
                    {selectedPatient.submission && selectedEligibilityLabel && selectedEligibilityLabel !== selectedProfileStatus?.label ? (
                      <span className={`pill ${onboardingStatusPillClass(selectedPatient.submission.status)}`}>{selectedEligibilityLabel}</span>
                    ) : null}
                    {selectedJourneyStage ? <span className="patient-chart__stage">{journeyLabel(selectedJourneyStage)}</span> : null}
                  </div>
                </div>
              </div>
              <div className="patient-chart__actions">
                <div className={`patient-order-gate${selectedCanOrder ? ' is-enabled' : ''}`}>
                  <button
                    className="btn btn-primary"
                    disabled={!selectedCanOrder}
                    aria-describedby={!selectedCanOrder ? 'patient-order-gate-tip' : undefined}
                    onClick={() => handleCreateOrder(selectedPatient)}
                  >
                    {!selectedCanOrder ? <Lock size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                    New order
                  </button>
                  {!selectedCanOrder && selectedOrderGate ? (
                    <span id="patient-order-gate-tip" role="tooltip" className="patient-order-gate__tooltip">{selectedOrderGate}</span>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="drawer-body patient-record-drawer__body">
              {hasOverdueCollection(selectedPatient.orders) ? (
                <div className="patient-record-alert" role="alert">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span><strong>Collection follow-up overdue</strong><small>A prescription has remained uncollected for at least 10 days. Contact the patient.</small></span>
                </div>
              ) : null}

              <div className="patient-chart__panels">
                {selectedAddress || selectedPostcode ? (
                  <section className="patient-chart-card" aria-labelledby="patient-contact-title">
                    <header><h3 id="patient-contact-title">Address</h3></header>
                    <dl className="patient-chart-facts">
                      {selectedAddress ? <div><dt>Street</dt><dd>{selectedAddress}</dd></div> : null}
                      {selectedPostcode ? <div><dt>Postcode</dt><dd>{selectedPostcode}</dd></div> : null}
                    </dl>
                  </section>
                ) : null}

                <section className="patient-chart-card" aria-labelledby="patient-clinical-title">
                  <header><h3 id="patient-clinical-title">Clinical</h3></header>
                  {!selectedHasClinical ? (
                    <p className="patient-chart-empty">No eligibility details on this record.</p>
                  ) : (
                    <>
                      {selectedPatient.submission && isNegativeEligibilityStatus(selectedPatient.submission.status) ? (
                        <div className="patient-eligibility-reason"><span>Reason</span><strong>{pharmacyDecisionReason(selectedPatient.submission)}</strong></div>
                      ) : null}
                      {selectedConditions.length > 0 ? (
                        <div className="patient-chart-conditions">
                          <span>Conditions</span>
                          <ConditionList conditions={selectedConditions} primaryCondition={selectedPrimaryCondition || selectedConditions[0]} />
                        </div>
                      ) : null}
                      <dl className="patient-chart-facts">
                        {selectedPrimaryCondition && selectedConditions.length === 0 ? (
                          <div><dt>Primary condition</dt><dd>{conditionLabel(selectedPrimaryCondition)}</dd></div>
                        ) : null}
                        {selectedTreatmentCheck ? <div><dt>Tried two or more treatments</dt><dd>{selectedTreatmentCheck}</dd></div> : null}
                        {selectedPsychosisCheck ? <div><dt>Psychosis check</dt><dd>{selectedPsychosisCheck}</dd></div> : null}
                        {selectedFoundService ? <div><dt>How they found the service</dt><dd>{selectedFoundService}</dd></div> : null}
                        {selectedMarketing ? <div><dt>Marketing contact</dt><dd>{selectedMarketing}</dd></div> : null}
                        {selectedPatient.submission?.reviewerDisplay ? <div><dt>Reviewed by</dt><dd>{selectedPatient.submission.reviewerDisplay}</dd></div> : null}
                        {selectedPatient.submission?.reviewedAt ? <div><dt>Decision recorded</dt><dd>{fmtDate(selectedPatient.submission.reviewedAt)}</dd></div> : null}
                      </dl>
                    </>
                  )}
                  {selectedPatient.submission && selectedPatient.submission.calls.length > 0 ? (
                    <p className="patient-chart-calls">{selectedPatient.submission.calls.length} patient call{selectedPatient.submission.calls.length === 1 ? '' : 's'} logged</p>
                  ) : null}
                </section>
              </div>

              {selectedPatient.crmPatient?.interactions && selectedPatient.crmPatient.interactions.length > 0 ? (
              <section className="patient-chart-card" aria-labelledby="patient-audit-title">
                <header><h3 id="patient-audit-title">Activity</h3><span>{selectedPatient.crmPatient.interactions.length}</span></header>
                <div className="patient-audit-list">
                  {selectedPatient.crmPatient.interactions.map((log, idx) => (
                    <div className="patient-audit-item" key={idx}>
                      <i aria-hidden="true" />
                      <div>
                        <strong>{log.type}</strong>
                        <time dateTime={new Date(log.ts).toISOString()}>
                          {new Date(log.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {new Date(log.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        <p>{log.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              ) : null}

              <section className="patient-chart-orders" aria-labelledby="patient-orders-title">
                <header className="patient-chart-orders__header">
                  <h3 id="patient-orders-title">Orders</h3>
                  <span>{selectedPatient.orders.length}</span>
                </header>
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
                      const paymentLabel = order.refund?.status === 'completed' ? 'Refunded' : order.refund?.status === 'pending_confirmation' ? 'Refund pending' : exceptionReason && order.payment.status === 'paid' ? 'Needs resolution' : order.payment.status === 'paid' ? 'Paid' : order.payment.status === 'sent' ? 'Awaiting payment' : 'Draft';
                      const paymentPill = order.refund?.status === 'completed' ? 'pill-neutral' : order.refund?.status === 'pending_confirmation' ? 'pill-amber' : exceptionReason ? 'pill-red' : order.payment.status === 'paid' ? 'pill-green' : order.payment.status === 'sent' ? 'pill-amber' : 'pill-neutral';
                      const productNames = order.prescriptions.flatMap(rx => rx.items.map(item => item.name)).filter(Boolean);
                      const fulfilmentLabel = exceptionReason
                        ? (exceptionReason === 'rejected' ? 'Curaleaf rejected' : 'Prescription expired')
                        : order.prescriptions.some(rx => rx.placed)
                          ? (RX_STATUS_LABELS[order.prescriptions[0].status as keyof typeof RX_STATUS_LABELS] ?? order.prescriptions[0].status)
                          : 'Not submitted';
                      const openOrder = () => {
                        setSelectedPatientId(null);
                        dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'order', key: String(order.id) } });
                        dispatch({ type: 'SET_SCREEN', screen: 'orders' });
                      };
                      return (
                        <article className="patient-chart-order" key={order.id}>
                          <header>
                            <div>
                              <strong>{order.redoContext ? 'Replacement' : 'Order'} {orderReference(order)}</strong>
                              <small>{fmtDate(order.date)} · {money(order.payment.amount || orderRevenue(order))} · {fulfilmentLabel}</small>
                            </div>
                            <span className={`pill ${paymentPill}`}>{paymentLabel}</span>
                          </header>
                          {productNames.length ? (
                            <p className="patient-chart-order__items">{productNames.join(', ')}</p>
                          ) : null}
                          {exceptionReason ? (
                            <div className={`patient-order-resolution${order.refund?.status === 'completed' ? ' is-complete' : ''}`}>
                              <AlertTriangle size={16} />
                              <span><strong>{order.refund?.status === 'completed' ? 'Patient refund recorded' : order.redoneByOrderId ? 'Replacement order created' : exceptionReason === 'rejected' ? 'Paid Curaleaf rejection' : 'Paid prescription expired'}</strong><small>{order.refund ? `${order.refund.method === 'worldpay_portal' ? 'Worldpay' : 'Pharmacy'} · ${money(order.refund.amountPence / 100)}` : order.redoneByOrderId ? `Continued as replacement order ${order.redoneByOrderId}.` : 'Choose replacement or refund in Orders.'}</small></span>
                            </div>
                          ) : null}
                          <button type="button" className="btn btn-secondary btn-sm patient-chart-order__open" onClick={openOrder}>
                            Open order <ChevronRight size={14} aria-hidden="true" />
                          </button>
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
