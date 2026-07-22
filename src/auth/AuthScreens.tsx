import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, LogIn, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { firebaseConfiguration, mfaRequired } from './firebase';
import { useAuth } from './useAuth';
import HhhBrandMark from '../components/HhhBrandMark';

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="staff-login-page auth-page">
      <section className="staff-login-brand">
        <div className="staff-login-lockup" aria-label="Holistic Health Hub">
          <HhhBrandMark />
          <span>Holistic<br />Health Hub</span>
        </div>
        <p className="section-label">Secure staff platform</p>
        <h1>One secure sign-in.<br />The right workspace.</h1>
        <p>HHH administrators and pharmacy staff use verified, role-controlled access. Patient accounts are not supported in this staff application.</p>
        <div className="staff-login-trust"><span><ShieldCheck size={16} /> Tenant isolation</span><span><KeyRound size={16} /> {mfaRequired ? 'Mandatory MFA' : 'Verified staff access'}</span></div>
      </section>
      <section className="staff-login-panel">{children}</section>
    </div>
  );
}

export function ConfigurationRequired() {
  return (
    <AuthShell>
      <section className="card staff-login-card auth-configuration-required" role="status">
        <div className="staff-login-heading"><div className="resource-icon"><LockKeyhole size={20} /></div><div><p className="section-label">Configuration required</p><h2>Connect Firebase Authentication</h2></div></div>
        <p>This deployment is intentionally locked because Firebase staff authentication has not been configured.</p>
        <div className="banner banner-amber"><AlertCircle size={16} /><span>Add the following Vercel environment variables, then redeploy.</span></div>
        <ul className="auth-config-list">
          {firebaseConfiguration.missingKeys.map(key => <li key={key}><code>{key}</code></li>)}
          <li><code>VITE_FIREBASE_APP_CHECK_SITE_KEY</code> <small>recommended for deployed environments</small></li>
          <li><code>VITE_API_BASE_URL</code> <small>required for backend operations</small></li>
        </ul>
        <p className="staff-login-note">No demo password or bypass is enabled. Configure invited staff users with role claims in Firebase before testing.</p>
      </section>
    </AuthShell>
  );
}

export function StaffLogin() {
  const { state, signIn, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    if (resetMode) {
      try {
        await sendPasswordReset(email);
        setMessage('If an invited staff account exists for that address, Firebase will send reset instructions.');
      } catch {
        setMessage('Password reset is temporarily unavailable. Contact an HHH administrator.');
      }
      return;
    }
    await signIn(email, password);
  };

  return (
    <AuthShell>
      <form className="card staff-login-card" onSubmit={submit}>
        <div className="staff-login-heading"><div className="resource-icon"><LockKeyhole size={20} /></div><div><p className="section-label">Staff access</p><h2>{resetMode ? 'Reset your password' : 'Sign in to HHH'}</h2></div></div>
        {state.notice && <div className="banner banner-blue" role="status"><CheckCircle2 size={15} /> {state.notice}</div>}
        <label className="staff-login-field">Email address<div className="staff-login-input"><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required placeholder="name@pharmacy.co.uk" /></div></label>
        {!resetMode && <label className="staff-login-field">Password<div className="staff-login-input"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>}
        {state.error && <div className="banner banner-red" role="alert"><AlertCircle size={15} /> {state.error}</div>}
        {message && <div className="banner banner-blue" role="status">{message}</div>}
        <button className="btn btn-primary staff-login-submit" type="submit" disabled={state.phase === 'loading'}>{state.phase === 'loading' ? <LoaderCircle size={16} /> : resetMode ? <RefreshCw size={16} /> : <LogIn size={16} />} {state.phase === 'loading' ? 'Checking…' : resetMode ? 'Send reset email' : 'Sign in'}</button>
        <button className="btn btn-sm auth-link-button" type="button" onClick={() => { setResetMode(value => !value); setMessage(null); }}>{resetMode ? 'Back to sign in' : 'Forgotten your password?'}</button>
        <p className="staff-login-note">Access is invite-only. Authentication events and access to pharmacy data are auditable.</p>
      </form>
    </AuthShell>
  );
}

export function EmailVerificationGate() {
  const { state, resendVerification, refreshVerification, signOutStaff } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell>
      <section className="card staff-login-card">
        <div className="staff-login-heading"><div className="resource-icon"><Mail size={20} /></div><div><p className="section-label">Identity check</p><h2>Verify your email address</h2></div></div>
        <p>Open the Firebase verification email sent to <strong>{state.staff?.email}</strong>. Workspace data remains locked until verification is complete.</p>
        {message && <div className="banner banner-blue" role="status">{message}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); void refreshVerification().catch(() => setMessage('Verification could not be checked yet.')).finally(() => setBusy(false)); }}><RefreshCw size={15} /> I have verified my email</button>
        <button className="btn" disabled={busy} onClick={() => { setBusy(true); void resendVerification().then(() => setMessage('A new verification email has been sent.')).catch(() => setMessage('A new email could not be sent yet.')).finally(() => setBusy(false)); }}>Resend verification</button>
        <button className="btn btn-sm" onClick={() => void signOutStaff()}>Use another account</button>
      </section>
    </AuthShell>
  );
}

export function MfaChallenge() {
  const { state, completeMfaChallenge, signOutStaff } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell>
      <form className="card staff-login-card" onSubmit={event => { event.preventDefault(); setBusy(true); void completeMfaChallenge(code).finally(() => setBusy(false)); }}>
        <div className="staff-login-heading"><div className="resource-icon"><ShieldCheck size={20} /></div><div><p className="section-label">Two-step verification</p><h2>Enter your authenticator code</h2></div></div>
        <p>Enter the current six-digit code from the authenticator app registered to your HHH staff account.</p>
        <label className="staff-login-field">Verification code<input className="input auth-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required /></label>
        {state.error && <div className="banner banner-red" role="alert"><AlertCircle size={15} /> {state.error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>Verify and continue</button>
        <button className="btn btn-sm" type="button" onClick={() => void signOutStaff()}>Cancel sign-in</button>
      </form>
    </AuthShell>
  );
}

export function MfaEnrollmentGate() {
  const { state, beginTotpEnrollment, completeTotpEnrollment, signOutStaff } = useAuth();
  const [details, setDetails] = useState<{ secretKey: string; qrCodeUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = () => {
    setBusy(true);
    setError(null);
    void beginTotpEnrollment().then(setDetails).catch(cause => setError(cause instanceof Error ? cause.message : 'Authenticator enrolment could not begin.')).finally(() => setBusy(false));
  };

  const complete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void completeTotpEnrollment(code).catch(cause => setError(cause instanceof Error ? cause.message : 'That code could not be verified.')).finally(() => setBusy(false));
  };

  return (
    <AuthShell>
      <form className="card staff-login-card mfa-enrollment-card" onSubmit={complete}>
        <div className="staff-login-heading"><div className="resource-icon"><ShieldCheck size={20} /></div><div><p className="section-label">Required security setup</p><h2>Protect your staff account</h2></div></div>
        <p>{mfaRequired ? 'HHH requires a time-based one-time password (TOTP) before staff can access pharmacy data.' : 'Set up a time-based one-time password (TOTP) to add another layer of protection to this staff account.'}</p>
        {!details ? (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={begin}>Set up authenticator</button>
        ) : (
          <>
            <img className="mfa-qr-code" src={details.qrCodeUrl} alt="QR code for authenticator enrolment" />
            <div className="mfa-manual-key"><span>Manual setup key</span><code>{details.secretKey}</code></div>
            <label className="staff-login-field">Six-digit verification code<input className="input auth-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required /></label>
            <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>Verify and finish</button>
          </>
        )}
        {(error || state.error) && <div className="banner banner-red" role="alert"><AlertCircle size={15} /> {error || state.error}</div>}
        <button className="btn btn-sm" type="button" onClick={() => void signOutStaff()}>Sign out</button>
      </form>
    </AuthShell>
  );
}

export function AuthLoading() {
  return <div className="auth-loading-page" role="status"><LoaderCircle size={22} /> Checking secure session…</div>;
}
