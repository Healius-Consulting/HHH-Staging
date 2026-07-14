import { useApp } from '../context/AppContext';

const SCREEN_HEADERS: Record<string, { title: string; subtitle: string }> = {
  home: {
    title: 'Pharmacy Dashboard',
    subtitle: 'Overview of HHH-approved patients, prescription preparation, payment requests and supply-chain status.',
  },
  referrals: {
    title: 'HHH Patient Onboarding',
    subtitle: 'Track patients attributed to your pharmacy while Holistic Health Hub completes its review and onboarding decision.',
  },
  create: {
    title: 'Rx Builder Workspace',
    subtitle: 'Select an HHH-approved patient, verify the doctor’s prescription, and prepare the Curaleaf order.',
  },
  review: {
    title: 'Payments & Billing',
    subtitle: 'Track active Worldpay payment requests and review cleared transaction logs.',
  },
  orders: {
    title: 'Supplier Orders Fulfilment',
    subtitle: 'Track B2B orders sent to Curaleaf, view DPD shipping updates, and retrieve invoices.',
  },
  patients: {
    title: 'Patients CRM Directory',
    subtitle: 'Search the patient index and view order histories, clinical files, and logged activities.',
  },
  resources: {
    title: 'Eligibility Form & Content Pack',
    subtitle: 'Copy the pharmacy-specific patient link, save its QR code, or hand a website pack to developers.',
  },
  settings: {
    title: 'Organisation Settings',
    subtitle: 'Review your Worldpay connection, pharmacy pricing, enabled modules and go-live requirements.',
  },
};

export default function Header() {
  const { state } = useApp();
  const info = SCREEN_HEADERS[state.screen] || {
    title: 'HHH Portal',
    subtitle: 'Ordering & Payments Interface',
  };

  return (
    <header className="app-header">
      <div className="brand-text">
        <h1>{info.title}</h1>
        <p>{info.subtitle}</p>
      </div>
    </header>
  );
}
