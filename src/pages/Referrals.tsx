import { useState, useEffect } from 'react';
import { useApp, PHARMACY, type SubmissionStatus, type EligibilitySubmission } from '../context/AppContext';
import { Upload, Phone, Send, CheckCircle, FileText, LinkIcon, Clock } from 'lucide-react';

const STATUS_PRIORITY: Record<SubmissionStatus, number> = {
  'New': 0,
  'Records uploaded': 1,
  'Referred to clinic': 2,
  'Completed': 3,
};

const STAGES: SubmissionStatus[] = ['New', 'Records uploaded', 'Referred to clinic', 'Completed'];
const STAGE_LABELS = ['New', 'Records', 'Referred', 'Completed'];

function statusPill(status: SubmissionStatus) {
  switch (status) {
    case 'Completed':
      return <span className="pill pill-green"><CheckCircle size={12} /> Completed</span>;
    case 'Referred to clinic':
      return <span className="pill pill-info">Referred to clinic</span>;
    case 'Records uploaded':
      return <span className="pill pill-amber">Records uploaded</span>;
    case 'New':
      return <span className="pill pill-red">New</span>;
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

  // Scanning progress states
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const handleUpload = () => {
    setIsScanning(true);
    setScanProgress(0);
    dispatch({ type: 'ADD_TOAST', message: `Initializing health records scan for ${sub.name}...`, toastType: 'info' });
  };

  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        const next = prev + Math.floor(Math.random() * 12) + 6;
        if (next >= 100) {
          clearInterval(interval);
          setIsScanning(false);
          dispatch({ type: 'UPLOAD_RECORDS', subId: sub.id });
          dispatch({ type: 'ADD_TOAST', message: `OCR parsed 4 medical documents for ${sub.name}`, toastType: 'success' });
          return 100;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isScanning, sub.id, sub.name, dispatch]);

  const handleReferClinic = () => {
    dispatch({ type: 'REFER_TO_CLINIC', subId: sub.id });
    dispatch({ type: 'ADD_TOAST', message: `Referred ${sub.name} to clinic. Clinic Reference generated.`, toastType: 'success' });
  };

  const handleEmailConfirm = () => {
    dispatch({ type: 'EMAIL_REFERRAL', subId: sub.id });
    dispatch({ type: 'ADD_TOAST', message: `Referral confirmed. CRM profile created for ${sub.name}`, toastType: 'success' });
  };

  const handleLogCall = () => {
    dispatch({ type: 'LOG_CALL', subId: sub.id });
    dispatch({ type: 'ADD_TOAST', message: `Call logged for patient ${sub.name}`, toastType: 'info' });
  };

  return (
    <div className="card" style={{ transition: 'all 0.3s ease' }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span className="font-semibold">{sub.name}</span>
        {statusPill(sub.status)}
      </div>

      {/* Patient details */}
      <div className="text-xs text-faint" style={{ marginBottom: 8, lineHeight: 1.7 }}>
        <strong>Condition:</strong> {sub.condition} &nbsp;·&nbsp;
        <strong>DOB:</strong> {sub.dob} &nbsp;·&nbsp;
        <strong>Postcode:</strong> {sub.postcode}<br />
        <strong>Email:</strong> {sub.email} &nbsp;·&nbsp;
        <strong>Mobile:</strong> {sub.mobile}
      </div>

      {/* Eligibility */}
      <div className="text-xs text-muted" style={{ marginBottom: 6 }}>
        <strong>Tried ≥2 treatments:</strong>{' '}
        <span className={sub.tried2 ? 'text-green' : 'text-red'}>{sub.tried2 ? 'Yes' : 'No'}</span>
        &nbsp;&nbsp;·&nbsp;&nbsp;
        <strong>Psychosis exclusion:</strong>{' '}
        <span className={sub.psychExclusion ? 'text-red' : 'text-green'}>{sub.psychExclusion ? 'Yes' : 'No'}</span>
      </div>

      {/* Consent */}
      <div className="text-xs text-faint" style={{ marginBottom: 6 }}>
        <strong>Consent:</strong>{' '}
        Costs & referral: {sub.consentReferral ? '✓' : '✗'} &nbsp;·&nbsp;
        Share info: {sub.consentShare ? '✓' : '✗'} &nbsp;·&nbsp;
        Marketing: {sub.marketing ? '✓' : '✗'} &nbsp;·&nbsp;
        Source: {sub.source}
      </div>

      {/* Track bar */}
      <div className="track-bar">
        {STAGE_LABELS.map((label, i) => {
          let cls = 'track-step';
          if (i < currentIdx) cls += ' done';
          else if (i === currentIdx) cls += ' done active';
          return (
            <div key={label} className={cls}>
              <div className="bar" />
              {label}
            </div>
          );
        })}
      </div>

      {/* Interactive scanning container */}
      {isScanning && (
        <div className="scanner-container scanning" style={{ marginTop: 12, marginBottom: 12 }}>
          <div className="scanner-laser" />
          <div className="text-xs font-semibold text-green" style={{ marginBottom: 6 }}>
            OCR scanning records & extracting medical data...
          </div>
          <div className="scan-progress-wrapper">
            <div className="scan-progress-track">
              <div className="scan-progress-fill" style={{ width: `${scanProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-sm flex-wrap" style={{ marginTop: 10 }}>
        {!sub.recordsUploaded && (
          <button
            className="btn btn-primary btn-sm"
            disabled={isScanning}
            onClick={handleUpload}
          >
            <Upload size={13} /> {isScanning ? `Scanning ${scanProgress}%...` : 'Upload health records'}
          </button>
        )}

        {sub.recordsUploaded && !sub.clinicRef && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleReferClinic}
          >
            <Send size={13} /> Refer to Curaleaf Clinic
          </button>
        )}

        {sub.clinicRef && !sub.emailedAt && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleEmailConfirm}
          >
            <Send size={13} /> Email patient (confirm referral)
          </button>
        )}

        <button
          className="btn btn-sm"
          onClick={handleLogCall}
        >
          <Phone size={13} /> Log call
        </button>
      </div>

      {/* Completed message */}
      {sub.status === 'Completed' && (
        <div className="banner banner-green" style={{ marginTop: 10 }}>
          <CheckCircle size={16} />
          <span className="text-sm">Referral complete — patient has been added to the CRM.</span>
        </div>
      )}

      {/* Processing log */}
      {(sub.recordsUploaded || sub.calls.length > 0 || sub.clinicRef || sub.emailedAt) && (
        <>
          <div className="divider" />
          <div className="text-xs text-faint font-semibold" style={{ marginBottom: 6 }}>
            Processing log
          </div>
          <div className="text-xs text-muted" style={{ lineHeight: 1.8 }}>
            {sub.recordsUploaded && (
              <div className="flex items-center gap-sm">
                <FileText size={12} /> Health records uploaded
              </div>
            )}
            {sub.calls.map((c, i) => (
              <div key={i} className="flex items-center gap-sm">
                <Phone size={12} /> Call logged — {fmtDate(new Date(c.ts))} at {fmtTime(new Date(c.ts))}
              </div>
            ))}
            {sub.clinicRef && (
              <div className="flex items-center gap-sm">
                <Send size={12} /> Referred to clinic — Ref: <strong>{sub.clinicRef}</strong>
              </div>
            )}
            {sub.emailedAt && (
              <div className="flex items-center gap-sm">
                <CheckCircle size={12} /> Confirmation email sent — {fmtDate(new Date(sub.emailedAt))} at {fmtTime(new Date(sub.emailedAt))}
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

  const sorted = [...state.submissions].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
  );

  return (
    <div className="page-body">
      <h2 className="page-title">Referrals</h2>
      <p className="page-subtitle">{PHARMACY.name}</p>

      {/* Eligibility form URL */}
      <div className="card card-surface" style={{ marginBottom: 16 }}>
        <div className="flex items-center gap-sm text-sm">
          <LinkIcon size={14} className="text-green" />
          <span className="text-muted">Eligibility form:</span>
          <a
            href={`https://${PHARMACY.formUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green font-semibold"
            style={{ textDecoration: 'none' }}
          >
            {PHARMACY.formUrl}
          </a>
        </div>
      </div>

      {/* Stats summary */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon red"><Clock size={18} /></div>
          <div className="stat-value">{state.submissions.filter(s => s.status === 'New').length}</div>
          <div className="stat-label">New submissions</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><FileText size={18} /></div>
          <div className="stat-value">{state.submissions.filter(s => s.status === 'Records uploaded').length}</div>
          <div className="stat-label">Records uploaded</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info"><Send size={18} /></div>
          <div className="stat-value">{state.submissions.filter(s => s.status === 'Referred to clinic').length}</div>
          <div className="stat-label">Referred to clinic</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={18} /></div>
          <div className="stat-value">{state.submissions.filter(s => s.status === 'Completed').length}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      {/* Submissions list */}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><FileText size={22} /></div>
          No eligibility submissions yet.
        </div>
      ) : (
        sorted.map(sub => <SubmissionCard key={sub.id} sub={sub} />)
      )}
    </div>
  );
}
