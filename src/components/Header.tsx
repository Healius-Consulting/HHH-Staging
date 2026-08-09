import { Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import WorkspacePageHeader from './WorkspacePageHeader';

const SCREEN_HEADERS: Record<string, { title: string; subtitle: string }> = {
  home: {
    title: 'Pharmacy overview',
    subtitle: 'Daily operational position, urgent follow-ups, and active pharmacy workload.',
  },
  referrals: {
    title: 'Patients hub',
    subtitle: 'Approved patients, intake eligibility submissions, and clinical history for this pharmacy.',
  },
  formulary: {
    title: 'Curaleaf catalogue',
    subtitle: 'Browse products, pack sizes, and recommended patient prices supplied by Curaleaf.',
  },
  create: {
    title: 'Prescription workspace',
    subtitle: 'Select an HHH-approved patient, verify the doctor’s prescription, and prepare the Curaleaf order.',
  },
  review: {
    title: 'Payments and billing',
    subtitle: 'Track active Worldpay payment requests and review cleared transaction logs.',
  },
  'provider-prescriptions': {
    title: 'Customer orders',
    subtitle: 'Monitor post-payment placement, margin holds, stock retries, expired prescriptions, and cancellations.',
  },
  orders: {
    title: 'Customer orders',
    subtitle: 'Monitor post-payment placement, margin holds, stock retries, expired prescriptions, and cancellations.',
  },
  patients: {
    title: 'Patients hub',
    subtitle: 'Approved patients, intake eligibility submissions, and clinical history for this pharmacy.',
  },
  finance: {
    title: 'Prescription financials',
    subtitle: 'Compare paid patient revenue, Curaleaf wholesale costs, dispensing fees, and pharmacy contribution.',
  },
  resources: {
    title: 'Settings & assets',
    subtitle: 'Pharmacy profile, payment routes, operational readiness, and intake QR assets.',
  },
  settings: {
    title: 'Settings & assets',
    subtitle: 'Pharmacy profile, payment routes, operational readiness, and intake QR assets.',
  },
};

export default function Header() {
  const { state, dispatch } = useApp();
  const organisation = state.organisations.find((org) => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const info = SCREEN_HEADERS[state.screen] || {
    title: 'HHH Portal',
    subtitle: 'Ordering & Payments Interface',
  };

  const homeActions = state.screen === 'home' ? (
    <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'create' })}>
      <Plus size={15} /> Start new prescription
    </button>
  ) : null;

  return (
    <WorkspacePageHeader
      section={organisation.tradingName}
      context={info.title}
      title={info.title}
      subtitle={info.subtitle}
      actions={homeActions}
      commandLabel="Find anything"
      onSectionClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
      backAction={state.screenHistory.length ? { label: 'Return to previous workspace', onClick: () => dispatch({ type: 'GO_BACK' }) } : undefined}
      contextControl={
        <div className="header-context" aria-label={`Current pharmacy status: ${organisation.status}`}>
          <span>Account</span>
          <span className={`tenant-status tenant-status--${organisation.status}`}>{organisation.status}</span>
        </div>
      }
    />
  );
}
