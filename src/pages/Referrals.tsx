import { useState, useEffect } from 'react';
import { useApp, PHARMACY, type SubmissionStatus, type EligibilitySubmission } from '../context/AppContext';
import { Upload, Phone, Send, CheckCircle, FileText, LinkIcon, Clock } from 'lucide-react';

const STAGES: SubmissionStatus[] = ['New', 'Records uploaded', 'Referred to clinic', 'Completed'];
const STAGE_LABELS = ['New Enquiry', 'Records Uploaded', 'Referred to Clinic', 'CRM Confirmed'];

function statusPill(status: SubmissionStatus) {
  switch (status) {
    case 'Completed':
      return <span className="pill pill-green"><CheckCircle size={12} /> Completed</span>;
    case 'Referred to clinic':
      return <span className="pill pill-info">Referred to clinic</span>;
    case 'Records uploaded':
      return <span className="pill pill-amber">Records uploaded</span>;
    case 'New':
      return <span className="pill pill-red">New Enquiry</span>;
  }
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function SubmissionCard({ sub }: { sub: EligibilitySubmission }) {
  const { dispatch } = useApp();
  const currentIdx = STAGES.indexOf(sub.status);

  // Local card exit animation state
  const [isExiting, setIsExiting] = useState(false);

  // Scanning progress states
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const handleUpload = () => {
    setIsScanning(true);
    setScanProgress(0);
    dispatch({ type: 'ADD_TOAST', message: `Initializing health records OCR scan for ${sub.name}...`, toastType: 'info' });
  };

  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        const next = prev + Math.floor(Math.random() * 12) + 6;
        if (next >= 100) {
          clearInterval(interval);
          setIsScanning(false);
          
          // Trigger card exit animation, then update status
          setIsExiting(true);
          setTimeout(() => {
            dispatch({ type: 'UPLOAD_RECORDS', subId: sub.id });
            dispatch({ type: 'ADD_TOAST', message: `OCR parsed 4 medical documents for ${sub.name}`, toastType: 'success' });
          }, 400);

          return 100;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isScanning, sub.id, sub.name, dispatch]);

  const handleReferClinic = () => {
    setIsExiting(true);
    setTimeout(() => {
      dispatch({ type: 'REFER_TO_CLINIC', subId: sub.id });
      dispatch({ type: 'ADD_TOAST', message: `Referred ${sub.name} to clinic. Clinic Reference generated.`, toastType: 'success' });
    }, 400);
  };

  const handleEmailConfirm = () => {
    setIsExiting(true);
    setTimeout(() => {
      dispatch({ type: 'EMAIL_REFERRAL', subId: sub.id });
      dispatch({ type: 'ADD_TOAST', message: `Referral confirmed. CRM profile created for ${sub.name}`, toastType: 'success' });
    }, 400);
  };

  const handleLogCall = () => {
    dispatch({ type: 'LOG_CALL', subId: sub.id });
    dispatch({ type: 'ADD_TOAST', message: `Call logged for patient ${sub.name}`, toastType: 'info' });
  };

  return (
    <div className={`card card-spaced ${isExiting ? 'card-exit' : ''}`}>
      <div className="card-header">
        <span className="card-title-md">{sub.name}</span>
        {statusPill(sub.status)}
      </div>

      <div className="detail-grid">
        <div className="detail-cell">
          <strong className="text-primary">Medical Condition:</strong> {sub.condition}<br />
          <strong className="text-primary">DOB:</strong> {sub.dob} &middot; <strong className="text-primary">Postcode:</strong> {sub.postcode}
        </div>
        <div className="detail-cell">
          <strong className="text-primary">Email:</strong> {sub.email}<br />
          <strong className="text-primary">Mobile:</strong> {sub.mobile}
        </div>
        <div className="detail-cell">
          <strong className="text-primary">Tried ≥2 treatments:</strong>{' '}
          <span className={sub.tried2 ? 'text-green font-semibold' : 'text-red font-semibold'}>{sub.tried2 ? 'Yes (Pass)' : 'No'}</span><br />
          <strong className="text-primary">Psychosis exclusion:</strong>{' '}
          <span className={sub.psychExclusion ? 'text-red font-semibold' : 'text-green font-semibold'}>{sub.psychExclusion ? 'Yes (Excluded)' : 'No (Passed)'}</span>
        </div>
      </div>

      <div className="consent-meta">
        <strong>Consent Logs:</strong> &nbsp;
        Costs &amp; referral: {sub.consentReferral ? '✓' : '✗'} &nbsp;·&nbsp;
        Share records: {sub.consentShare ? '✓' : '✗'} &nbsp;·&nbsp;
        Marketing: {sub.marketing ? '✓' : '✗'} &nbsp;·&nbsp;
        Source: {sub.source}
      </div>

      {/* Track bar */}
      <div className="track-bar" style={{ marginBottom: 16 }}>
        {STAGE_LABELS.map((label, i) => {
          let cls = 'track-step';
          if (i < currentIdx) cls += ' done';
          else if (i === currentIdx) cls += ' done active';
          return (
            <div key={label} className={cls}>
              {label}
            </div>
          );
        })}
      </div>

      {/* Interactive scanning container */}
      {isScanning && (
        <div className="scanner-container scanning" style={{ marginBottom: 12 }}>
          <div className="scanner-laser" />
          <div className="text-xs font-semibold text-green" style={{ marginBottom: 6 }}>
            OCR scanning records &amp; extracting clinical history...
          </div>
          <div className="scan-progress-wrapper">
            <div className="scan-progress-track">
              <div className="scan-progress-fill" style={{ width: `${scanProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-sm flex-wrap" style={{ marginTop: 12 }}>
        {!sub.recordsUploaded && (
          <button
            className="btn btn-primary btn-sm"
            disabled={isScanning}
            onClick={handleUpload}
          >
            <Upload size={13} /> {isScanning ? `Scanning ${scanProgress}%...` : 'Upload clinical files'}
          </button>
        )}

        {sub.recordsUploaded && !sub.clinicRef && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleReferClinic}
          >
            <Send size={13} /> Submit Clinic Referral
          </button>
        )}

        {sub.clinicRef && !sub.emailedAt && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleEmailConfirm}
          >
            <Send size={13} /> Email Referral Approval
          </button>
        )}

        <button
          className="btn btn-sm"
          onClick={handleLogCall}
        >
          <Phone size={13} /> Log call activity
        </button>
      </div>

      {/* Completed notification */}
      {sub.status === 'Completed' && (
        <div className="banner banner-green" style={{ marginTop: 12 }}>
          <CheckCircle size={16} />
          <span className="text-sm">Clinic Intake Complete — Patient profile added to CRM database.</span>
        </div>
      )}

      {/* Processing audit logs */}
      {(sub.recordsUploaded || sub.calls.length > 0 || sub.clinicRef || sub.emailedAt) && (
        <>
          <div className="divider" />
          <div className="text-xs font-bold text-muted uppercase" style={{ marginBottom: 6 }}>
            Audit log history
          </div>
          <div className="text-xs text-secondary" style={{ lineHeight: 1.8 }}>
            {sub.recordsUploaded && (
              <div className="flex items-center gap-sm">
                <FileText size={12} /> OCR scans verified and saved.
              </div>
            )}
            {sub.calls.map((c, i) => (
              <div key={i} className="flex items-center gap-sm">
                <Phone size={12} /> Callback logged &mdash; {fmtDate(new Date(c.ts))} at {fmtTime(new Date(c.ts))}
              </div>
            ))}
            {sub.clinicRef && (
              <div className="flex items-center gap-sm">
                <Send size={12} /> B2B Clinic Reference assigned: <strong className="text-primary">{sub.clinicRef}</strong>
              </div>
            )}
            {sub.emailedAt && (
              <div className="flex items-center gap-sm">
                <CheckCircle size={12} /> Confirmation email dispatched &mdash; {fmtDate(new Date(sub.emailedAt))} at {fmtTime(new Date(sub.emailedAt))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


export default function Referrals() {
  const { state } = useApp();
  const [activeTab, setActiveTab] = useState<SubmissionStatus | 'all'>('New');

  const filtered = state.submissions
    .filter(s => activeTab === 'all' ? true : s.status === activeTab)
    .sort((a, b) => b.id - a.id);

  return (
    <div className="page-body">
      {/* Eligibility form URL co-branding card */}
      <div className="card card-surface intake-banner">
        <div className="intake-banner__inner">
          <div className="flex items-center gap-sm text-sm">
            <LinkIcon size={14} className="text-green" />
            <span className="text-muted">Eligibility Intake Form Widget:</span>
            <a
              href="/specs/HHH-Eligibility-Form.html"
              target="_blank"
              rel="noopener noreferrer"
              className="intake-banner__link"
            >
              {PHARMACY.formUrl} (Open Live Widget)
            </a>
          </div>
          <span className="text-xs text-tertiary">Embed this link into clinic websites to capture enquiries.</span>
        </div>
      </div>

      {/* Stats summary grid / tab selectors */}
      <div className="filter-grid">
        <div className={`card card-surface filter-card ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          <div className="filter-card__head">
            <span>All Intake</span>
            <FileText size={14} className={activeTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{state.submissions.length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'New' ? 'active' : ''}`} onClick={() => setActiveTab('New')}>
          <div className="filter-card__head">
            <span>Enquiries</span>
            <Clock size={14} className={activeTab === 'New' ? 'text-red' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{state.submissions.filter(s => s.status === 'New').length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'Records uploaded' ? 'active' : ''}`} onClick={() => setActiveTab('Records uploaded')}>
          <div className="filter-card__head">
            <span>Clinical Files</span>
            <FileText size={14} className={activeTab === 'Records uploaded' ? 'text-amber' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{state.submissions.filter(s => s.status === 'Records uploaded').length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'Referred to clinic' ? 'active' : ''}`} onClick={() => setActiveTab('Referred to clinic')}>
          <div className="filter-card__head">
            <span>Referred</span>
            <Send size={14} className={activeTab === 'Referred to clinic' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{state.submissions.filter(s => s.status === 'Referred to clinic').length}</span>
        </div>

        <div className={`card card-surface filter-card ${activeTab === 'Completed' ? 'active' : ''}`} onClick={() => setActiveTab('Completed')}>
          <div className="filter-card__head">
            <span>Active in CRM</span>
            <CheckCircle size={14} className={activeTab === 'Completed' ? 'text-green' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{state.submissions.filter(s => s.status === 'Completed').length}</span>
        </div>
      </div>

      {/* Submissions list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><FileText size={28} /></div>
          No intake submissions recorded in this stage.
        </div>
      ) : (
        filtered.map(sub => <SubmissionCard key={sub.id} sub={sub} />)
      )}
    </div>
  );
}
