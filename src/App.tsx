import { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import CreateOrder from './pages/CreateOrder';
import AwaitingPayment from './pages/AwaitingPayment';
import Orders from './pages/Orders';
import Patients from './pages/Patients';
import PatientPortal from './pages/PatientPortal';
import { PHARMACY } from './context/AppContext';
import { X, CheckCircle, Info, AlertTriangle, AlertCircle, Stethoscope, User } from 'lucide-react';

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

function PortalGateway() {
  const { dispatch } = useApp();
  const tokenStr = typeof window !== 'undefined' ? window.location.search : '';

  return (
    <div className="gateway-page">
      <div className="gateway-hero">
        <div className="gateway-logo">{PHARMACY.logoText}</div>
        <h1 className="gateway-title">{PHARMACY.name}</h1>
        <p className="gateway-subtitle">B2B2C Prescription Management Portal Gateway</p>
      </div>

      <div className="gateway-grid">
        <div
          onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'clinician' })}
          className="card card-surface gateway-card gateway-card--clinician gateway-card-hover clinician"
        >
          <div>
            <div className="gateway-card-icon">
              <Stethoscope size={22} />
            </div>
            <h2>Clinician &amp; Pharmacy Portal</h2>
            <p>
              For pharmacy staff and clinic administrators to manage referrals, build prescriptions,
              track Worldpay payments, and handle goods check-in.
            </p>
          </div>
          <button
            className="btn btn-clinician"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SET_PORTAL_MODE', mode: 'clinician' });
            }}
          >
            Enter Clinician Portal
          </button>
        </div>

        <div
          onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'patient' })}
          className="card card-surface gateway-card gateway-card--patient gateway-card-hover patient"
        >
          <div>
            <div className="gateway-card-icon">
              <User size={22} />
            </div>
            <h2>Patient Portal</h2>
            <p>
              For patients to track referral progress, pay invoices securely via Worldpay,
              and download collection barcodes when medication is ready.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SET_PORTAL_MODE', mode: 'patient' });
            }}
          >
            Enter Patient Portal
          </button>
        </div>
      </div>

      <div className="gateway-eligibility">
        <div>
          <h3>Prescription Service Inquiry</h3>
          <p>
            Not registered yet? Take our 2-minute eligibility pre-screening to see if you qualify
            for specialist medical cannabis referral via your pharmacy.
          </p>
        </div>
        <a
          href={`/specs/HHH-Eligibility-Form.html${tokenStr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline-primary btn-sm"
        >
          Am I Eligible?
        </a>
      </div>
    </div>
  );
}

function AppContent() {
  const { state } = useApp();

  const renderScreen = () => {
    switch (state.screen) {
      case 'home':      return <Dashboard />;
      case 'referrals': return <Referrals />;
      case 'create':    return <CreateOrder />;
      case 'review':    return <AwaitingPayment />;
      case 'orders':    return <Orders />;
      case 'patients':  return <Patients />;
      default:          return <Dashboard />;
    }
  };

  if (state.portalMode === 'gateway') {
    return (
      <>
        <PortalGateway />
        <ToastContainer />
      </>
    );
  }

  if (state.portalMode === 'patient') {
    return (
      <div className="gateway-page" style={{ justifyContent: 'flex-start', overflowY: 'auto' }}>
        <PatientPortal />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="app-shell">
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
