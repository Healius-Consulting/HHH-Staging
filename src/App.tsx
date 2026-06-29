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

  // Preserves token when entering portal mode
  const tokenStr = typeof window !== 'undefined' ? window.location.search : '';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg-root)',
      padding: '24px',
      color: 'var(--text-primary)',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{ maxWidth: 800, width: '100%', textAlign: 'center', marginBottom: 40 }}>
        <div style={{
          width: 58,
          height: 58,
          borderRadius: 14,
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1.5px dashed var(--color-primary)',
          color: 'var(--color-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 22,
          margin: '0 auto 16px'
        }}>
          {PHARMACY.logoText}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{PHARMACY.name}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>B2B2C Prescription Management Portal Gateway</p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        maxWidth: 800,
        width: '100%',
        marginBottom: 32
      }} className="portal-grid">
        {/* Clinician Card */}
        <div 
          onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'clinician' })}
          className="card card-surface gateway-card-hover"
          style={{
            margin: 0,
            padding: '32px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: 4,
            background: '#3B82F6'
          }} />
          <div>
            <div style={{
              fontSize: 32,
              marginBottom: 16,
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3B82F6',
              display: 'inline-flex',
              padding: 8,
              borderRadius: 8
            }}>
              <Stethoscope size={24} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 10px' }}>Clinician &amp; Pharmacy Portal</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 24px', lineHeight: 1.5 }}>
              For pharmacy staff, prescribing practitioners, and clinic administrators to manage referrals, construct prescriptions, log Worldpay transactions, and handle goods check-in.
            </p>
          </div>
          <button 
            className="btn" 
            style={{ background: '#3B82F6', color: '#fff', width: '100%' }}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SET_PORTAL_MODE', mode: 'clinician' });
            }}
          >
            Enter Clinician Portal
          </button>
        </div>

        {/* Patient Card */}
        <div 
          onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'patient' })}
          className="card card-surface gateway-card-hover"
          style={{
            margin: 0,
            padding: '32px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: 4,
            background: 'var(--color-primary)'
          }} />
          <div>
            <div style={{
              fontSize: 32,
              marginBottom: 16,
              background: 'rgba(16, 185, 129, 0.15)',
              color: 'var(--color-primary)',
              display: 'inline-flex',
              padding: 8,
              borderRadius: 8
            }}>
              <User size={24} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 10px' }}>Patient Portal</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 24px', lineHeight: 1.5 }}>
              For patients to track doctor referral progress, check records audit history, pay Worldpay invoices securely, and download dispensing collection barcodes.
            </p>
          </div>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%' }}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SET_PORTAL_MODE', mode: 'patient' });
            }}
          >
            Enter Patient Portal
          </button>
        </div>
      </div>

      {/* Pre-screening CTA */}
      <div style={{
        background: 'linear-gradient(135deg, #111827 0%, #0F172A 100%)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '20px 24px',
        maxWidth: 800,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
      }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Prescription Service Inquiry</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            Not registered yet? Take our 2-minute pre-screening eligibility check to see if you qualify for specialist medical cannabis referral via your pharmacy.
          </p>
        </div>
        <a 
          href={`/specs/HHH-Eligibility-Form.html${tokenStr}`}
          target="_blank" 
          rel="noopener noreferrer"
          className="btn btn-primary" 
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            color: 'var(--color-primary)',
            border: '1px solid var(--color-primary)',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            width: 'auto'
          }}
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
      <div style={{ display: 'block', minHeight: '100vh', background: 'var(--bg-root)', padding: '24px 12px', overflowY: 'auto' }}>
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
