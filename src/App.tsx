import { useEffect, useState, type FormEvent } from 'react';
import { AppProvider, useApp, type StaffSession } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import CreateOrder from './pages/CreateOrder';
import AwaitingPayment from './pages/AwaitingPayment';
import Orders from './pages/Orders';
import Patients from './pages/Patients';
import PatientPortal from './pages/PatientPortal';
import AdminPortal from './pages/AdminPortal';
import EligibilityForm from './pages/EligibilityForm';
import PharmacyResources from './pages/PharmacyResources';
import PharmacySettings from './pages/PharmacySettings';
import { eligibilityUrl } from './utils/pharmacyResources';
import { tenantThemeVariables } from './utils/tenantTheme';
import { X, CheckCircle, Info, AlertTriangle, AlertCircle, User, ShieldCheck, Mail, LockKeyhole, LogIn, Building2 } from 'lucide-react';

function ToastItem({ toast }: { toast: { id: string; message: string; type: 'success' | 'info' | 'warning' | 'error' } }) {
  const { dispatch } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', id: toast.id });
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, dispatch]);

  let Icon = Info;
  if (toast.type === 'success') Icon = CheckCircle;
  if (toast.type === 'warning') Icon = AlertTriangle;
  if (toast.type === 'error') Icon = AlertCircle;

  const colorClass = 
    toast.type === 'success' ? 'text-green' : 
    toast.type === 'warning' ? 'text-amber' : 
    toast.type === 'error' ? 'text-red' : '';

  return (
    <div className={`toast toast-${toast.type}`}>
      <div className={colorClass} style={{ display: 'flex', marginTop: 2 }}>
        <Icon size={16} />
      </div>
      <div className="toast-content">{toast.message}</div>
      <button
        className="toast-close"
        onClick={() => dispatch({ type: 'REMOVE_TOAST', id: toast.id })}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ToastContainer() {
  const { state } = useApp();

  return (
    <div className="toast-container">
      {state.toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

const DEMO_STAFF_ACCOUNTS: Array<StaffSession & { password: string; label: string }> = [
  { email: 'admin@hhh.health', password: 'AdminDemo2026!', name: 'HHH Platform Admin', role: 'admin', label: 'HHH administrator' },
  { email: 'leeds@hhh.health', password: 'PharmacyDemo2026!', name: 'Leeds Pharmacy Manager', role: 'pharmacy', organisationId: '11111111-1111-4111-8111-111111111111', label: 'HHH Leeds pharmacy' },
  { email: 'lincoln@hhh.health', password: 'PharmacyDemo2026!', name: 'Lincoln Pharmacy Manager', role: 'pharmacy', organisationId: '22222222-2222-4222-8222-222222222222', label: 'East Midlands pharmacy' },
];

function StaffLogin() {
  const { state, dispatch } = useApp();
  const organisation = state.organisations[0];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const account = DEMO_STAFF_ACCOUNTS.find(candidate => candidate.email.toLowerCase() === email.trim().toLowerCase() && candidate.password === password);
    if (!account) { setError('Email or password not recognised. Use one of the demo accounts below.'); return; }
    const { password: _password, label: _label, ...session } = account;
    dispatch({ type: 'SIGN_IN_STAFF', session });
  };

  const chooseDemo = (account: typeof DEMO_STAFF_ACCOUNTS[number]) => {
    setEmail(account.email); setPassword(account.password); setError('');
  };

  return (
    <div className="staff-login-page">
      <section className="staff-login-brand">
        <img className="staff-login-wordmark" src="/holistic-health-hub-logo.png" alt="Holistic Health Hub" />
        <p className="section-label">Healius Consulting platform</p>
        <h1>One secure sign-in.<br />The right workspace.</h1>
        <p>Administrators see all pharmacy clients. Pharmacy staff are routed directly into their organisation’s private operations portal.</p>
        <div className="staff-login-trust"><span><ShieldCheck size={16} /> Role-based access</span><span><Building2 size={16} /> Pharmacy tenant isolation</span></div>
      </section>

      <section className="staff-login-panel">
        <form className="card staff-login-card" onSubmit={signIn}>
          <div className="staff-login-heading"><div className="resource-icon"><LockKeyhole size={20} /></div><div><p className="section-label">Staff access</p><h2>Sign in to HHH</h2></div></div>
          <label className="staff-login-field">Email address<div className="staff-login-input"><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required placeholder="name@pharmacy.co.uk" /></div></label>
          <label className="staff-login-field">Password<div className="staff-login-input"><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>
          {error && <div className="banner banner-red"><AlertCircle size={15} /> {error}</div>}
          <button className="btn btn-primary staff-login-submit" type="submit"><LogIn size={16} /> Sign in</button>
          <p className="staff-login-note">Prototype authentication only. Production access will use server-side identity, MFA and auditable sessions.</p>
        </form>

        <div className="staff-demo-accounts">
          <p className="section-label">Demo accounts · select then sign in</p>
          {DEMO_STAFF_ACCOUNTS.map(account => <button type="button" key={account.email} className={`staff-demo-account ${email === account.email ? 'selected' : ''}`} onClick={() => chooseDemo(account)}><span className="staff-demo-icon">{account.role === 'admin' ? <ShieldCheck size={15} /> : <Building2 size={15} />}</span><span><strong>{account.label}</strong><small>{account.email}</small></span><small>{account.password}</small></button>)}
        </div>

        <div className="staff-login-links"><button className="btn btn-sm" onClick={() => { dispatch({ type: 'SET_CURRENT_ORGANISATION', organisationId: organisation.id }); dispatch({ type: 'SET_PORTAL_MODE', mode: 'patient' }); }}><User size={14} /> Patient portal</button><a href={eligibilityUrl(organisation)} target="_blank" rel="noreferrer">Patient eligibility form</a></div>
      </section>
    </div>
  );
}

function AppContent() {
  const { state } = useApp();
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const tenantStyle = tenantThemeVariables(organisation.brand.primary) as React.CSSProperties;

  const renderScreen = () => {
    switch (state.screen) {
      case 'home':      return <Dashboard />;
      case 'referrals': return <Referrals />;
      case 'create':    return <CreateOrder />;
      case 'review':    return <AwaitingPayment />;
      case 'orders':    return <Orders />;
      case 'patients':  return <Patients />;
      case 'resources': return <PharmacyResources />;
      case 'settings':  return <PharmacySettings />;
      default:          return <Dashboard />;
    }
  };

  if (state.portalMode === 'gateway') {
    return (
      <>
        <StaffLogin />
        <ToastContainer />
      </>
    );
  }

  if (state.portalMode === 'patient') {
    return (
      <div className="gateway-page tenant-surface" style={{ ...tenantStyle, justifyContent: 'flex-start', overflowY: 'auto' }}>
        <PatientPortal />
        <ToastContainer />
      </div>
    );
  }

  if (state.portalMode === 'admin') {
    if (state.staffSession?.role !== 'admin') return <><StaffLogin /><ToastContainer /></>;
    return <><AdminPortal /><ToastContainer /></>;
  }

  if (state.portalMode === 'eligibility') {
    return <><EligibilityForm /><ToastContainer /></>;
  }

  if (state.portalMode === 'clinician' && !state.staffSession) {
    return <><StaffLogin /><ToastContainer /></>;
  }

  return (
    <div className="app-shell" style={tenantStyle}>
      <Navigation />
      <div className="app-main">
        <Header />
        <div className="page-container">
          {renderScreen()}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
