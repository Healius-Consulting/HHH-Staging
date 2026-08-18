import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, LoaderCircle, LockKeyhole, MapPin, RefreshCw, Search, Send, ShieldCheck, UserRound } from 'lucide-react';
import { decideV2ProgrammeOnboarding, getAdminGeneralIntake, getAdminIntakeDetail, getAdminPharmacyReferralIntake, getAssignmentCandidates, reassignIntake, updateIntakeFollowUp } from '../shared/api';
import type { V2EligibilityQueueItem } from '../shared/contracts';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

type Detail = Record<string, unknown>;
type ReviewStatus = 'not_started' | 'due' | 'attempted' | 'in_progress' | 'completed' | 'unable_to_contact';

const assignmentReasons = ['patient_preference', 'capacity', 'delivery_or_collection', 'geographic_coverage', 'service_compatibility', 'administrative_correction'] as const;
const words = (value: unknown) => String(value ?? '').replaceAll('_', ' ');
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('en-GB') : 'Not recorded';
const sameId = (left: string, right: string) => left.replaceAll('-', '').toLowerCase() === right.replaceAll('-', '').toLowerCase();

const previewGeneral: V2EligibilityQueueItem = {
  id: 'preview-general', caseReference: 'HHH-PREVIEW-001', patientDisplayName: 'Avery Morgan',
  submittedAt: '2026-08-16T08:40:00.000Z', displayStatus: 'Awaiting HHH referral',
  assignmentStatus: 'awaiting_hhh_allocation', pharmacyReviewStatus: 'not_opened', outcomeStatus: 'open',
  version: 2, legacy: false, sourceType: 'general_hhh_website', assignedOrganisationId: null,
  postcode: 'SW1A 1AA', followUpStatus: 'in_progress', nextFollowUpAt: null, destinationLocked: false,
};
const previewDedicated: V2EligibilityQueueItem = {
  id: 'preview-dedicated', caseReference: 'HHH-PREVIEW-002', patientDisplayName: 'Jordan Taylor',
  submittedAt: '2026-08-16T09:15:00.000Z', displayStatus: 'Awaiting HHH referral',
  assignmentStatus: 'provisional', pharmacyReviewStatus: 'not_opened', outcomeStatus: 'open',
  version: 3, legacy: false, sourceType: 'future_pharmacy_qr', sourceOrganisationId: 'preview-pharmacy',
  assignedOrganisationId: 'preview-pharmacy', postcode: 'NG16 3AA', followUpStatus: 'in_progress',
  nextFollowUpAt: null, destinationLocked: false,
};
const previewCandidates: Detail[] = [
  { id: 'preview-pharmacy', tradingName: 'Eastwood Health', gphcNumber: '9012345', address: 'Nottinghamshire' },
  { id: 'preview-pharmacy-2', tradingName: 'K-Chem Pharmacy', gphcNumber: '9023456', address: 'London' },
];

function previewDetail(record: V2EligibilityQueueItem): Detail {
  const dedicated = record.sourceType !== 'general_hhh_website';
  return {
    ...record,
    assignmentVersion: record.version,
    pharmacyAccessStatus: 'withheld',
    destinationLocked: false,
    sourceOrganisationName: dedicated ? 'Eastwood Health' : null,
    assignedOrganisationName: dedicated ? 'Eastwood Health' : null,
    effectiveAssignedOrganisationId: record.assignedOrganisationId,
    dob: '1991-04-12', email: 'preview.patient@example.test', mobile: '07000 000 000',
    conditions: ['chronic_pain', 'sleep_disorders'], primaryCondition: 'chronic_pain',
    triedTwoTreatments: true, psychosisExclusion: false,
    referralConsent: true, dataSharingConsent: true,
  };
}

export default function AdminIntakeV2() {
  const [general, setGeneral] = useState<V2EligibilityQueueItem[]>([]);
  const [referrals, setReferrals] = useState<V2EligibilityQueueItem[]>([]);
  const [selected, setSelected] = useState<V2EligibilityQueueItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<Detail[]>([]);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState<(typeof assignmentReasons)[number]>('patient_preference');
  const [allocationNote, setAllocationNote] = useState('');
  const [onboardingNote, setOnboardingNote] = useState('');
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('not_started');
  const [queueQuery, setQueueQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    if (isLocalPortalPreview) {
      setGeneral([previewGeneral]);
      setReferrals([previewDedicated]);
      setLoading(false);
      return;
    }
    try {
      const [generalResult, referralResult] = await Promise.all([getAdminGeneralIntake(), getAdminPharmacyReferralIntake()]);
      setGeneral(generalResult.records);
      setReferrals(referralResult.records);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The HHH intake queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const applyDetail = (next: Detail) => {
    const currentReason = String(next.assignmentReason ?? 'patient_preference');
    setDetail(next);
    setDestination(String(next.effectiveAssignedOrganisationId ?? ''));
    setReason(assignmentReasons.includes(currentReason as (typeof assignmentReasons)[number])
      ? currentReason as (typeof assignmentReasons)[number]
      : 'patient_preference');
    setReviewStatus(String(next.followUpStatus ?? 'not_started').toLowerCase() as ReviewStatus);
  };

  const loadCandidates = async (caseId: string, query = '') => {
    if (isLocalPortalPreview) {
      const normalised = query.toLowerCase();
      setCandidates(previewCandidates.filter(candidate => !normalised || String(candidate.tradingName).toLowerCase().includes(normalised)));
      return;
    }
    setCandidates((await getAssignmentCandidates(caseId, query)).records);
  };

  const open = async (record: V2EligibilityQueueItem) => {
    setSelected(record);
    setDetail(null);
    setDetailLoading(true);
    setCandidateQuery('');
    setAllocationNote('');
    setOnboardingNote('');
    setMessage('');
    try {
      if (isLocalPortalPreview) {
        applyDetail(previewDetail(record));
        setCandidates(previewCandidates);
      } else {
        const [next, candidateResult] = await Promise.all([
          getAdminIntakeDetail(record.id),
          getAssignmentCandidates(record.id),
        ]);
        applyDetail(next);
        setCandidates(candidateResult.records);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The protected intake record could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!selected || isLocalPortalPreview) return detail;
    const next = await getAdminIntakeDetail(selected.id);
    applyDetail(next);
    return next;
  };

  const findCandidates = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage('');
    try {
      await loadCandidates(selected.id, candidateQuery);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Eligible pharmacies could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const saveDestination = async () => {
    if (!selected || !detail || !destination) return;
    setBusy(true);
    setMessage('');
    try {
      if (!isLocalPortalPreview) {
        await reassignIntake(selected.id, {
          destinationOrganisationId: destination,
          reasonCode: reason,
          note: allocationNote.trim() || null,
          expectedVersion: Number(detail.assignmentVersion ?? selected.version),
        });
        await Promise.all([refreshDetail(), load()]);
      } else {
        applyDetail({ ...detail, effectiveAssignedOrganisationId: destination, assignedOrganisationId: destination, assignedOrganisationName: candidates.find(candidate => candidate.id === destination)?.tradingName, assignmentVersion: Number(detail.assignmentVersion ?? 0) + 1 });
      }
      setAllocationNote('');
      setMessage('Pending destination updated. The previous pharmacy can no longer see this enquiry; it now appears for the new pharmacy.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The pending destination could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async () => {
    if (!selected || !detail) return;
    setBusy(true);
    setMessage('');
    try {
      if (!isLocalPortalPreview) {
        await updateIntakeFollowUp(selected.id, {
          expectedVersion: Number(detail.assignmentVersion ?? selected.version),
          followUpStatus: reviewStatus,
        });
        await refreshDetail();
      } else {
        applyDetail({ ...detail, followUpStatus: reviewStatus, assignmentVersion: Number(detail.assignmentVersion ?? 0) + 1 });
      }
      setMessage('HHH review status saved.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The HHH review status could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const decideOnboarding = async (decision: 'approved' | 'declined') => {
    if (!selected || !detail) return;
    setBusy(true);
    setMessage('');
    try {
      if (!isLocalPortalPreview) {
        await decideV2ProgrammeOnboarding(selected.id, {
          expectedVersion: Number(detail.assignmentVersion ?? selected.version),
          decision,
          notes: onboardingNote.trim() || null,
        });
        setSelected(null);
        setDetail(null);
        await load();
      }
      setMessage(decision === 'approved'
        ? 'Referral completed. The patient record is now visible only to the currently assigned pharmacy.'
        : 'Application declined and removed from the active intake queue.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The onboarding decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const allRecords = useMemo(() => [...general, ...referrals]
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt)), [general, referrals]);
  const filteredRecords = useMemo(() => {
    const query = queueQuery.trim().toLowerCase();
    return !query ? allRecords : allRecords.filter(record => `${record.patientDisplayName} ${record.caseReference} ${record.postcode ?? ''}`.toLowerCase().includes(query));
  }, [allRecords, queueQuery]);

  const currentDestinationId = String(detail?.effectiveAssignedOrganisationId ?? '');
  const destinationSaved = Boolean(currentDestinationId) && sameId(destination, currentDestinationId);
  const reviewComplete = detail?.followUpStatus === 'completed';
  const sourceName = String(detail?.sourceOrganisationName ?? (detail?.sourceType === 'general_hhh_website' ? 'Main HHH website' : 'Original QR pharmacy'));
  const destinationName = String(detail?.assignedOrganisationName ?? candidates.find(candidate => candidate.id === currentDestinationId)?.tradingName ?? 'Not assigned');

  return <div className="admin-v2-intake">
    <section className="admin-v2-intake__boundary" aria-label="Patient intake security boundary">
      <ShieldCheck size={19} />
      <span><strong>HHH intake workspace</strong><small>The current assigned pharmacy can see this person as an enquiry. Referral is the gate that marks them referred. Moving assignment transfers visibility.</small></span>
      <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
    </section>

    {message && <div className="banner" role="status" aria-live="polite">{message}</div>}

    <div className="admin-v2-intake__workspace">
      <aside className="admin-v2-intake__queue" aria-label="Patients awaiting HHH review">
        <header><div><p className="section-label">Patient queue</p><h2>Awaiting HHH</h2></div><span className={`pill ${allRecords.length ? 'pill-amber' : 'pill-green'}`}>{allRecords.length} open</span></header>
        <label className="admin-v2-intake__search"><Search size={15} /><input value={queueQuery} onChange={event => setQueueQuery(event.target.value)} placeholder="Search patients" aria-label="Search intake patients" /></label>
        <div className="admin-v2-intake__counts" aria-label="Queue totals"><span>Main website <strong>{general.length}</strong></span><span>QR links <strong>{referrals.length}</strong></span></div>
        {loading ? <div className="empty-state"><LoaderCircle className="spin" size={20} /> Loading protected queue…</div> : filteredRecords.length === 0 ? <div className="empty-state"><CheckCircle2 size={20} /> No patients are waiting.</div> : <div className="admin-v2-intake__rows">{filteredRecords.map(record => <button type="button" className={selected?.id === record.id ? 'active' : ''} key={record.id} onClick={() => void open(record)} aria-pressed={selected?.id === record.id}>
          <span><strong>{record.patientDisplayName}</strong><small>{record.caseReference} · {record.postcode || 'No postcode'}</small></span>
          <span className="pill pill-neutral">{record.sourceType === 'general_hhh_website' ? 'Website' : 'QR link'}</span>
          <small>HHH review: {words(record.followUpStatus || 'not_started')}</small>
        </button>)}</div>}
      </aside>

      <main className="admin-v2-intake__detail">
        {!selected ? <div className="admin-v2-intake__placeholder"><ClipboardList size={28} /><h2>Select a patient</h2><p>Choose someone from the protected queue to review their form, update the intended pharmacy, and complete the referral.</p></div> : detailLoading || !detail ? <div className="empty-state"><LoaderCircle className="spin" size={22} /> Loading full authorised form…</div> : <>
          <header className="admin-v2-intake__detail-head"><div><p className="section-label">{selected.caseReference}</p><h2>{selected.patientDisplayName}</h2><p>Submitted {dateTime(selected.submittedAt)}</p></div><span className="pill pill-info"><LockKeyhole size={12} /> HHH review</span></header>

          <section className="admin-v2-case__notice"><ShieldCheck size={18} /><span><strong>Enquiry visibility follows the current pharmacy</strong><small>The assigned pharmacy can already see this person in Patients. Completing referral marks them referred. Moving assignment removes them from the previous pharmacy.</small></span></section>

          <div className="admin-v2-case__summary">
            <section><h3><UserRound size={16} /> Patient and contact</h3><dl><div><dt>Date of birth</dt><dd>{String(detail.dob ?? '—')}</dd></div><div><dt>Postcode</dt><dd>{String(detail.postcode ?? '—')}</dd></div><div><dt>Email</dt><dd>{String(detail.email ?? '—')}</dd></div><div><dt>Mobile</dt><dd>{String(detail.mobile ?? '—')}</dd></div></dl></section>
            <section><h3><ClipboardList size={16} /> Eligibility answers</h3><dl><div><dt>Primary condition</dt><dd>{words(detail.primaryCondition || '—')}</dd></div><div><dt>Conditions</dt><dd>{Array.isArray(detail.conditions) ? detail.conditions.map(words).join(', ') : '—'}</dd></div><div><dt>Two treatments</dt><dd>{detail.triedTwoTreatments ? 'Yes' : 'No / not confirmed'}</dd></div><div><dt>Psychosis exclusion</dt><dd>{detail.psychosisExclusion ? 'Reported' : 'Not reported'}</dd></div></dl></section>
          </div>

          <div className="admin-v2-intake__forms">
            <section className="admin-v2-panel admin-v2-intake__assignment">
              <header><span><MapPin size={16} /><strong>Current pharmacy assignment</strong></span><span className="pill pill-neutral">Pending</span></header>
              <div className="admin-v2-intake__route"><span><small>Original source</small><strong>{sourceName}</strong><p>Audit attribution only</p></span><span aria-hidden="true">→</span><span><small>Current destination</small><strong>{destinationName}</strong><p>Who can see this enquiry now</p></span></div>
              <p>Accept the chosen or QR pharmacy, or move the enquiry before referral. Saving a new destination removes the original pharmacy’s access and gives the new pharmacy the enquiry.</p>
              <div className="search-box"><Search size={15} /><input value={candidateQuery} onChange={event => setCandidateQuery(event.target.value)} placeholder="Search eligible pharmacies" aria-label="Search eligible pharmacies" /></div>
              <button type="button" className="btn btn-sm" onClick={() => void findCandidates()} disabled={busy}>Search pharmacies</button>
              <label>Pending destination<select className="input" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Select a pharmacy</option>{candidates.map(candidate => <option key={String(candidate.id)} value={String(candidate.id)}>{String(candidate.tradingName)} · GPhC {String(candidate.gphcNumber ?? 'not recorded')}</option>)}</select></label>
              <label>Reason<select className="input" value={reason} onChange={event => setReason(event.target.value as typeof reason)}><option value="patient_preference">Patient preference</option><option value="capacity">Capacity</option><option value="delivery_or_collection">Delivery or collection needs</option><option value="geographic_coverage">Geographic coverage</option><option value="service_compatibility">Service compatibility</option><option value="administrative_correction">Administrative correction</option></select></label>
              <label>Private HHH note<textarea className="input" rows={3} value={allocationNote} onChange={event => setAllocationNote(event.target.value)} /></label>
              <button type="button" className="btn" disabled={busy || !destination || sameId(destination, currentDestinationId)} onClick={() => void saveDestination()}>Move pending enquiry</button>
            </section>

            <section className="admin-v2-panel">
              <header><span><ClipboardList size={16} /><strong>HHH review</strong></span></header>
              <p>Update the administrative review status. This remains invisible to pharmacy staff.</p>
              <label>Review status<select className="input" value={reviewStatus} onChange={event => setReviewStatus(event.target.value as ReviewStatus)}><option value="not_started">Not started</option><option value="due">Follow-up due</option><option value="attempted">Contact attempted</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="unable_to_contact">Unable to contact</option></select></label>
              <button type="button" className="btn" disabled={busy || reviewStatus === detail.followUpStatus} onClick={() => void saveReview()}>Save review status</button>
            </section>

            <section className="admin-v2-panel admin-v2-intake__activation">
              <header><span><Send size={16} /><strong>Complete referral</strong></span></header>
              <div className={`admin-v2-referral-gate ${reviewComplete && destinationSaved ? 'is-ready' : ''}`}><span>{reviewComplete && destinationSaved ? <CheckCircle2 size={17} /> : <LockKeyhole size={17} />}</span><div><strong>{reviewComplete && destinationSaved ? 'Ready to refer' : 'Referral gate not complete'}</strong><small>{!destinationSaved ? 'Save the current pharmacy destination first.' : !reviewComplete ? 'Mark the HHH review as completed first.' : `The patient will be marked referred for ${destinationName}.`}</small></div></div>
              <label>Onboarding decision note<textarea className="input" rows={3} value={onboardingNote} onChange={event => setOnboardingNote(event.target.value)} /></label>
              <div className="admin-v2-intake__decision-actions"><button type="button" className="btn btn-primary" disabled={busy || !reviewComplete || !destinationSaved} onClick={() => void decideOnboarding('approved')}><Send size={15} /> Refer and activate patient</button><button type="button" className="btn" disabled={busy} onClick={() => void decideOnboarding('declined')}>Decline application</button></div>
            </section>
          </div>
        </>}
      </main>
    </div>
  </div>;
}
