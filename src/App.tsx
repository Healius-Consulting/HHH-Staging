import { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { AppProvider, useApp, type PharmacyTenant, type Screen, type StaffSession, type WorkspaceMode } from './context/AppContext';
import Header from './components/Header';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import PharmacyOverview from './pages/PharmacyOverview';
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
import { SetupRequired } from './onboarding/SetupRequired';
import { usePharmacySetup } from './onboarding/usePharmacySetup';
import { getAdminOrganisations, getPortalSession } from './shared/api';
import type { PortalOrganisation } from './shared/contracts';
import { isLocalPortalPreview } from './dev/localPortalPreview';
import LocalPortalSwitcher from './dev/LocalPortalSwitcher';
import CommandPalette from './components/CommandPalette';
import { serverSessionAuth } from './auth/firebase';
import { appPathPrefix, isCurrentSurfacePath } from './auth/surface-path';
import { surfaceRelativePath, surfaceRoutePath } from './routing/surfaceRoute';

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
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    locality: record.locality,
    county: record.county,
    postcode: record.postcode,
    websiteDomains: record.websiteDomains ?? [],
    status: record.status,
    testAccount: record.testAccount,
    gdprExempt: record.gdprExempt,
    workspaceClassification: record.workspaceClassification,
    staffCount: 0,
    defaultPaymentRoute: record.defaultPaymentRoute ?? 'manual',
    brand: { primary: record.primaryColour, portalName: record.portalName ?? record.name },
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

const pharmacyScreens = new Set<Screen>(['home', 'create', 'orders', 'patients', 'formulary', 'finance', 'settings']);

function pharmacyScreenFromPath(): Screen {
  const segment = surfaceRelativePath(window.location.pathname, appPathPrefix)?.split('/').filter(Boolean)[0];
  return segment && pharmacyScreens.has(segment as Screen) ? segment as Screen : 'home';
}

function pharmacyPathForScreen(screen: Screen) {
  return surfaceRoutePath(screen === 'home' ? '/' : `/${screen}`, appPathPrefix);
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

function SessionExpiryNotice() {
  const { state, continueSession, signOutStaff } = useAuth();
  const stayButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (state.phase === 'authenticated' && state.sessionWarning) stayButton.current?.focus(); }, [state.phase, state.sessionWarning]);
  if (state.phase !== 'authenticated' || !state.sessionWarning) return null;
  return (
    <section className="session-expiry-notice" role="alertdialog" aria-labelledby="session-expiry-title" aria-describedby="session-expiry-description">
      <div>
        <strong id="session-expiry-title">Your secure session is about to lock</strong>
        <span id="session-expiry-description">Continue only if you are still actively using this pharmacy workspace.</span>
      </div>
      <button ref={stayButton} type="button" className="btn btn-primary btn-sm" onClick={() => void continueSession()}>Stay signed in</button>
      <button type="button" className="btn btn-sm" onClick={() => void signOutStaff()}>Sign out</button>
    </section>
  );
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
  const allocationHolding = organisation?.workspaceClassification === 'allocation_holding';
  const workspaceMode: WorkspaceMode = allocationHolding
    ? 'live'
    : organisation?.testAccount
      ? 'training'
    : organisation?.status === 'live' && setup.status?.completed
      ? 'live'
      : organisation?.status === 'intake_live'
        ? 'intake'
        : 'training';
  const initialPathHandled = useRef(false);

  useEffect(() => {
    if (authState.staff?.role !== 'pharmacy_staff') return;
    const onPopState = () => dispatch({ type: 'SET_SCREEN', screen: pharmacyScreenFromPath() });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [authState.staff?.role, dispatch]);

  useEffect(() => {
    if (authState.staff?.role !== 'pharmacy_staff') return;
    if (!initialPathHandled.current) {
      initialPathHandled.current = true;
      const requestedScreen = pharmacyScreenFromPath();
      if (requestedScreen !== state.screen) {
        dispatch({ type: 'SET_SCREEN', screen: requestedScreen });
        return;
      }
    }
    const path = pharmacyPathForScreen(state.screen);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, [authState.staff?.role, dispatch, state.screen]);

  useEffect(() => {
    if (state.screen === 'patients') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('patient')) return;
    url.searchParams.delete('patient');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [state.screen]);

  useEffect(() => {
    if (authState.staff?.role !== 'pharmacy_staff' || !setup.status || !authState.staff.organisationId) return;
    dispatch({ type: 'SET_WORKSPACE_MODE', mode: workspaceMode, organisationId: authState.staff.organisationId });
  }, [authState.staff, dispatch, setup.status, workspaceMode]);

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
  const intakeScreens = new Set(['home', 'patients', 'settings']);
  const isIntakeRestricted = !isLocalPortalPreview && state.workspaceMode === 'intake' && !intakeScreens.has(state.screen);
  const isSetupRestricted = !isLocalPortalPreview && curaleafActivated && !setupComplete && !unrestrictedScreens.has(state.screen);
  const isRestricted = isIntakeRestricted || isSetupRestricted;

  const renderScreen = () => {
    if (isRestricted) return <SetupRequired mode={isIntakeRestricted ? 'intake' : 'setup'} onOpenSetup={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })} />;
    switch (state.screen) {
      case 'home': return serverSessionAuth ? <PharmacyOverview /> : <Dashboard />;
      case 'formulary': return <FormularyPricing />;
      case 'create': return <CreateOrder />;
      case 'orders': return <Orders />;
      case 'patients': return <Patients />;
      case 'finance': return <PharmacyFinance />;
      case 'settings': return <PharmacySettings setup={setup} />;
      default: return serverSessionAuth ? <PharmacyOverview /> : <Dashboard />;
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
        {allocationHolding && (
          <div className="intake-live-banner" role="status">
            <strong>HHH allocation holding workspace</strong>
            <span>Existing test patients and orders remain connected to Curaleaf TEST. New dedicated-link applications stay in the HHH admin workspace and appear here only after HHH completes the fixed-destination referral.</span>
          </div>
        )}
        {state.workspaceMode === 'intake' && (
          <div className="intake-live-banner" role="status">
            <strong>Eligibility intake live</strong>
            <span>New attributed enquiries remain with HHH for review. This pharmacy sees only a privacy-safe notice until HHH completes the referral and activates a patient record.</span>
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
  if (isCurrentSurfacePath('/reset-password')) return <PasswordResetScreen />;

  return (
    <>
      <AuthSessionBridge />
      <SessionExpiryNotice />
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
