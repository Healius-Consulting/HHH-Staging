import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Clock3, LoaderCircle, LockKeyhole, MapPin, PhoneCall, RefreshCw, Search, Send, ShieldCheck, UserRound } from 'lucide-react';
import { ApiRequestError, confirmIntakeAssignment, decideV2ProgrammeOnboarding, getAdminGeneralIntake, getAdminIntakeDetail, getAdminPharmacyReferralIntake, getAssignmentCandidates, reassignIntake, recordIntakeFollowUpAttempt, updateIntakeFollowUp } from '../shared/api';
import type { V2EligibilityQueueItem } from '../shared/contracts';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

type Detail = Record<string, unknown>;
type TimelineEntry = { id?: string; occurredAt?: string; contactMethod?: string; outcome?: string; reachedPatient?: boolean; note?: string | null; nextFollowUpAt?: string | null };

const words = (value: unknown) => String(value ?? '').replaceAll('_', ' ');
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('en-GB') : 'Not recorded';
const previewGeneral: V2EligibilityQueueItem = { id: 'preview-general', caseReference: 'HHH-PREVIEW-001', patientDisplayName: 'Avery Morgan', submittedAt: '2026-08-16T08:40:00.000Z', displayStatus: 'Awaiting HHH referral', assignmentStatus: 'awaiting_hhh_allocation', pharmacyReviewStatus: 'not_opened', outcomeStatus: 'open', version: 2, legacy: false, sourceType: 'general_hhh_website', assignedOrganisationId: null, postcode: 'SW1A 1AA', followUpStatus: 'in_progress', nextFollowUpAt: '2026-08-16T14:00:00.000Z', destinationLocked: false };
const previewDedicated: V2EligibilityQueueItem = { id: 'preview-dedicated', caseReference: 'HHH-PREVIEW-002', patientDisplayName: 'Jordan Taylor', submittedAt: '2026-08-16T09:15:00.000Z', displayStatus: 'Awaiting HHH referral', assignmentStatus: 'awaiting_hhh_allocation', pharmacyReviewStatus: 'not_opened', outcomeStatus: 'open', version: 3, legacy: false, sourceType: 'future_pharmacy_qr', sourceOrganisationId: 'preview-pharmacy', assignedOrganisationId: 'preview-pharmacy', postcode: 'NG16 3AA', followUpStatus: 'in_progress', nextFollowUpAt: null, destinationLocked: true };

function previewDetail(record: V2EligibilityQueueItem): Detail {
  const dedicated = record.destinationLocked === true;
  return {
    ...record,
    assignmentVersion: record.version,
    pharmacyAccessStatus: 'withheld',
    destinationLocked: dedicated,
    sourceOrganisationName: dedicated ? 'Eastwood Health' : null,
    locationPreferenceOrganisationName: dedicated ? null : 'K-Chem',
    assignedOrganisationName: dedicated ? 'Eastwood Health' : null,
    effectiveAssignedOrganisationId: record.assignedOrganisationId,
    dob: '1991-04-12', email: 'preview.patient@example.test', mobile: '07000 000 000',
    conditions: ['chronic_pain', 'sleep_disorders'], primaryCondition: 'chronic_pain',
    triedTwoTreatments: true, psychosisExclusion: false,
    followUpAttemptCount: 2,
    followUpTimeline: [
      { id: 'preview-attempt-1', occurredAt: '2026-08-16T10:10:00.000Z', contactMethod: 'phone', outcome: 'attempted', reachedPatient: false, note: 'No answer. Voicemail left with the HHH callback number.', nextFollowUpAt: '2026-08-16T12:30:00.000Z' },
      { id: 'preview-attempt-2', occurredAt: '2026-08-16T12:35:00.000Z', contactMethod: 'phone', outcome: 'in_progress', reachedPatient: true, note: 'Patient confirmed contact preference and delivery needs. Records check remains outstanding.', nextFollowUpAt: null },
    ],
    allocationRequirements: { preferredContactMethod: 'phone', bestTimeToContact: 'Weekdays after 12:00', deliveryRequirement: true, collectionPreference: 'Delivery preferred', mobilityAccessibilityRequirement: 'Step-free access required', geographicRestrictions: '', otherNonClinicalRequirements: 'Please confirm delivery days during the referral call.' },
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
  const [reason, setReason] = useState('patient_preference');
  const [allocationNote, setAllocationNote] = useState('');
  const [onboardingNote, setOnboardingNote] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [contactMethod, setContactMethod] = useState<'phone' | 'email' | 'sms' | 'other'>('phone');
  const [followUpOutcome, setFollowUpOutcome] = useState<'not_started' | 'due' | 'attempted' | 'in_progress' | 'completed' | 'unable_to_contact'>('attempted');
  const [reachedPatient, setReachedPatient] = useState(false);
  const [callNote, setCallNote] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [preferredContactMethod, setPreferredContactMethod] = useState('no_preference');
  const [bestTimeToContact, setBestTimeToContact] = useState('');
  const [deliveryRequirement, setDeliveryRequirement] = useState(false);
  const [collectionPreference, setCollectionPreference] = useState('');
  const [accessibilityRequirement, setAccessibilityRequirement] = useState('');
  const [geographicRestrictions, setGeographicRestrictions] = useState('');
  const [otherRequirements, setOtherRequirements] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    if (isLocalPortalPreview) {
      setGeneral([previewGeneral]); setReferrals([previewDedicated]); setLoading(false); return;
    }
    try {
      const [generalResult, referralResult] = await Promise.all([getAdminGeneralIntake(), getAdminPharmacyReferralIntake()]);
      setGeneral(generalResult.records); setReferrals(referralResult.records);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The HHH intake queues could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const applyDetail = (next: Detail) => {
    const requirements = next.allocationRequirements as Detail | undefined;
    const locked = next.destinationLocked === true;
    setDetail(next);
    setDestination(String(locked ? next.sourceOrganisationId ?? next.organisationId ?? '' : next.effectiveAssignedOrganisationId ?? ''));
    setReason(locked ? 'dedicated_pharmacy_referral' : String(next.assignmentReason ?? 'patient_preference'));
    setDeliveryRequirement(requirements?.deliveryRequirement === true);
    setCollectionPreference(String(requirements?.collectionPreference ?? ''));
    setAccessibilityRequirement(String(requirements?.mobilityAccessibilityRequirement ?? ''));
    setGeographicRestrictions(String(requirements?.geographicRestrictions ?? ''));
    setOtherRequirements(String(requirements?.otherNonClinicalRequirements ?? ''));
    setPreferredContactMethod(String(requirements?.preferredContactMethod ?? 'no_preference'));
    setBestTimeToContact(String(requirements?.bestTimeToContact ?? ''));
  };

  const open = async (record: V2EligibilityQueueItem) => {
    setSelected(record); setDetail(null); setCandidates([]); setCandidateQuery(''); setMessage(''); setConflict(false); setAcknowledge(false);
    if (isLocalPortalPreview) { applyDetail(previewDetail(record)); return; }
    try { applyDetail(await getAdminIntakeDetail(record.id)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The authorised case detail could not be loaded.'); }
  };
  const refreshDetail = async () => { if (selected) applyDetail(await getAdminIntakeDetail(selected.id)); };

  const findCandidates = async () => {
    if (!selected || detail?.destinationLocked === true) return;
    setBusy(true); setMessage('');
    try { setCandidates((await getAssignmentCandidates(selected.id, candidateQuery)).records); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Eligible destinations could not be loaded.'); }
    finally { setBusy(false); }
  };

  const refer = async () => {
    if (!selected || !detail || !destination) return;
    const locked = detail.destinationLocked === true;
    const alreadyConfirmed = detail.assignmentStatus === 'confirmed';
    let assignmentConfirmed = alreadyConfirmed;
    setBusy(true); setMessage(''); setConflict(false);
    try {
      const input = { reasonCode: reason, note: allocationNote.trim() || null, expectedVersion: Number(detail.assignmentVersion ?? selected.version), acknowledgeReviewStarted: acknowledge };
      const assignment = alreadyConfirmed
        ? { assignmentVersion: input.expectedVersion }
        : locked
          ? await confirmIntakeAssignment(selected.id, input)
          : await reassignIntake(selected.id, { ...input, destinationOrganisationId: destination });
      assignmentConfirmed = true;
      await decideV2ProgrammeOnboarding(selected.id, {
        expectedVersion: Number(assignment.assignmentVersion ?? input.expectedVersion + (alreadyConfirmed ? 0 : 1)),
        decision: 'approved',
        notes: onboardingNote.trim() || null,
      });
      setMessage('HHH referral completed. The patient is now active in the confirmed pharmacy workspace.');
      setSelected(null); setDetail(null); await load();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'REVIEW_STARTED_CONFIRMATION_REQUIRED') { setConflict(true); setMessage('A legacy pharmacy review already exists. Acknowledge it before changing this general-website destination.'); }
      else if (cause instanceof ApiRequestError && cause.status === 409) { setConflict(true); setMessage(cause.message); }
      else setMessage(`${assignmentConfirmed ? 'The destination was confirmed, but patient activation did not finish. Retry the final action. ' : ''}${cause instanceof Error ? cause.message : 'The referral could not be completed.'}`);
      if (assignmentConfirmed) await refreshDetail().catch(() => undefined);
    } finally { setBusy(false); }
  };

  const saveRequirements = async () => {
    if (!selected || !detail) return;
    setBusy(true); setMessage('');
    try {
      await updateIntakeFollowUp(selected.id, {
        expectedVersion: Number(detail.assignmentVersion ?? selected.version), followUpStatus: String(detail.followUpStatus ?? 'in_progress'),
        preferredContactMethod, bestTimeToContact: bestTimeToContact.trim() || null, deliveryRequirement,
        collectionPreference: collectionPreference.trim() || null, mobilityAccessibilityRequirement: accessibilityRequirement.trim() || null,
        geographicRestrictions: geographicRestrictions.trim() || null, otherNonClinicalRequirements: otherRequirements.trim() || null,
      });
      await refreshDetail(); setMessage('Contact preferences and referral requirements saved.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The referral requirements could not be saved.'); }
    finally { setBusy(false); }
  };

  const logAttempt = async () => {
    if (!selected || !detail) return;
    setBusy(true); setMessage('');
    try {
      await recordIntakeFollowUpAttempt(selected.id, {
        expectedVersion: Number(detail.assignmentVersion ?? selected.version), contactMethod, outcome: followUpOutcome,
        reachedPatient, note: callNote.trim() || null, nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null,
      });
      setCallNote(''); setNextFollowUpAt(''); await refreshDetail(); setMessage('Contact attempt added to the protected HHH timeline.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The contact attempt could not be recorded.'); }
    finally { setBusy(false); }
  };

  const decideOnboarding = async (decision: 'approved' | 'declined') => {
    if (!selected || !detail) return;
    setBusy(true); setMessage('');
    try {
      await decideV2ProgrammeOnboarding(selected.id, { expectedVersion: Number(detail.assignmentVersion ?? selected.version), decision, notes: onboardingNote.trim() || null });
      setSelected(null); setDetail(null); await load();
      setMessage(decision === 'approved' ? 'Programme onboarding approved and the patient record was activated for the referred pharmacy.' : 'Programme onboarding declined.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The onboarding decision could not be recorded.'); }
    finally { setBusy(false); }
  };

  const timeline = useMemo(() => Array.isArray(detail?.followUpTimeline) ? [...detail.followUpTimeline as TimelineEntry[]].reverse() : [], [detail]);
  const lockedDestination = detail?.destinationLocked === true;
  const followUpComplete = detail?.followUpStatus === 'completed';
  const destinationConfirmed = detail?.assignmentStatus === 'confirmed';
  const patientActivated = detail?.programmeOnboardingDecision === 'approved' && detail?.pharmacyAccessStatus === 'activated';
  const destinationName = lockedDestination ? String(detail?.sourceOrganisationName ?? 'Dedicated pharmacy') : String(candidates.find(candidate => candidate.id === destination)?.tradingName ?? detail?.assignedOrganisationName ?? '');

  const queue = (title: string, description: string, records: V2EligibilityQueueItem[]) => <section className="card admin-v2-queue">
    <div className="admin-directory-head"><div><p className="section-label">HHH intake operations</p><h2>{title}</h2><p>{description}</p></div><span className={`pill ${records.length ? 'pill-amber' : 'pill-green'}`}>{records.length} open</span></div>
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={20} /> Loading protected queue…</div> : records.length === 0 ? <div className="empty-state"><CheckCircle2 size={20} /> No applications are waiting.</div> : <div className="admin-v2-queue__rows">{records.map(record => <button type="button" key={record.id} onClick={() => void open(record)}><span><strong>{record.patientDisplayName}</strong><small>{record.caseReference} · {record.postcode || 'Postcode unavailable'}</small></span><span><small>{record.sourceType === 'general_hhh_website' ? 'Main website' : 'Dedicated pharmacy link'}</small><strong>{record.destinationLocked ? 'Destination locked' : 'HHH allocation required'}</strong></span><span><small>HHH follow-up</small><strong>{words(record.followUpStatus || 'not_started')}</strong></span></button>)}</div>}
  </section>;

  return <div className="admin-v2-intake">
    <div className="admin-page-actions"><button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh HHH intake</button></div>
    {queue('Main website applications', 'Patients remain visible only to HHH until follow-up is completed and a pharmacy referral is confirmed.', general)}
    {queue('Dedicated pharmacy applications', 'The source pharmacy is permanent, but receives no case access until HHH completes the referral.', referrals)}
    {message && <div className={`banner ${conflict ? 'banner-amber' : ''}`} role="status" aria-live="polite">{conflict && <AlertCircle size={16} />}{message}</div>}
    {selected && <section className="card admin-v2-case" aria-labelledby="admin-v2-case-title">
      <header><div><p className="section-label">{selected.caseReference}</p><h2 id="admin-v2-case-title">{selected.patientDisplayName}</h2><p>HHH protected intake record · submitted {dateTime(selected.submittedAt)}</p></div><button className="btn btn-sm" type="button" onClick={() => { setSelected(null); setDetail(null); }}>Close case</button></header>
      {!detail ? <div className="empty-state"><LoaderCircle className="spin" /> Loading full authorised detail…</div> : <>
        <div className="admin-v2-case__notice"><ShieldCheck size={18} /><span><strong>{patientActivated ? 'Patient active in pharmacy workspace' : 'HHH-only — pharmacy access withheld'}</strong><small>{lockedDestination ? `${String(detail.sourceOrganisationName ?? 'The source pharmacy')} is the permanent destination for this dedicated link.` : `${String(detail.locationPreferenceOrganisationName ?? 'No pharmacy')} is recorded as a preference only until HHH confirms the referral.`}</small></span></div>
        <div className="admin-v2-case__summary">
          <section><h3><UserRound size={16} /> Patient and contact</h3><dl><div><dt>Date of birth</dt><dd>{String(detail.dob ?? '—')}</dd></div><div><dt>Postcode</dt><dd>{String(detail.postcode ?? '—')}</dd></div><div><dt>Email</dt><dd>{String(detail.email ?? '—')}</dd></div><div><dt>Mobile</dt><dd>{String(detail.mobile ?? '—')}</dd></div></dl></section>
          <section><h3><ClipboardList size={16} /> Eligibility answers</h3><dl><div><dt>Primary condition</dt><dd>{words(detail.primaryCondition || '—')}</dd></div><div><dt>Conditions</dt><dd>{Array.isArray(detail.conditions) ? detail.conditions.map(words).join(', ') : '—'}</dd></div><div><dt>Two treatments</dt><dd>{detail.triedTwoTreatments ? 'Yes' : 'No / not confirmed'}</dd></div><div><dt>Psychosis exclusion</dt><dd>{detail.psychosisExclusion ? 'Reported' : 'Not reported'}</dd></div></dl></section>
        </div>
        <div className="admin-v2-case__workspace">
          <section className="admin-v2-panel admin-v2-case__timeline">
            <header><span><PhoneCall size={16} /><strong>Contact timeline</strong></span><span className="pill pill-neutral">{String(detail.followUpAttemptCount ?? 0)} attempts</span></header>
            <div className="admin-v2-followup-status"><span><Clock3 size={15} /><small>Current state</small><strong>{words(detail.followUpStatus || 'not_started')}</strong></span><span><small>Next action</small><strong>{dateTime(detail.nextFollowUpAt)}</strong></span></div>
            {timeline.length ? <ol className="admin-v2-timeline-list">{timeline.map((entry, index) => <li key={entry.id ?? `${entry.occurredAt}-${index}`}><span aria-hidden="true" /><div><header><strong>{words(entry.outcome || 'attempted')}</strong><time>{dateTime(entry.occurredAt)}</time></header><small>{words(entry.contactMethod || 'contact')} · {entry.reachedPatient ? 'Patient reached' : 'No contact'}</small>{entry.note && <p>{entry.note}</p>}{entry.nextFollowUpAt && <small>Next: {dateTime(entry.nextFollowUpAt)}</small>}</div></li>)}</ol> : <div className="empty-state">No contact attempts logged yet.</div>}
            <div className="admin-v2-followup-form"><div className="admin-v2-field-row"><label>Method<select className="input" value={contactMethod} onChange={event => setContactMethod(event.target.value as typeof contactMethod)}><option value="phone">Phone</option><option value="email">Email</option><option value="sms">SMS</option><option value="other">Other</option></select></label><label>Outcome<select className="input" value={followUpOutcome} onChange={event => setFollowUpOutcome(event.target.value as typeof followUpOutcome)}><option value="attempted">Attempted</option><option value="due">Follow-up due</option><option value="in_progress">In progress</option><option value="completed">HHH review completed</option><option value="unable_to_contact">Unable to contact</option></select></label></div><label className="admin-v2-check"><input type="checkbox" checked={reachedPatient} onChange={event => setReachedPatient(event.target.checked)} /> Patient reached</label><label>Call/contact note<textarea className="input" rows={4} value={callNote} onChange={event => setCallNote(event.target.value)} placeholder="Record what was discussed and the agreed next action." /></label><label>Next follow-up<input className="input" type="datetime-local" value={nextFollowUpAt} onChange={event => setNextFollowUpAt(event.target.value)} /></label><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void logAttempt()}>{busy ? 'Saving…' : 'Add to contact timeline'}</button></div>
          </section>
          <section className="admin-v2-panel admin-v2-requirements">
            <header><span><ClipboardList size={16} /><strong>Referral requirements</strong></span></header><p>These protected notes help HHH complete the referral and are not shown in the pharmacy queue.</p>
            <div className="admin-v2-followup-form"><div className="admin-v2-field-row"><label>Preferred contact<select className="input" value={preferredContactMethod} onChange={event => setPreferredContactMethod(event.target.value)}><option value="no_preference">No preference</option><option value="phone">Phone</option><option value="email">Email</option><option value="sms">SMS</option></select></label><label>Best time to contact<input className="input" value={bestTimeToContact} onChange={event => setBestTimeToContact(event.target.value)} /></label></div><label className="admin-v2-check"><input type="checkbox" checked={deliveryRequirement} onChange={event => setDeliveryRequirement(event.target.checked)} /> Delivery required</label><label>Collection preference<input className="input" value={collectionPreference} onChange={event => setCollectionPreference(event.target.value)} /></label><label>Mobility or accessibility needs<textarea className="input" rows={3} value={accessibilityRequirement} onChange={event => setAccessibilityRequirement(event.target.value)} /></label><label>Geographic restrictions<textarea className="input" rows={3} value={geographicRestrictions} onChange={event => setGeographicRestrictions(event.target.value)} /></label><label>Other non-clinical requirements<textarea className="input" rows={4} value={otherRequirements} onChange={event => setOtherRequirements(event.target.value)} /></label><button type="button" className="btn" disabled={busy} onClick={() => void saveRequirements()}>Save referral requirements</button></div>
          </section>
          <section className="admin-v2-panel admin-v2-case__assignment">
            <header><span><Send size={16} /><strong>Complete referral</strong></span>{lockedDestination && <span className="pill pill-info"><LockKeyhole size={12} /> Fixed destination</span>}</header>
            {lockedDestination ? <div className="admin-v2-locked-destination"><MapPin size={19} /><span><small>Dedicated-link pharmacy</small><strong>{String(detail.sourceOrganisationName ?? 'Source pharmacy')}</strong><p>This destination cannot be searched, replaced or reassigned.</p></span></div> : destinationConfirmed ? <div className="admin-v2-locked-destination"><MapPin size={19} /><span><small>Confirmed pharmacy</small><strong>{String(detail.assignedOrganisationName ?? 'Confirmed destination')}</strong><p>The patient remains HHH-only until the activation step below completes.</p></span></div> : <><p>The patient’s map selection is a preference only. Choose the final pharmacy after completing the HHH call.</p><div className="search-box"><Search size={15} /><input value={candidateQuery} onChange={event => setCandidateQuery(event.target.value)} placeholder="Search eligible pharmacies" aria-label="Search eligible pharmacies" /></div><button type="button" className="btn btn-sm" onClick={() => void findCandidates()} disabled={busy}>Load eligible destinations</button>{candidates.length > 0 && <label>Final pharmacy<select className="input" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Select a pharmacy</option>{candidates.map(candidate => <option key={String(candidate.id)} value={String(candidate.id)}>{String(candidate.tradingName)} · {candidate.approximateMiles == null ? 'distance unavailable' : `${candidate.approximateMiles} miles`} · {words(candidate.intakeState)}</option>)}</select></label>}</>}
            <label>Referral reason<select className="input" value={reason} disabled={lockedDestination} onChange={event => setReason(event.target.value)}><option value="dedicated_pharmacy_referral">Dedicated pharmacy link</option><option value="patient_preference">Patient preference</option><option value="capacity">Capacity</option><option value="delivery_or_collection">Delivery or collection needs</option><option value="geographic_coverage">Geographic coverage</option><option value="service_compatibility">Service compatibility</option><option value="administrative_correction">Administrative correction</option></select></label><label>Private HHH referral note<textarea className="input" rows={4} value={allocationNote} onChange={event => setAllocationNote(event.target.value)} /></label>
            {conflict && !lockedDestination && <label className="admin-v2-ack"><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} /> I acknowledge the existing legacy pharmacy activity and still intend to change this general-website destination.</label>}
            <div className={`admin-v2-referral-gate ${followUpComplete ? 'is-ready' : ''}`}><span>{followUpComplete ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</span><div><strong>{followUpComplete ? 'HHH review complete' : 'Complete the HHH review first'}</strong><small>{followUpComplete ? `Ready to refer and activate the patient for ${destinationName || 'the selected pharmacy'}.` : 'Log a completed contact outcome before activating the pharmacy patient record.'}</small></div></div>
            <div className="admin-v2-onboarding"><h3>Referral and patient activation</h3><p>This is one HHH workflow. The pharmacy does not review the intake application: after this action succeeds, the patient appears directly in its patient workspace.</p><label>Onboarding/records-check note<textarea className="input" rows={3} value={onboardingNote} onChange={event => setOnboardingNote(event.target.value)} /></label><div><button type="button" className="btn btn-primary" disabled={busy || !destination || !followUpComplete || patientActivated} onClick={() => void refer()}><Send size={15} /> {patientActivated ? 'Patient already active' : destinationConfirmed ? 'Finish patient activation' : lockedDestination ? `Refer and activate for ${String(detail.sourceOrganisationName ?? 'source pharmacy')}` : 'Refer and activate patient'}</button><button type="button" className="btn" disabled={busy} onClick={() => void decideOnboarding('declined')}>Decline application</button></div></div>
          </section>
        </div>
      </>}
    </section>}
  </div>;
}
