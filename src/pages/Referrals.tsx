import { useState } from 'react';
import { Check, CheckCircle2, Clock3, Copy, LinkIcon, PhoneCall, ShieldCheck, XCircle } from 'lucide-react';
import { useApp, type SubmissionStatus } from '../context/AppContext';
import { eligibilityUrl } from '../utils/pharmacyResources';
import { onboardingStatusLabel } from '../utils/onboardingStatus';
import SummaryTiles from '../components/SummaryTiles';
import CompactPatientCell from '../components/CompactPatientCell';

const STATUS_META: Record<SubmissionStatus, { label: string; pill: string; icon: React.ReactNode }> = {
  New: { label: onboardingStatusLabel('New'), pill: 'pill-info', icon: <Clock3 size={13} /> },
  'Under HHH review': { label: onboardingStatusLabel('Under HHH review'), pill: 'pill-amber', icon: <PhoneCall size={13} /> },
  Approved: { label: onboardingStatusLabel('Approved'), pill: 'pill-green', icon: <CheckCircle2 size={13} /> },
  Declined: { label: onboardingStatusLabel('Declined'), pill: 'pill-red', icon: <XCircle size={13} /> },
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
        { label: 'Referred', value: approved, detail: 'completed referrals' },
      ]} />

      <section className="card admin-patient-table pharmacy-referral-register">
        <div className="admin-directory-head"><div><h2>Onboarding status</h2><p>This is a read-only pharmacy view. HHH records the call/check, referral completion and patient email separately.</p></div></div>
        {submissions.length === 0 ? <div className="empty-state">No patient enquiries have used this pharmacy link yet.</div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Submitted</th><th>Primary concern</th><th>Call / check</th><th>Referral</th><th>Email</th></tr></thead><tbody>{submissions.map(submission => {
          const meta = STATUS_META[submission.status];
          const recordsComplete = submission.recordsCheck?.status === 'completed' || submission.calls.length > 0;
          const emailStatus = submission.emailDelivery?.status ?? 'not_sent';
          return <tr key={submission.id}><td><CompactPatientCell name={submission.name} email={submission.email} mobile={submission.mobile} dob={submission.dob} /></td><td>{new Date(submission.submittedAt).toLocaleDateString('en-GB')}<small>Source: {submission.source}</small></td><td><strong>{submission.condition}</strong><small>Recorded from the eligibility form</small></td><td><strong>{recordsComplete ? 'Completed' : 'Pending'}</strong><small>{recordsComplete ? 'Recorded by HHH' : 'Awaiting HHH'}</small></td><td><div className="onboarding-status-stack"><span className={`pill onboarding-status-pill ${meta.pill}`}>{meta.icon}{meta.label}</span></div></td><td><strong>{emailStatus === 'not_sent' ? 'Not sent' : emailStatus.charAt(0).toUpperCase() + emailStatus.slice(1)}</strong><small>{emailStatus === 'queued' ? 'Awaiting delivery provider' : 'HHH communication'}</small></td></tr>;
        })}</tbody></table></div>}
      </section>
    </div>
  );
}
