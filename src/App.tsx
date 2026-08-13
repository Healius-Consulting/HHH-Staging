import { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { AppProvider, useApp, type PharmacyTenant, type StaffSession } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import CreateOrder from './pages/CreateOrder';
import Orders from './pages/Orders';
import FormularyPricing from './pages/FormularyPricing';
import Patients from './pages/Patients';
import AdminPortal from './pages/AdminPortal';
import PharmacySettings from './pages/PharmacySettings';
import PharmacyFinance from './pages/PharmacyFinance';

import { tenantThemeVariables } from './utils/tenantTheme';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import {
  AuthLoading,
  ConfigurationRequired,
  EmailVerificationGate,
  MfaChallenge,
  MfaEnrollmentGate,
  PasswordResetScreen,
  StaffLogin,
} from './auth/AuthScreens';
import { PharmacySetupWizard } from './onboarding/PharmacySetupWizard';
import { SetupRequired } from './onboarding/SetupRequired';
import { usePharmacySetup } from './onboarding/usePharmacySetup';
import { getAdminOrganisations, getPortalSession } from './shared/api';
import type { PortalOrganisation } from './shared/contracts';
import { isLocalPortalPreview } from './dev/localPortalPreview';
import LocalPortalSwitcher from './dev/LocalPortalSwitcher';
import CommandPalette from './components/CommandPalette';

function toPharmacyTenant(record: PortalOrganisation): PharmacyTenant {
  return {
    id: record.id,
    slug: record.tradingName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    referralToken: record.referralToken ?? '',
    name: record.name,
    tradingName: record.tradingName,
    logoText: record.logoText,
    emailLogoUrl: record.emailLogoUrl ?? null,
    emailLogoStoragePath: record.emailLogoStoragePath ?? null,
    emailLogoWidth: record.emailLogoWidth ?? null,
    emailLogoHeight: record.emailLogoHeight ?? null,
    emailLogoUpdatedAt: record.emailLogoUpdatedAt ?? null,
    gphcNumber: record.gphcNumber,
    superintendent: record.superintendent,
    companyNumber: record.companyNumber,
    mainContactName: record.mainContactName,
    mainContactPhone: record.mainContactPhone,
    mainContactEmail: record.mainContactEmail,
    curaleafPharmacyCode: record.curaleafPharmacyCode,
    address: record.address,
    websiteDomains: record.websiteDomains ?? [],
    status: record.status,
    testAccount: record.testAccount,
    gdprExempt: record.gdprExempt,
    staffCount: 0,
    platformFeeMonthly: record.platformFeeMonthly ?? null,
    defaultPaymentRoute: record.defaultPaymentRoute ?? 'manual',
    brand: { primary: record.primaryColour, portalName: record.portalName ?? record.name },
    modules: record.modules ?? { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: {
      enabled: record.defaultPaymentRoute === 'worldpay',
      status: record.defaultPaymentRoute === 'worldpay' ? 'connected' : 'not-connected',
      environment: 'sandbox',
      merchantId: null,
      merchantName: null,
      lastSyncedAt: null,
    },
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
        if (linkedSession.current && !isLocalPortalPreview) {
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
    if (isLocalPortalPreview) return;
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
  // Leave training only when all six setup steps are complete (including Curaleaf).
  const liveWorkspaceReady = Boolean(setup.status?.completed);

  useEffect(() => {
    if (state.screen === 'patients') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('patient')) return;
    url.searchParams.delete('patient');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [state.screen]);

  useEffect(() => {
    if (authState.staff?.role !== 'pharmacy_staff' || !setup.status || !authState.staff.organisationId) return;
    dispatch({ type: 'SET_WORKSPACE_MODE', mode: liveWorkspaceReady ? 'live' : 'training', organisationId: authState.staff.organisationId });
    if (liveWorkspaceReady && organisation?.status === 'onboarding') {
      dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { status: 'live' } });
    }
  }, [authState.staff, dispatch, liveWorkspaceReady, organisation?.id, organisation?.status, setup.status]);

  useEffect(() => {
    document.getElementById('pharmacy-main-content')?.scrollTo({ top: 0 });
  }, [state.screen]);

  if (!state.staffSession || !authState.staff) return <AuthLoading />;

  if (state.portalMode === 'admin') {
    if (authState.staff.role !== 'hhh_admin') return <StaffLogin />;
    return <><AdminPortal />{isLocalPortalPreview && <LocalPortalSwitcher />}<ToastContainer /></>;
  }

  if (!organisation) return <AuthLoading />;

  const setupComplete = isLocalPortalPreview || Boolean(setup.status?.completed);
  const unrestrictedScreens = new Set(['home', 'formulary', 'settings']);
  const isRestricted = !isLocalPortalPreview && curaleafActivated && !setupComplete && !unrestrictedScreens.has(state.screen);

  const renderScreen = () => {
    if (isRestricted) return <SetupRequired onOpenSetup={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })} />;
    switch (state.screen) {
      case 'home': return <Dashboard />;
      case 'formulary': return <FormularyPricing />;
      case 'create': return <CreateOrder />;
      case 'orders': return <Orders />;
      case 'patients': return <Patients />;
      case 'finance': return <PharmacyFinance />;
      case 'settings': return setupComplete ? <PharmacySettings /> : <PharmacySetupWizard organisation={organisation} setup={setup} />;
      default: return <Dashboard />;
    }
  };


  return (
    <div className="app-shell" style={tenantStyle}>
      <a className="skip-link" href="#pharmacy-main-content">Skip to main content</a>
      <Navigation />
      <div className="app-main">
        <Header />
        {state.workspaceMode === 'training' && (
          <div className="training-mode-banner" role="status">
            <strong>Training workspace</strong>
            <span>Patient and order records are temporary. The catalogue may use live Curaleaf test data, but supplier writes and payments are not sent from this workspace.</span>
          </div>
        )}
        <div id="pharmacy-main-content" className="page-container" tabIndex={-1}>{renderScreen()}</div>
      </div>
      {isLocalPortalPreview && <LocalPortalSwitcher />}
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}

function AppContent() {
  const { state: authState } = useAuth();
  const urlMode = new URLSearchParams(window.location.search).get('mode');

  if (urlMode === 'resetPassword' || urlMode === 'reset-password') return <PasswordResetScreen />;

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
