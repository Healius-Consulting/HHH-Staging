import { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import Formulary from './pages/Formulary';
import CreateOrder from './pages/CreateOrder';
import AwaitingPayment from './pages/AwaitingPayment';
import Orders from './pages/Orders';
import Patients from './pages/Patients';
import { X, CheckCircle, Info, AlertTriangle, AlertCircle } from 'lucide-react';

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

function AppContent() {
  const { state } = useApp();

  const renderScreen = () => {
    switch (state.screen) {
      case 'home':      return <Dashboard />;
      case 'referrals': return <Referrals />;
      case 'formulary': return <Formulary />;
      case 'create':    return <CreateOrder />;
      case 'review':    return <AwaitingPayment />;
      case 'orders':    return <Orders />;
      case 'patients':  return <Patients />;
      default:          return <Dashboard />;
    }
  };

  return (
    <div className="app-shell">
      <Header />
      <Navigation />
      {renderScreen()}
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
