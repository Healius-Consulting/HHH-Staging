import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiRequestError, getV2PharmacyEligibilityDetail, getV2PharmacyEligibilityQueue, updateV2PharmacyEligibilityReview } from '../shared/api';
import type { V2EligibilityQueueItem } from '../shared/contracts';

export default function EligibilityQueueV2() {
  const [records, setRecords] = useState<V2EligibilityQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewStatus, setReviewStatus] = useState('reviewing');
  const [outcomeStatus, setOutcomeStatus] = useState('open');

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setMessage(''); }
    try {
      const result = await getV2PharmacyEligibilityQueue();
      setRecords(result.records);
      if (selectedId && !result.records.some(record => record.id === selectedId)) {
        setSelectedId(null); setDetail(null); setMessage('That record is no longer available in this pharmacy workspace.');
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The eligibility queue could not be loaded.'); }
    finally { if (!silent) setLoading(false); }
  }, [selectedId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 10_000);
    const refreshOnFocus = () => void load(true);
    window.addEventListener('focus', refreshOnFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshOnFocus); };
  }, [load]);

  const open = async (caseId: string) => {
    setSelectedId(caseId); setDetail(null); setMessage('');
    try {
      const result = await getV2PharmacyEligibilityDetail(caseId);
      setDetail(result); setNotes(String(result.reviewNotes ?? ''));
      setReviewStatus(String(result.pharmacyReviewStatus ?? 'reviewing'));
      setOutcomeStatus(String(result.outcomeStatus ?? 'open'));
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 404) {
        setSelectedId(null); setMessage('That record is no longer available in this pharmacy workspace.'); void load();
      } else setMessage(cause instanceof Error ? cause.message : 'The record could not be opened.');
    }
  };

  const saveReview = async () => {
    if (!selectedId || !detail) return;
    setBusy(true); setMessage('');
    try {
      await updateV2PharmacyEligibilityReview(selectedId, { expectedVersion: Number(detail.version ?? 0), reviewStatus, outcomeStatus, notes: notes.trim() || null });
      await load();
      await open(selectedId);
      setMessage('Review saved.');
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 404) { setSelectedId(null); setDetail(null); setMessage('That record was reassigned and is no longer available.'); void load(); }
      else setMessage(cause instanceof Error ? cause.message : 'The review could not be saved.');
    } finally { setBusy(false); }
  };

  return <section className="eligibility-workspace" aria-labelledby="eligibility-queue-title">
    <header className="eligibility-workspace__head"><div><p className="section-label">Compatibility records</p><h2 id="eligibility-queue-title">Legacy eligibility</h2><p>This area is retained only for applications submitted through the previous pharmacy-review process. New HHH-first referrals appear directly under Patient records after HHH activates them.</p></div><button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button></header>
    <div className="eligibility-workspace__layout">
      <div className="eligibility-workspace__list" aria-busy={loading}>
        {loading ? <div className="empty-state"><LoaderCircle className="spin" size={20} /> Loading legacy eligibility…</div> : records.length === 0 ? <div className="empty-state"><ShieldCheck size={20} /><strong>No legacy reviews are waiting</strong><p>New referrals are handled by HHH and appear directly in Patient records once activated.</p></div> : records.map(record => <button key={record.id} type="button" className={selectedId === record.id ? 'active' : ''} onClick={() => void open(record.id)}><span><strong>{record.patientDisplayName}</strong><small>{record.caseReference} · {new Date(record.submittedAt).toLocaleDateString('en-GB')}</small></span><span className="pill pill-green">{record.displayStatus}</span></button>)}
      </div>
      <div className="eligibility-workspace__detail">
        {!selectedId ? <div className="empty-state"><ClipboardCheck size={24} /><strong>Select an application</strong><p>Contact and health information is fetched only after you open an assigned record.</p></div> : !detail ? <div className="empty-state"><LoaderCircle className="spin" size={20} /> Loading protected detail…</div> : <>
          <header><div><p className="section-label">{String(detail.caseReference)}</p><h3>{String(detail.patientDisplayName)}</h3></div><span className="pill pill-green">{String(detail.displayStatus)}</span></header>
          <div className="banner"><ShieldCheck size={16} /><span><strong>Referred by HHH.</strong> This application was made available to your pharmacy only after HHH confirmed the referral.</span></div>
          <dl className="eligibility-workspace__facts"><div><dt>Date of birth</dt><dd>{String(detail.dob ?? '—')}</dd></div><div><dt>Postcode</dt><dd>{String(detail.postcode ?? '—')}</dd></div><div><dt>Email</dt><dd>{String(detail.email ?? '—')}</dd></div><div><dt>Mobile</dt><dd>{String(detail.mobile ?? '—')}</dd></div><div><dt>Primary condition</dt><dd>{String(detail.primaryCondition ?? '—')}</dd></div><div><dt>Treatment history</dt><dd>{detail.triedTwoTreatments ? 'Two treatments reported' : 'Needs review'}</dd></div></dl>
          <div className="eligibility-workspace__review"><label>Referral review status<select className="input" value={reviewStatus} onChange={event => setReviewStatus(event.target.value)}><option value="opened">Opened</option><option value="reviewing">Reviewing</option><option value="eligible">Accepted</option><option value="ineligible">Unable to accept</option><option value="needs_information">Needs information</option><option value="completed">Completed</option></select></label><label>Outcome<select className="input" value={outcomeStatus} onChange={event => setOutcomeStatus(event.target.value)}><option value="open">Open</option><option value="completed">Completed</option><option value="declined">Declined</option><option value="withdrawn">Withdrawn</option></select></label><label className="wide">Pharmacy referral notes<textarea className="input" rows={4} value={notes} onChange={event => setNotes(event.target.value)} /></label><button type="button" className="btn btn-primary wide" onClick={() => void saveReview()} disabled={busy}>{busy ? 'Saving…' : 'Save referral review'}</button></div>
        </>}
      </div>
    </div>
    {message && <div className="banner" role="status" aria-live="polite">{message}</div>}
  </section>;
}
