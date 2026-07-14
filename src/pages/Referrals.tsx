import { CheckCircle2, Clock3, FileText, LinkIcon, PhoneCall, ShieldCheck, XCircle } from 'lucide-react';
import { useApp, type SubmissionStatus } from '../context/AppContext';
import { eligibilityUrl } from '../utils/pharmacyResources';

const STATUS_META: Record<SubmissionStatus, { label: string; pill: string; icon: React.ReactNode }> = {
  New: { label: 'Received by HHH', pill: 'pill-info', icon: <Clock3 size={13} /> },
  'Under HHH review': { label: 'HHH review in progress', pill: 'pill-amber', icon: <PhoneCall size={13} /> },
  Approved: { label: 'Approved for onboarding', pill: 'pill-green', icon: <CheckCircle2 size={13} /> },
  Declined: { label: 'Not onboarded', pill: 'pill-red', icon: <XCircle size={13} /> },
};

export default function Referrals() {
  const { state } = useApp();
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const submissions = state.submissions
    .filter(submission => submission.organisationId === organisation.id)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const pending = submissions.filter(submission => submission.status === 'New' || submission.status === 'Under HHH review').length;
  const approved = submissions.filter(submission => submission.status === 'Approved').length;

  return (
    <div className="page-body">
      <section className="card intake-banner">
        <div className="intake-banner__inner">
          <div className="flex items-center gap-sm text-sm"><LinkIcon size={14} className="text-green" /><span className="text-muted">Your attributed eligibility link:</span><a href={eligibilityUrl(organisation)} target="_blank" rel="noopener noreferrer" className="intake-banner__link">Open {organisation.tradingName} form</a></div>
          <span className="text-xs text-tertiary">Every submission made through this link remains linked to your pharmacy.</span>
        </div>
      </section>

      <section className="integration-boundary card pharmacy-referral-boundary">
        <ShieldCheck size={20} />
        <div><strong>Holistic Health Hub controls programme onboarding</strong><p>Shaylen reviews the enquiry and calls the patient. Once HHH approves onboarding, the patient appears in your CRM and can be selected in the Rx Builder. Your pharmacy still needs a valid doctor’s prescription before taking payment or placing a Curaleaf order.</p></div>
      </section>

      <div className="stats-grid referral-summary-grid">
        <div className="stat-card"><FileText size={18} /><strong>{submissions.length}</strong><span>Attributed enquiries</span></div>
        <div className="stat-card"><Clock3 size={18} /><strong>{pending}</strong><span>With HHH for review</span></div>
        <div className="stat-card"><CheckCircle2 size={18} /><strong>{approved}</strong><span>Approved patients</span></div>
      </div>

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
