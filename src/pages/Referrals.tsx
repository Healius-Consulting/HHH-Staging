import { useState } from 'react';
import { Check, CheckCircle2, Clock3, Copy, LinkIcon, PhoneCall, ShieldCheck, XCircle } from 'lucide-react';
import { useApp, type SubmissionStatus } from '../context/AppContext';
import { eligibilityUrl } from '../utils/pharmacyResources';
import SummaryTiles from '../components/SummaryTiles';

const STATUS_META: Record<SubmissionStatus, { label: string; pill: string; icon: React.ReactNode }> = {
  New: { label: 'Received by HHH', pill: 'pill-info', icon: <Clock3 size={13} /> },
  'Under HHH review': { label: 'HHH review in progress', pill: 'pill-amber', icon: <PhoneCall size={13} /> },
  Approved: { label: 'Approved for onboarding', pill: 'pill-green', icon: <CheckCircle2 size={13} /> },
  Declined: { label: 'Not onboarded', pill: 'pill-red', icon: <XCircle size={13} /> },
};

export default function Referrals() {
  const { state, dispatch } = useApp();
  const [copied, setCopied] = useState(false);
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const attributedLink = eligibilityUrl(organisation);
  const submissions = state.submissions
    .filter(submission => submission.organisationId === organisation.id)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const pending = submissions.filter(submission => submission.status === 'New' || submission.status === 'Under HHH review').length;
  const approved = submissions.filter(submission => submission.status === 'Approved').length;

  const copyAttributedLink = async () => {
    try {
      await navigator.clipboard.writeText(attributedLink);
      setCopied(true);
      dispatch({ type: 'ADD_TOAST', message: `${organisation.tradingName} eligibility link copied.`, toastType: 'success' });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      dispatch({ type: 'ADD_TOAST', message: 'The eligibility link could not be copied. Use Forms & resources instead.', toastType: 'warning' });
    }
  };

  return (
    <div className="page-body">
      <section className="card intake-banner">
        <div className="intake-banner__inner">
          <div className="intake-banner__copy"><LinkIcon size={16} aria-hidden="true" /><div><strong>Pharmacy eligibility link</strong><span>Every submission through this link is attributed to {organisation.tradingName}.</span></div></div>
          <button type="button" className="btn btn-sm intake-copy-button" onClick={() => void copyAttributedLink()} aria-live="polite">
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy pharmacy link'}
          </button>
        </div>
      </section>

      <section className="integration-boundary card pharmacy-referral-boundary">
        <ShieldCheck size={20} />
        <div><strong>Holistic Health Hub controls programme onboarding</strong><p>The HHH team reviews the enquiry and calls the patient. Once HHH approves onboarding, the patient appears in your CRM and can be selected in the Rx Builder. Your pharmacy still needs a valid doctor’s prescription before taking payment or placing a Curaleaf order.</p></div>
      </section>

      <SummaryTiles className="summary-tiles--compact summary-tiles--three" label="Onboarding totals" items={[
        { label: 'Received', value: submissions.length, detail: 'attributed enquiries' },
        { label: 'In review', value: pending, detail: 'with HHH' },
        { label: 'Released', value: approved, detail: 'approved patients' },
      ]} />

      <section className="card admin-patient-table pharmacy-referral-register">
        <div className="admin-directory-head"><div><h2>Onboarding status</h2><p>This is a read-only pharmacy view. HHH records the telephone review and final onboarding decision.</p></div></div>
        {submissions.length === 0 ? <div className="empty-state">No patient enquiries have used this pharmacy link yet.</div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Submitted</th><th>Screening information</th><th>HHH contact</th><th>Decision</th></tr></thead><tbody>{submissions.map(submission => {
          const meta = STATUS_META[submission.status];
          return <tr key={submission.id}><td><strong>{submission.name}</strong><small>{submission.email} · {submission.mobile}</small></td><td>{new Date(submission.submittedAt).toLocaleDateString('en-GB')}<small>Source: {submission.source}</small></td><td><strong>{submission.condition}</strong><small>{submission.recordsUploaded ? 'Records noted' : 'Records not yet noted'}</small></td><td><strong>{submission.calls.length ? `${submission.calls.length} call${submission.calls.length === 1 ? '' : 's'} logged` : 'Awaiting call'}</strong><small>{submission.reviewedBy ? `Reviewed by ${submission.reviewedBy}` : 'HHH review team'}</small></td><td><span className={`pill ${meta.pill}`}>{meta.icon}{meta.label}</span>{submission.decisionNote && <small>{submission.decisionNote}</small>}</td></tr>;
        })}</tbody></table></div>}
      </section>
    </div>
  );
}
