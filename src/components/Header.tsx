import { useApp } from '../context/AppContext';
import WorkspacePageHeader from './WorkspacePageHeader';

const SCREEN_HEADERS: Record<string, { title: string; subtitle: string }> = {
  home: {
    title: 'Good morning',
    subtitle: 'Your operational position and the work that needs attention today.',
  },
  referrals: {
    title: 'Patient onboarding',
    subtitle: 'Track patients attributed to your pharmacy while Holistic Health Hub completes its review and onboarding decision.',
  },
  formulary: {
    title: 'Formulary and pricing',
    subtitle: 'Review Curaleaf WX and control the PX used by this pharmacy.',
  },
  create: {
    title: 'Prescription workspace',
    subtitle: 'Select an HHH-approved patient, verify the doctor’s prescription, and prepare the Curaleaf order.',
  },
  review: {
    title: 'Payments and billing',
    subtitle: 'Track active Worldpay payment requests and review cleared transaction logs.',
  },
  orders: {
    title: 'Supplier order fulfilment',
    subtitle: 'Track B2B orders sent to Curaleaf, confirm pharmacy receipt, and retrieve invoices.',
  },
  patients: {
    title: 'Patient directory',
    subtitle: 'Search the patient index and view order histories, clinical files, and logged activities.',
  },
  resources: {
    title: 'Forms and resources',
    subtitle: 'Copy the pharmacy-specific patient link, save its QR code, or hand a website pack to developers.',
  },
  settings: {
    title: 'Organisation',
    subtitle: 'Review your Worldpay connection, pharmacy pricing, enabled modules and go-live requirements.',
  },
};

export default function Header() {
  const { state } = useApp();
  const organisation = state.organisations.find((org) => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const info = SCREEN_HEADERS[state.screen] || {
    title: 'HHH Portal',
    subtitle: 'Ordering & Payments Interface',
  };

  return <WorkspacePageHeader
    section="Workspace"
    context={organisation.tradingName}
    title={info.title}
    subtitle={info.subtitle}
    contextControl={<div className="header-context" aria-label={`Current pharmacy status: ${organisation.status}`}><span>Account</span><span className={`tenant-status tenant-status--${organisation.status}`}>{organisation.status}</span></div>}
  />;
}
