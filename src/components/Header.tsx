import { useApp } from '../context/AppContext';

const SCREEN_HEADERS: Record<string, { title: string; subtitle: string }> = {
  home: {
    title: 'Pharmacy Dashboard',
    subtitle: 'Overview of daily clinic referrals, payment requests, and supply chain status.',
  },
  referrals: {
    title: 'Clinic Intake Directory',
    subtitle: 'Process new patient enquiries, verify medical histories, and issue clinic referrals.',
  },
  create: {
    title: 'Rx Builder Workspace',
    subtitle: 'Unified workspace: Link CRM patients, verify prescriptions, and assign products from Curaleaf.',
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
