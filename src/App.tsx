import { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { AppProvider, useApp, type PharmacyTenant, type StaffSession } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import CreateOrder from './pages/CreateOrder';
import AwaitingPayment from './pages/AwaitingPayment';
import Orders from './pages/Orders';
import Patients from './pages/Patients';
import AdminPortal from './pages/AdminPortal';
import PharmacyResources from './pages/PharmacyResources';
import PharmacySettings from './pages/PharmacySettings';
import { tenantThemeVariables } from './utils/tenantTheme';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import {
  AuthLoading,
  ConfigurationRequired,
  EmailVerificationGate,
  MfaChallenge,
  MfaEnrollmentGate,
  StaffLogin,
} from './auth/AuthScreens';
import { PharmacySetupWizard } from './onboarding/PharmacySetupWizard';
import { SetupRequired } from './onboarding/SetupRequired';
import { usePharmacySetup } from './onboarding/usePharmacySetup';
import { getAdminOrganisations, getPortalSession } from './shared/api';
import type { PortalOrganisation } from './shared/contracts';

function toPharmacyTenant(record: PortalOrganisation): PharmacyTenant {
  return {
    id: record.id,
    slug: record.tradingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    referralToken: record.referralToken ?? '',
    name: record.name,
    tradingName: record.tradingName,
    logoText: record.logoText,
    gphcNumber: record.gphcNumber,
    superintendent: record.superintendent,
    address: record.address,
    websiteDomains: record.websiteDomains ?? [],
    status: record.status,
    staffCount: 0,
    platformFeeMonthly: null,
    deliveryOptions: [
      { id: 'standard', label: 'Standard tracked delivery', description: 'Tracked delivery to the pharmacy.', amount: 6.95, enabled: true },
      { id: 'collection', label: 'No delivery charge', description: 'Use where no delivery charge is payable.', amount: 0, enabled: true },
    ],
    brand: { primary: record.primaryColour, portalName: `${record.tradingName} Patient Services` },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
  };
}

function ToastItem({ toast }: { toast: { id: string; message: string; type: 'success' | 'info' | 'warning' | 'error' } }) {
  const { dispatch } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'REMOVE_TOAST', id: toast.id }), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, dispatch]);

  let Icon = Info;
  if (toast.type === 'success') Icon = CheckCircle;
  if (toast.type === 'warning') Icon = AlertTriangle;
  if (toast.type === 'error') Icon = AlertCircle;
  const colorClass = toast.type === 'success' ? 'text-green' : toast.type === 'warning' ? 'text-amber' : toast.type === 'error' ? 'text-red' : '';

  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <div className={colorClass} style={{ display: 'flex', marginTop: 2 }}><Icon size={16} /></div>
      <div className="toast-content">{toast.message}</div>
      <button className="toast-close" aria-label="Dismiss notification" onClick={() => dispatch({ type: 'REMOVE_TOAST', id: toast.id })}><X size={14} /></button>
    </div>
  );
}

function ToastContainer() {
  const { state } = useApp();
  return <div className="toast-container" aria-live="polite">{state.toasts.map(toast => <ToastItem key={toast.id} toast={toast} />)}</div>;
}

/** Keeps the legacy prototype store aligned with the authoritative Firebase session. */
function AuthSessionBridge() {
  const { state: authState, signOutStaff } = useAuth();
  const { state, dispatch } = useApp();
  const linkedSession = useRef(false);

  useEffect(() => {
    if (authState.phase === 'authenticated' && authState.staff) {
      const session: StaffSession = {
        email: authState.staff.email,
        name: authState.staff.name,
        role: authState.staff.role === 'hhh_admin' ? 'admin' : 'pharmacy',
        organisationId: authState.staff.organisationId,
      };
      if (!state.staffSession) {
        if (linkedSession.current) {
          void signOutStaff();
          return;
        }
        linkedSession.current = true;
        dispatch({ type: 'SIGN_IN_STAFF', session });
        return;
      }
      linkedSession.current = true;
      const hasChanged = state.staffSession.email !== session.email
        || state.staffSession.role !== session.role
        || state.staffSession.organisationId !== session.organisationId;
      if (hasChanged) dispatch({ type: 'SIGN_IN_STAFF', session });
      return;
    }

    if (authState.phase !== 'loading' && state.staffSession) dispatch({ type: 'SIGN_OUT_STAFF' });
    if (authState.phase === 'anonymous' || authState.phase === 'unconfigured') linkedSession.current = false;
  }, [authState.phase, authState.staff, dispatch, signOutStaff, state.staffSession]);

  useEffect(() => {
    if (authState.phase !== 'authenticated' || !authState.staff) return;
    let cancelled = false;
    const loadOrganisations = authState.staff.role === 'hhh_admin'
      ? getAdminOrganisations().then(records => {
          if (!cancelled) dispatch({ type: 'SET_ORGANISATIONS', organisations: records.map(toPharmacyTenant) });
        })
      : getPortalSession().then(session => {
          if (!cancelled && session.organisation) {
            dispatch({ type: 'SET_ORGANISATIONS', organisations: [toPharmacyTenant(session.organisation)] });
          }
        });
    void loadOrganisations.catch(error => {
      if (!cancelled) dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Pharmacy profile could not be loaded.', toastType: 'error' });
    });
    return () => { cancelled = true; };
  }, [authState.phase, authState.staff, dispatch]);

  return null;
}

function StaffWorkspace() {
  const { state: authState } = useAuth();
  const { state, dispatch } = useApp();
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? (state.portalMode === 'admin' ? state.organisations[0] : undefined);
  const tenantStyle = tenantThemeVariables(organisation?.brand.primary ?? '#0f766e') as React.CSSProperties;
  const setup = usePharmacySetup(state.portalMode === 'admin' ? undefined : authState.staff?.organisationId);
  const curaleafActivated = Boolean(setup.status?.tasks.find(task => task.id === 'curaleaf_account')?.completed);

  useEffect(() => {
    if (authState.staff?.role !== 'pharmacy_staff' || !setup.status) return;
    dispatch({ type: 'SET_WORKSPACE_MODE', mode: curaleafActivated ? 'live' : 'training', organisationId: authState.staff.organisationId });
  }, [authState.staff, curaleafActivated, dispatch, setup.status]);

  if (!state.staffSession || !authState.staff) return <AuthLoading />;

  if (state.portalMode === 'admin') {
    if (authState.staff.role !== 'hhh_admin') return <StaffLogin />;
    return <><AdminPortal /><ToastContainer /></>;
  }

  if (!organisation) return <AuthLoading />;

  const setupComplete = Boolean(setup.status?.completed);
  const unrestrictedScreens = new Set(['home', 'resources', 'settings']);
  const isRestricted = curaleafActivated && !setupComplete && !unrestrictedScreens.has(state.screen);

  const renderScreen = () => {
    if (isRestricted) return <SetupRequired onOpenSetup={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })} />;
    switch (state.screen) {
      case 'home': return <Dashboard />;
      case 'referrals': return <Referrals />;
      case 'create': return <CreateOrder />;
      case 'review': return <AwaitingPayment />;
      case 'orders': return <Orders />;
      case 'patients': return <Patients />;
      case 'resources': return <PharmacyResources />;
      case 'settings': return <><PharmacySetupWizard organisation={organisation} setup={setup} />{setupComplete && <PharmacySettings />}</>;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="app-shell" style={tenantStyle}>
      <Navigation />
      <div className="app-main">
        <Header />
        {state.workspaceMode === 'training' && (
          <div className="training-mode-banner" role="status">
            <strong>Training workspace</strong>
            <span>Curaleaf has not activated this pharmacy yet. Patient, prescription, payment and order changes are temporary and reset when this page refreshes or the session ends.</span>
          </div>
        )}
        <div className="page-container">{renderScreen()}</div>
      </div>
      <ToastContainer />
    </div>
  );
}

function AppContent() {
  const { state: authState } = useAuth();

  return (
    <>
      <AuthSessionBridge />
      {authState.phase === 'unconfigured' && <ConfigurationRequired />}
      {authState.phase === 'loading' && <AuthLoading />}
      {authState.phase === 'anonymous' && <StaffLogin />}
      {authState.phase === 'email-unverified' && <EmailVerificationGate />}
      {authState.phase === 'mfa-challenge' && <MfaChallenge />}
      {authState.phase === 'mfa-enrollment' && <MfaEnrollmentGate />}
      {authState.phase === 'error' && <StaffLogin />}
      {authState.phase === 'authenticated' && <StaffWorkspace />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
}
