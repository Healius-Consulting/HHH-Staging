import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Copy,
  CreditCard,
  ExternalLink,
  FileArchive,
  Globe2,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  PhoneCall,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  UserPlus,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import {
  useApp,
  type PharmacyTenant,
  type TenantModule,
} from '../context/AppContext';
import { downloadContentPack, eligibilityUrl } from '../utils/pharmacyResources';
import { brandSwatchStyle, deriveTenantTheme } from '../utils/tenantTheme';
import { useAuth } from '../auth/useAuth';
import { requireFirebaseAuth } from '../auth/firebase';
import AccessibilityPanel from '../accessibility/AccessibilityPanel';
import { activateCuraleafPharmacy, createOrganisation, createPharmacyStaffInvitation, getPharmacySetupStatus, getPharmacyStaff, updateOrganisation } from '../shared/api';
import type { PharmacySetupStatus, PharmacyStaffAccount, PharmacyStaffInvitation, UpdateOrganisationInput } from '../shared/contracts';
import { SETUP_TASKS } from '../onboarding/setup';

type AdminView = 'overview' | 'referrals' | 'patients' | 'compliance' | 'integrations';

const MODULE_LABELS: Record<TenantModule, string> = {
  intake: 'Patient intake',
  rx: 'Prescription workspace',
  payments: 'Payments',
  supplierOrders: 'Supplier orders',
  patients: 'Patient directory',
  resources: 'Form and content pack',
};

const defaultModules: PharmacyTenant['modules'] = {
  intake: true,
  rx: true,
  payments: true,
  supplierOrders: true,
  patients: true,
  resources: true,
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function AdminHeader({ view, setView }: { view: AdminView; setView: (view: AdminView) => void }) {
  const { signOutStaff } = useAuth();
  const items: Array<{ id: AdminView; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Clients', icon: <LayoutDashboard size={15} /> },
    { id: 'referrals', label: 'Onboarding', icon: <UserCheck size={15} /> },
    { id: 'patients', label: 'Patients', icon: <Users size={15} /> },
    { id: 'compliance', label: 'Readiness', icon: <ClipboardCheck size={15} /> },
    { id: 'integrations', label: 'Integrations', icon: <Settings2 size={15} /> },
  ];
  return (
    <header className="admin-header">
      <div className="admin-header-brand"><img className="hhh-wordmark" src="/holistic-health-hub-logo.png" alt="Holistic Health Hub" /><span><small>Healius Consulting · Administration</small></span></div>
      <nav className="admin-nav" aria-label="Administration sections">
        {items.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.icon}{item.label}</button>)}
      </nav>
      <div className="admin-header-actions"><AccessibilityPanel /><button className="btn btn-sm" onClick={() => void signOutStaff()}><LogOut size={14} /> Sign out</button></div>
    </header>
  );
}

function OnboardPharmacy({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { dispatch } = useApp();
  const [name, setName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [gphcNumber, setGphcNumber] = useState('');
  const [superintendent, setSuperintendent] = useState('');
  const [address, setAddress] = useState('');
  const [domain, setDomain] = useState('');
  const [primary, setPrimary] = useState('#0f766e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onboardingTheme = deriveTenantTheme(primary);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const slug = slugify(tradingName || name);
    const logoText = (tradingName || name).split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const websiteDomains = domain ? [domain.replace(/^https?:\/\//, '').replace(/\/$/, '')] : [];
    try {
      const created = await createOrganisation({ name, tradingName, gphcNumber, superintendent, address, websiteDomains, primaryColour: primary, logoText, status: 'onboarding' });
      const organisation: PharmacyTenant = {
        id: created.id, slug, referralToken: created.referralToken, name, tradingName, logoText, gphcNumber, superintendent, address, websiteDomains,
        status: 'onboarding', staffCount: 0, platformFeeMonthly: null,
        deliveryOptions: [
          { id: 'standard', label: 'Standard tracked delivery', description: 'Tracked delivery to the pharmacy.', amount: 6.95, enabled: true },
          { id: 'priority', label: 'Priority tracked delivery', description: 'Faster service where available from the supplier.', amount: 12.95, enabled: true },
          { id: 'collection', label: 'No delivery charge', description: 'Use where no delivery charge is payable.', amount: 0, enabled: true },
        ],
        brand: { primary, portalName: `${tradingName} Patient Services` }, modules: defaultModules,
        worldpay: { status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
      };
      dispatch({ type: 'ADD_ORGANISATION', organisation });
      dispatch({ type: 'ADD_TOAST', message: `${tradingName} onboarding record created in Firebase.`, toastType: 'success' });
      onCreated(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The onboarding record could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop admin-onboarding-backdrop" role="presentation">
      <aside className="drawer admin-onboarding-drawer" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
        <div className="drawer-header"><div><p className="section-label">New client</p><h2 id="onboard-title">Onboard a pharmacy</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="drawer-body onboarding-form" onSubmit={submit}>
          <div className="form-section-heading"><span>01</span><div><strong>Registered organisation</strong><small>Legal and GPhC identity used for compliance evidence.</small></div></div>
          <label>Registered pharmacy name<input className="input" value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Trading name<input className="input" value={tradingName} onChange={event => setTradingName(event.target.value)} required /></label>
          <div className="form-grid-two"><label>GPhC number<input className="input" value={gphcNumber} onChange={event => setGphcNumber(event.target.value)} required /></label><label>Superintendent pharmacist<input className="input" value={superintendent} onChange={event => setSuperintendent(event.target.value)} required /></label></div>
          <label>Registered premises address<textarea className="input" value={address} onChange={event => setAddress(event.target.value)} required /></label>
          <label>Approved website domain<input className="input" type="text" value={domain} onChange={event => setDomain(event.target.value)} placeholder="pharmacy.co.uk" /></label>

          <div className="form-section-heading"><span>02</span><div><strong>Tenant identity</strong><small>The colour is applied consistently across that pharmacy’s workspace.</small></div></div>
          <div className="brand-colour-field"><input type="color" value={primary} onChange={event => setPrimary(event.target.value)} /><div><strong>Primary brand colour</strong><small>{primary.toUpperCase()} · secondary generated automatically</small></div><div className="onboarding-palette"><i style={{ background: onboardingTheme.primary }} /><i style={{ background: onboardingTheme.secondary }} /><i style={{ background: onboardingTheme.primarySoft }} /></div><div className="brand-preview-button" style={{ background: onboardingTheme.primary, color: onboardingTheme.onPrimary }}>Action</div></div>

          <div className="onboarding-callout"><ShieldCheck size={17} /><span>The tenant starts in onboarding status. Its six setup steps must be completed before live processing begins.</span></div>
          {error && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {error}</div>}
          <div className="drawer-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}><Plus size={14} /> {busy ? 'Creating securely…' : 'Create onboarding record'}</button></div>
        </form>
      </aside>
    </div>
  );
}

function EditPharmacy({ organisation, onClose, onSaved }: { organisation: PharmacyTenant; onClose: () => void; onSaved: (updates: Partial<PharmacyTenant>) => void }) {
  const [name, setName] = useState(organisation.name);
  const [tradingName, setTradingName] = useState(organisation.tradingName);
  const [gphcNumber, setGphcNumber] = useState(organisation.gphcNumber);
  const [superintendent, setSuperintendent] = useState(organisation.superintendent);
  const [address, setAddress] = useState(organisation.address);
  const [domains, setDomains] = useState(organisation.websiteDomains.join('\n'));
  const [status, setStatus] = useState(organisation.status);
  const [logoText, setLogoText] = useState(organisation.logoText);
  const [primaryColour, setPrimaryColour] = useState(organisation.brand.primary);
  const [portalName, setPortalName] = useState(organisation.brand.portalName);
  const [platformFee, setPlatformFee] = useState(organisation.platformFeeMonthly?.toString() ?? '');
  const [modules, setModules] = useState({ ...organisation.modules });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editTheme = deriveTenantTheme(primaryColour);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const websiteDomains = [...new Set(domains.split(/[\n,]+/).map(value => value.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()).filter(Boolean))];
    const input: UpdateOrganisationInput = {
      name, tradingName, gphcNumber, superintendent, address, websiteDomains, status, logoText: logoText.toUpperCase(),
      primaryColour, portalName, platformFeeMonthly: platformFee === '' ? null : Number(platformFee), modules,
    };
    try {
      await updateOrganisation(organisation.id, input);
      onSaved({
        name: name.trim(), tradingName: tradingName.trim(), gphcNumber: gphcNumber.trim(), superintendent: superintendent.trim(), address: address.trim(),
        websiteDomains, status, logoText: logoText.trim().toUpperCase(), platformFeeMonthly: input.platformFeeMonthly,
        brand: { primary: primaryColour, portalName: portalName.trim() }, modules,
        slug: slugify(tradingName || name),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The pharmacy details could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop admin-onboarding-backdrop" role="presentation">
      <aside className="drawer admin-onboarding-drawer" role="dialog" aria-modal="true" aria-labelledby="edit-pharmacy-title">
        <div className="drawer-header"><div><p className="section-label">HHH administrator</p><h2 id="edit-pharmacy-title">Edit pharmacy details</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="drawer-body onboarding-form" onSubmit={submit}>
          <div className="form-section-heading"><span>01</span><div><strong>Registered organisation</strong><small>Corrections are saved to Firebase and added to the audit trail.</small></div></div>
          <label>Registered pharmacy name<input className="input" value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Trading name<input className="input" value={tradingName} onChange={event => setTradingName(event.target.value)} required /></label>
          <div className="form-grid-two"><label>GPhC number<input className="input" value={gphcNumber} onChange={event => setGphcNumber(event.target.value)} required /></label><label>Superintendent pharmacist<input className="input" value={superintendent} onChange={event => setSuperintendent(event.target.value)} required /></label></div>
          <label>Registered premises address<textarea className="input" value={address} onChange={event => setAddress(event.target.value)} required /></label>
          <label>Approved website domains<textarea className="input" value={domains} onChange={event => setDomains(event.target.value)} placeholder={'pharmacy.co.uk\nanother-domain.co.uk'} /><small>Enter one domain per line. Protocols and page paths are removed automatically.</small></label>
          <div className="form-grid-two"><label>Account status<select className="input" value={status} onChange={event => setStatus(event.target.value as PharmacyTenant['status'])}><option value="onboarding">Onboarding</option><option value="live">Live</option><option value="paused">Paused</option></select></label><label>Monthly HHH platform fee (£)<input className="input" type="number" min="0" max="100000" step="0.01" value={platformFee} onChange={event => setPlatformFee(event.target.value)} placeholder="Not set" /></label></div>

          <div className="form-section-heading"><span>02</span><div><strong>Brand and portal identity</strong><small>These details appear in the pharmacy workspace and eligibility form.</small></div></div>
          <div className="form-grid-two"><label>Portal name<input className="input" value={portalName} onChange={event => setPortalName(event.target.value)} required /></label><label>Logo initials<input className="input" value={logoText} onChange={event => setLogoText(event.target.value.slice(0, 4))} minLength={1} maxLength={4} required /></label></div>
          <div className="brand-colour-field"><input type="color" value={primaryColour} onChange={event => setPrimaryColour(event.target.value)} /><div><strong>Primary brand colour</strong><small>{primaryColour.toUpperCase()} · accessible palette generated automatically</small></div><div className="onboarding-palette"><i style={{ background: editTheme.primary }} /><i style={{ background: editTheme.secondary }} /><i style={{ background: editTheme.primarySoft }} /></div></div>

          <div className="form-section-heading"><span>03</span><div><strong>Available modules</strong><small>Choose the areas pharmacy staff can access.</small></div></div>
          <div className="admin-module-list edit-pharmacy-modules">
            {(Object.keys(MODULE_LABELS) as TenantModule[]).map(module => <label key={module}><span><strong>{MODULE_LABELS[module]}</strong><small>{modules[module] ? 'Available to pharmacy staff' : 'Hidden from navigation'}</small></span><input type="checkbox" checked={modules[module]} onChange={() => setModules(current => ({ ...current, [module]: !current[module] }))} /></label>)}
          </div>

          <div className="setup-security-note"><ShieldCheck size={16} /><span>Curaleaf customer IDs and integration credentials are not changed here. Use the secure Integrations workflow to update those values.</span></div>
          {error && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {error}</div>}
          <div className="drawer-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}><Pencil size={14} /> {busy ? 'Saving securely…' : 'Save all changes'}</button></div>
        </form>
      </aside>
    </div>
  );
}

function PharmacyStaffManager({ organisation, onCountChange }: { organisation: PharmacyTenant; onCountChange: (count: number) => void }) {
  const { dispatch } = useApp();
  const [staff, setStaff] = useState<PharmacyStaffAccount[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<PharmacyStaffInvitation | null>(null);
  const [emailDelivery, setEmailDelivery] = useState<'sent' | 'failed' | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPharmacyStaff(organisation.id)
      .then(records => {
        if (cancelled) return;
        setStaff(records);
        onCountChange(records.length);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Staff accounts could not be loaded.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organisation.id, onCountChange]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInvitation(null);
    setEmailDelivery(null);
    try {
      const created = await createPharmacyStaffInvitation({ organisationId: organisation.id, displayName, email });
      const updated = [...staff, created];
      setStaff(updated);
      setInvitation(created);
      setDisplayName('');
      setEmail('');
      onCountChange(updated.length);
      try {
        await sendPasswordResetEmail(requireFirebaseAuth(), created.email);
        setEmailDelivery('sent');
        dispatch({ type: 'ADD_TOAST', message: `${created.displayName} was added and Firebase sent their setup email.`, toastType: 'success' });
      } catch {
        setEmailDelivery('failed');
        dispatch({ type: 'ADD_TOAST', message: 'Account created, but Firebase could not send the email. Copy the setup link instead.', toastType: 'warning' });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The staff account could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitation) return;
    await navigator.clipboard.writeText(invitation.actionLink);
    dispatch({ type: 'ADD_TOAST', message: 'Secure account setup link copied.', toastType: 'success' });
  };

  return (
    <section className="card admin-staff-card">
      <div className="admin-directory-head"><div><p className="section-label">Account access</p><h2>Pharmacy staff</h2><p>Create staff access for this pharmacy. The first account is tagged Owner only to identify the main contact; it receives no additional permissions.</p></div><span className="pill pill-info"><Users size={13} /> {staff.length} account{staff.length === 1 ? '' : 's'}</span></div>
      <form className="admin-staff-invite-form" onSubmit={invite}>
        <label>Staff member name<input className="input" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="off" required /></label>
        <label>Work email address<input className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" required /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}><UserPlus size={14} /> {busy ? 'Creating account…' : 'Add staff account'}</button>
      </form>
      {error && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {error}</div>}
      {invitation && <div className="staff-invitation-result"><ShieldCheck size={17} /><div><strong>{invitation.contactRole === 'owner' ? 'Owner account created' : 'Staff account created'} · {emailDelivery === 'sent' ? 'Email sent' : emailDelivery === 'failed' ? 'Email not sent' : 'Preparing email'}</strong><span>{emailDelivery === 'sent' ? `Firebase sent a password setup email to ${invitation.email}.` : `Send this one-time Firebase setup link to ${invitation.email}.`} They will choose a password and verify their email before entering the pharmacy workspace.</span><code>{invitation.actionLink}</code></div><button className="btn btn-sm" type="button" onClick={() => void copyInvitation()}><Copy size={13} /> Copy setup link</button></div>}
      <div className="admin-staff-list">
        {loading && <div className="empty-state">Loading staff accounts…</div>}
        {!loading && staff.length === 0 && <div className="empty-state">No pharmacy staff accounts yet. The first person added will be tagged Owner.</div>}
        {staff.map(account => <div className="admin-staff-row" key={account.uid}><div className="staff-avatar">{account.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><strong>{account.displayName}</strong><span>{account.email}</span></div><span className={`pill ${account.contactRole === 'owner' ? 'pill-info' : 'pill-neutral'}`}>{account.contactRole === 'owner' ? 'Owner' : 'Staff'}</span><span className={`pill ${account.status === 'active' ? 'pill-green' : account.status === 'disabled' ? 'pill-red' : 'pill-amber'}`}>{account.status}</span></div>)}
      </div>
    </section>
  );
}

export default function AdminPortal() {
  const { state, dispatch } = useApp();
  const [view, setView] = useState<AdminView>('overview');
  const [query, setQuery] = useState('');
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPharmacyEditor, setShowPharmacyEditor] = useState(false);
  const [setupByOrganisation, setSetupByOrganisation] = useState<Record<string, PharmacySetupStatus>>({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [curaleafOrganisationId, setCuraleafOrganisationId] = useState(state.organisations[0]?.id ?? '');
  const [curaleafCustomerId, setCuraleafCustomerId] = useState('');
  const [curaleafPortalEmail, setCuraleafPortalEmail] = useState('');
  const [curaleafBusy, setCuraleafBusy] = useState(false);
  const [curaleafError, setCuraleafError] = useState<string | null>(null);

  const selectedOrganisation = state.organisations.find(org => org.id === selectedOrganisationId);
  const updateSelectedStaffCount = useCallback((count: number) => {
    if (selectedOrganisationId) dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisationId, updates: { staffCount: count } });
  }, [dispatch, selectedOrganisationId]);

  useEffect(() => {
    document.querySelector<HTMLElement>('.admin-shell')?.scrollTo({ top: 0 });
  }, [view, selectedOrganisationId]);

  useEffect(() => {
    if (!state.organisations.length) {
      setSetupByOrganisation({});
      return;
    }
    let cancelled = false;
    setSetupError(null);
    void Promise.all(state.organisations.map(organisation => getPharmacySetupStatus(organisation.id)))
      .then(statuses => {
        if (!cancelled) setSetupByOrganisation(Object.fromEntries(statuses.map(status => [status.organisationId, status])));
      })
      .catch(error => {
        if (!cancelled) setSetupError(error instanceof Error ? error.message : 'Pharmacy readiness could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [state.organisations]);

  useEffect(() => {
    if (!curaleafOrganisationId || !state.organisations.some(org => org.id === curaleafOrganisationId)) {
      setCuraleafOrganisationId(state.organisations[0]?.id ?? '');
    }
  }, [curaleafOrganisationId, state.organisations]);
  const submissionsByOrganisation = useMemo(
    () => new Map(state.organisations.map(org => [org.id, state.submissions.filter(sub => sub.organisationId === org.id)])),
    [state.organisations, state.submissions],
  );
  const crmByOrganisation = useMemo(
    () => new Map(state.organisations.map(org => [org.id, state.crm.filter(patient => patient.organisationId === org.id)])),
    [state.organisations, state.crm],
  );

  const allPatients = useMemo(() => {
    const records = new Map<string, { id: string; name: string; email: string; mobile: string; organisationId: string; stage: string; source: string; date: Date | string | null }>();
    state.crm.forEach(patient => records.set(`${patient.organisationId}:${patient.email.toLowerCase()}`, { id: patient.id, name: patient.name, email: patient.email, mobile: patient.mobile, organisationId: patient.organisationId, stage: patient.status, source: 'Patient record', date: patient.interactions?.at(-1)?.ts ?? null }));
    state.submissions.forEach(submission => {
      const key = `${submission.organisationId}:${submission.email.toLowerCase()}`;
      const existing = records.get(key);
      records.set(key, { id: existing?.id ?? `sub-${submission.id}`, name: submission.name, email: submission.email, mobile: submission.mobile, organisationId: submission.organisationId, stage: submission.status, source: submission.source, date: submission.submittedAt });
    });
    return [...records.values()];
  }, [state.crm, state.submissions]);

  const filteredOrganisations = state.organisations.filter(org => `${org.name} ${org.tradingName} ${org.gphcNumber}`.toLowerCase().includes(query.toLowerCase()));
  const filteredPatients = allPatients.filter(patient => {
    const org = state.organisations.find(item => item.id === patient.organisationId);
    return `${patient.name} ${patient.email} ${patient.mobile} ${org?.name ?? ''}`.toLowerCase().includes(query.toLowerCase());
  });
  const liveCount = state.organisations.filter(org => org.status === 'live').length;
  const remainingSetupSteps = Object.values(setupByOrganisation).reduce((total, status) => total + status.requiredCount - status.completedCount, 0);

  const tenantReadiness = (organisationId: string) => {
    const status = setupByOrganisation[organisationId];
    const ready = status?.completedCount ?? 0;
    const total = status?.requiredCount ?? SETUP_TASKS.length;
    return { ready, total, percent: total ? Math.round(ready / total * 100) : 0 };
  };

  if (selectedOrganisation) {
    const submissions = submissionsByOrganisation.get(selectedOrganisation.id) ?? [];
    const patients = crmByOrganisation.get(selectedOrganisation.id) ?? [];
    const setupStatus = setupByOrganisation[selectedOrganisation.id];
    const readiness = tenantReadiness(selectedOrganisation.id);
    const formUrl = eligibilityUrl(selectedOrganisation);
    const tenantTheme = deriveTenantTheme(selectedOrganisation.brand.primary);

    return (
      <main className="admin-shell">
        <AdminHeader view={view} setView={next => { setSelectedOrganisationId(null); setView(next); }} />
        <div className="admin-content">
          <button className="btn btn-sm admin-detail-back" onClick={() => setSelectedOrganisationId(null)}><ArrowLeft size={14} /> Back to client directory</button>

          <section className="admin-client-heading">
            <div className="admin-org-brand"><div className="tenant-mark" style={brandSwatchStyle(selectedOrganisation.brand.primary)}>{selectedOrganisation.logoText}</div><div><p className="section-label">Client account</p><h1>{selectedOrganisation.name}</h1><span>{selectedOrganisation.tradingName} · GPhC {selectedOrganisation.gphcNumber}</span></div></div>
            <div className="admin-client-status"><span className={`pill ${selectedOrganisation.status === 'live' ? 'pill-green' : selectedOrganisation.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{selectedOrganisation.status}</span><strong>{readiness.percent}% setup complete</strong><button className="btn btn-sm" onClick={() => setShowPharmacyEditor(true)}><Pencil size={13} /> Edit details</button></div>
          </section>

          <div className="stats-grid admin-detail-stats">
            <div className="stat-card"><Users size={18} /><strong>{new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size}</strong><span>Attributed patients</span></div>
            <div className="stat-card"><UserRound size={18} /><strong>{selectedOrganisation.staffCount}</strong><span>Staff accounts</span></div>
            <div className="stat-card"><ClipboardCheck size={18} /><strong>{readiness.ready}/{readiness.total}</strong><span>Setup steps complete</span></div>
            <div className="stat-card"><CreditCard size={18} /><strong>{selectedOrganisation.platformFeeMonthly == null ? 'Not set' : `£${selectedOrganisation.platformFeeMonthly.toFixed(2)}`}</strong><span>Monthly platform fee</span></div>
          </div>

          <PharmacyStaffManager key={selectedOrganisation.id} organisation={selectedOrganisation} onCountChange={updateSelectedStaffCount} />

          <div className="admin-detail-grid admin-config-grid">
            <section className="card admin-detail-card">
              <div className="admin-detail-card-title"><Building2 size={18} /><h2>Registered details</h2></div>
              <div className="admin-detail-list">
                <div><span>Display name</span><strong>{selectedOrganisation.name}</strong></div>
                <div><span>GPhC number</span><strong>{selectedOrganisation.gphcNumber}</strong></div>
                <div><span>Superintendent</span><strong>{selectedOrganisation.superintendent}</strong></div>
                <div><span>Address</span><strong><MapPin size={13} /> {selectedOrganisation.address}</strong></div>
                <div><span>Approved domains</span><strong><Globe2 size={13} /> {selectedOrganisation.websiteDomains.join(', ') || 'Not supplied'}</strong></div>
                <div><span>Monthly HHH platform fee</span><strong>{selectedOrganisation.platformFeeMonthly == null ? 'Not set' : `£${selectedOrganisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
              </div>
            </section>

            <section className="card admin-detail-card tenant-brand-editor">
              <div className="admin-detail-card-title"><Settings2 size={18} /><h2>Brand and portal identity</h2></div>
              <label>Portal name<input className="input" value={selectedOrganisation.brand.portalName} readOnly /></label>
              <div className="brand-editor-row">
                <label>Primary colour<span><input type="color" value={selectedOrganisation.brand.primary} disabled /><code>{selectedOrganisation.brand.primary}</code></span></label>
                <label>Automatic secondary<span className="derived-colour"><i style={{ background: tenantTheme.secondary }} /><code>{tenantTheme.secondary}</code><small>Derived from primary</small></span></label>
              </div>
              <div className="generated-palette" aria-label="Automatically generated tenant palette"><span style={{ background: tenantTheme.primary }} title="Primary" /><span style={{ background: tenantTheme.secondary }} title="Secondary" /><span style={{ background: tenantTheme.primaryMuted }} title="Muted brand" /><span style={{ background: tenantTheme.primarySoft }} title="Soft surface" /><span style={{ background: tenantTheme.sidebar }} title="Navigation" /></div>
              <p className="theme-help">Secondary, soft surfaces, navigation and readable text colours update automatically. Success, warning and error colours remain consistent across every pharmacy.</p>
              <div className="tenant-brand-preview" style={{ borderTopColor: tenantTheme.primary, background: tenantTheme.surfaceTint }}><div className="tenant-mark" style={brandSwatchStyle(selectedOrganisation.brand.primary)}>{selectedOrganisation.logoText}</div><span><strong>{selectedOrganisation.brand.portalName}</strong><small>Patient and pharmacy workspace preview</small></span><button style={{ background: tenantTheme.primary, color: tenantTheme.onPrimary }}>Primary action</button><button className="preview-secondary" style={{ background: tenantTheme.secondary, color: tenantTheme.onSecondary }}>Secondary</button></div>
            </section>
          </div>

          <div className="admin-detail-grid admin-config-grid">
            <section className="card admin-detail-card">
              <div className="admin-detail-card-title"><Settings2 size={18} /><h2>Tenant modules</h2></div>
              <p className="admin-card-intro">Enable only the capabilities included in this pharmacy’s service.</p>
              <div className="admin-module-list">
                {(Object.keys(MODULE_LABELS) as TenantModule[]).map(module => <label key={module}><span><strong>{MODULE_LABELS[module]}</strong><small>{selectedOrganisation.modules[module] ? 'Available to pharmacy staff' : 'Hidden from navigation'}</small></span><input type="checkbox" checked={selectedOrganisation.modules[module]} disabled /></label>)}
              </div>
            </section>

            <section className="card admin-detail-card admin-detail-assets">
              <div className="admin-detail-card-title"><Link2 size={18} /><h2>Eligibility form and content assets</h2></div>
              <p>Every submission through this hosted URL is permanently attributed to this client token.</p>
              <div className="resource-url">{formUrl}</div>
              <div className="flex gap-sm flex-wrap"><button className="btn btn-primary btn-sm" onClick={async () => { await navigator.clipboard.writeText(formUrl); dispatch({ type: 'ADD_TOAST', message: 'Eligibility link copied.', toastType: 'success' }); }}><Copy size={13} /> Copy link</button><a className="btn btn-sm" href={formUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Preview form</a><button className="btn btn-sm" onClick={() => void downloadContentPack(selectedOrganisation)}><FileArchive size={13} /> Content pack</button></div>
            </section>
          </div>

          <section className="card admin-patient-table admin-client-compliance">
            <div className="admin-directory-head"><div><p className="section-label">Go-live checklist</p><h2>Pharmacy setup</h2><p>The pharmacy completes its operational steps in Settings; HHH completes Curaleaf activation.</p></div><span className="pill pill-info">{readiness.ready} of {readiness.total} complete</span></div>
            {setupError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {setupError}</div>}
            <div className="compliance-table table-wrap"><table><thead><tr><th>Setup step</th><th>Evidence</th><th>Status</th></tr></thead><tbody>{SETUP_TASKS.map(definition => { const task = setupStatus?.tasks.find(item => item.id === definition.id); return <tr key={definition.id}><td><strong>{definition.title}</strong><small>{definition.description}</small></td><td>{task?.evidence || 'Not supplied yet'}</td><td><span className={`pill ${task?.completed ? 'pill-green' : 'pill-amber'}`}>{task?.completed ? 'Complete' : 'Waiting'}</span></td></tr>; })}</tbody></table></div>
          </section>

          {showPharmacyEditor && <EditPharmacy key={selectedOrganisation.id} organisation={selectedOrganisation} onClose={() => setShowPharmacyEditor(false)} onSaved={updates => {
            dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisation.id, updates });
            dispatch({ type: 'ADD_TOAST', message: `${updates.tradingName ?? selectedOrganisation.tradingName} details saved to Firebase.`, toastType: 'success' });
          }} />}

          <section className="card admin-patient-table">
            <div className="admin-directory-head"><div><h2>Patients attributed to this pharmacy</h2><p>Attribution is derived from the pharmacy token and retained on the patient record.</p></div></div>
            {submissions.length === 0 ? <div className="empty-state">No attributed eligibility submissions yet.</div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Submitted</th><th>Condition</th><th>Source</th><th>Status</th></tr></thead><tbody>{submissions.map(sub => <tr key={sub.id}><td><strong>{sub.name}</strong><small>{sub.email}</small></td><td>{new Date(sub.submittedAt).toLocaleDateString('en-GB')}</td><td>{sub.condition}</td><td>{sub.source}</td><td><span className="pill pill-info">{sub.status}</span></td></tr>)}</tbody></table></div>}
          </section>
        </div>
      </main>
    );
  }

  const renderOverview = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Multi-pharmacy operations</p><h1>Client administration</h1><p>Provision tenant workspaces, monitor attribution and control each pharmacy’s go-live gate.</p></div><button className="btn btn-primary" onClick={() => setShowOnboarding(true)}><Plus size={15} /> Onboard pharmacy</button></div>
      <div className="stats-grid admin-overview-stats">
        <div className="stat-card"><Building2 size={18} /><strong>{state.organisations.length}</strong><span>Pharmacy clients</span></div>
        <div className="stat-card"><ShieldCheck size={18} /><strong>{liveCount}</strong><span>Live tenants</span></div>
        <div className="stat-card"><Users size={18} /><strong>{allPatients.length}</strong><span>Attributed patients</span></div>
        <div className="stat-card"><AlertCircle size={18} /><strong>{remainingSetupSteps}</strong><span>Setup steps remaining</span></div>
      </div>

      {remainingSetupSteps > 0 && <section className="card admin-attention-strip">
        <div><AlertCircle size={18} /><span><strong>Some pharmacy setup is still incomplete</strong><small>{remainingSetupSteps} step{remainingSetupSteps === 1 ? '' : 's'} remain across the current pharmacy clients.</small></span></div>
        <button className="btn btn-sm" onClick={() => setView('compliance')}>Open readiness</button>
      </section>}

      <section className="card admin-directory">
        <div className="admin-directory-head"><div><h2>Pharmacy clients</h2><p>Account records, tenant configuration and patient attribution.</p></div><label className="admin-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or GPhC number" /></label></div>
        <div className="admin-org-list">
          {filteredOrganisations.length === 0 && <div className="empty-state">{state.organisations.length === 0 ? 'No pharmacy clients have been onboarded yet.' : 'No pharmacy clients match this search.'}</div>}
          {filteredOrganisations.map(org => {
            const submissions = submissionsByOrganisation.get(org.id) ?? [];
            const patients = crmByOrganisation.get(org.id) ?? [];
            const readiness = tenantReadiness(org.id);
            return (
              <article className="admin-org-row" key={org.id}>
                <div className="admin-org-brand"><div className="tenant-mark" style={brandSwatchStyle(org.brand.primary)}>{org.logoText}</div><div><strong>{org.name}</strong><span>GPhC {org.gphcNumber} · {org.websiteDomains.join(', ') || 'domain pending'}</span></div></div>
                <div className="admin-org-metric"><strong>{new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size}</strong><span>Patients</span></div>
                <div className="readiness-cell"><div><strong>{readiness.percent}%</strong><span>{readiness.ready}/{readiness.total} gates</span></div><div className="mini-progress"><span style={{ width: `${readiness.percent}%` }} /></div></div>
                <div className="admin-org-actions"><span className={`pill ${org.status === 'live' ? 'pill-green' : org.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{org.status}</span><button className="btn btn-sm" onClick={() => setSelectedOrganisationId(org.id)}>Manage client</button></div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );

  const renderReferrals = () => {
    const pending = state.submissions.filter(submission => submission.status === 'New' || submission.status === 'Under HHH review');
    const reviewed = state.submissions.filter(submission => submission.status === 'Approved' || submission.status === 'Declined');
    const statusClass = (status: string) => status === 'Approved' ? 'pill-green' : status === 'Declined' ? 'pill-red' : status === 'Under HHH review' ? 'pill-amber' : 'pill-info';
    const row = (submission: typeof state.submissions[number]) => {
      const organisation = state.organisations.find(org => org.id === submission.organisationId);
      const hasCall = submission.calls.length > 0;
      return (
        <tr key={submission.id}>
          <td><strong>{submission.name}</strong><small>{submission.email} · {submission.mobile}</small></td>
          <td><strong>{organisation?.tradingName ?? submission.pharmacyName}</strong><small>Token-attributed pharmacy</small></td>
          <td><strong>{submission.condition}</strong><small>{submission.tried2 ? 'Two treatments reported' : 'Treatment history requires review'} · {submission.psychExclusion ? 'Exclusion flagged' : 'No psychosis exclusion reported'}</small></td>
          <td><strong>{submission.calls.length}</strong><small>{hasCall ? `Last call ${new Date(submission.calls.at(-1)!.ts).toLocaleDateString('en-GB')}` : 'Shaylen call required before decision'}</small></td>
          <td><span className={`pill ${statusClass(submission.status)}`}>{submission.status}</span>{submission.reviewedBy && <small>{submission.reviewedBy} · {submission.reviewedAt ? new Date(submission.reviewedAt).toLocaleDateString('en-GB') : ''}</small>}</td>
          <td>
            {submission.status === 'New' || submission.status === 'Under HHH review' ? <div className="admin-referral-actions">
              <button className="btn btn-sm" onClick={() => dispatch({ type: 'LOG_CALL', subId: submission.id })}><PhoneCall size={13} /> Log Shaylen call</button>
              <button className="btn btn-sm btn-primary" disabled={!hasCall} onClick={() => { dispatch({ type: 'APPROVE_ONBOARDING', subId: submission.id }); dispatch({ type: 'ADD_TOAST', message: `${submission.name} approved for HHH programme onboarding and released to ${organisation?.tradingName ?? 'the pharmacy'}.`, toastType: 'success' }); }}><UserCheck size={13} /> Approve</button>
              <button className="btn btn-sm" disabled={!hasCall} onClick={() => { dispatch({ type: 'DECLINE_ONBOARDING', subId: submission.id }); dispatch({ type: 'ADD_TOAST', message: `${submission.name} was not approved for programme onboarding.`, toastType: 'warning' }); }}><UserX size={13} /> Decline</button>
            </div> : <small>{submission.decisionNote}</small>}
          </td>
        </tr>
      );
    };
    return (
      <>
        <div className="admin-title"><div><p className="section-label">HHH programme gate</p><h1>Patient onboarding decisions</h1><p>Eligibility links attribute patients to a pharmacy. Shaylen reviews and calls each patient; only HHH-approved patients are released into that pharmacy’s ordering CRM.</p></div><span className="pill pill-amber"><PhoneCall size={13} /> {pending.length} awaiting decision</span></div>
        <section className="integration-boundary card"><ShieldCheck size={20} /><div><strong>Approval boundary</strong><p>HHH approval authorises programme onboarding only. It does not diagnose, prescribe, replace a doctor’s prescription, or replace the pharmacy’s legal and professional checks before dispensing.</p></div></section>
        <section className="card admin-patient-table admin-referral-register">
          <div className="admin-directory-head"><div><h2>Awaiting HHH review</h2><p>A logged patient call is required before an approval or decline decision can be recorded.</p></div></div>
          {pending.length ? <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Attributed pharmacy</th><th>Screening summary</th><th>HHH calls</th><th>Status</th><th>Decision</th></tr></thead><tbody>{pending.map(row)}</tbody></table></div> : <div className="empty-state">No onboarding decisions are waiting.</div>}
        </section>
        <section className="card admin-patient-table admin-referral-register">
          <div className="admin-directory-head"><div><h2>Decision history</h2><p>Approved patients become available only inside their attributed pharmacy workspace.</p></div></div>
          {reviewed.length ? <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Attributed pharmacy</th><th>Screening summary</th><th>HHH calls</th><th>Status</th><th>Decision record</th></tr></thead><tbody>{reviewed.map(row)}</tbody></table></div> : <div className="empty-state">No decisions have been recorded.</div>}
        </section>
      </>
    );
  };

  const renderPatients = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Cross-client register</p><h1>Patients and pharmacy attribution</h1><p>Authorised Healius Consulting administrators can see which pharmacy every patient reached and use this view to support client feedback.</p></div><span className="pill pill-info"><Users size={13} /> {allPatients.length} unique records</span></div>
      <section className="card admin-patient-table admin-master-patients">
        <div className="admin-directory-head"><div><h2>Patient register</h2><p>Operational oversight only. Every access must be authenticated and audited in production.</p></div><label className="admin-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search patient or pharmacy" /></label></div>
        <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Attributed pharmacy</th><th>Current stage</th><th>Acquisition source</th><th>Last recorded</th></tr></thead><tbody>{filteredPatients.map(patient => { const org = state.organisations.find(item => item.id === patient.organisationId); return <tr key={`${patient.organisationId}-${patient.email}`}><td><strong>{patient.name}</strong><small>{patient.email} · {patient.mobile}</small></td><td><button className="table-link" onClick={() => setSelectedOrganisationId(patient.organisationId)}>{org?.tradingName ?? 'Unknown tenant'}</button><small>{org?.gphcNumber}</small></td><td><span className="pill pill-info">{patient.stage}</span></td><td>{patient.source}</td><td>{patient.date ? new Date(patient.date).toLocaleDateString('en-GB') : '—'}</td></tr>; })}</tbody></table></div>
      </section>
    </>
  );

  const renderCompliance = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Operational setup</p><h1>Pharmacy readiness</h1><p>A concise view of the six steps each pharmacy must complete before live processing.</p></div><span className="pill pill-info"><ClipboardCheck size={13} /> Six-step checklist</span></div>
      <section className="compliance-summary-grid">
        <div className="card"><span>Pharmacies</span><strong>{state.organisations.length}</strong><small>Current client accounts</small></div>
        <div className="card"><span>Fully ready</span><strong>{Object.values(setupByOrganisation).filter(status => status.completed).length}</strong><small>All six steps complete</small></div>
        <div className="card"><span>Steps complete</span><strong>{Object.values(setupByOrganisation).reduce((total, status) => total + status.completedCount, 0)}</strong><small>Across all pharmacies</small></div>
        <div className="card"><span>Still waiting</span><strong>{remainingSetupSteps}</strong><small>Steps requiring action</small></div>
      </section>
      <section className="card admin-patient-table compliance-register">
        <div className="admin-directory-head"><div><h2>Client setup progress</h2><p>Open a client to see its evidence. Pharmacy staff update their own steps; Curaleaf activation remains HHH-admin only.</p></div></div>
        {setupError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {setupError}</div>}
        {state.organisations.length === 0 ? <div className="empty-state">No pharmacy clients have been onboarded yet.</div> : <div className="table-wrap"><table><thead><tr><th>Pharmacy</th><th>Setup progress</th><th>Next action</th><th>Status</th><th /></tr></thead><tbody>{state.organisations.map(organisation => { const status = setupByOrganisation[organisation.id]; const readiness = tenantReadiness(organisation.id); const nextTask = SETUP_TASKS.find(definition => !status?.tasks.find(task => task.id === definition.id)?.completed); return <tr key={organisation.id}><td><strong>{organisation.tradingName}</strong><small>GPhC {organisation.gphcNumber}</small></td><td><strong>{readiness.ready} of {readiness.total} complete</strong><small>{readiness.percent}% ready</small></td><td><strong>{nextTask?.title ?? 'No action required'}</strong><small>{nextTask?.id === 'curaleaf_account' ? 'HHH administrator' : nextTask ? 'Pharmacy team' : 'Setup complete'}</small></td><td><span className={`pill ${status?.completed ? 'pill-green' : 'pill-amber'}`}>{status?.completed ? 'Ready' : 'In setup'}</span></td><td><button className="btn btn-sm" onClick={() => setSelectedOrganisationId(organisation.id)}>Review</button></td></tr>; })}</tbody></table></div>}
      </section>
    </>
  );

  const submitCuraleafActivation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCuraleafBusy(true);
    setCuraleafError(null);
    try {
      const status = await activateCuraleafPharmacy({
        organisationId: curaleafOrganisationId,
        customerId: curaleafCustomerId.trim(),
        portalEmail: curaleafPortalEmail.trim(),
      });
      if (!status.connected) throw new Error(status.message || 'The credentials were stored but Curaleaf verification did not succeed.');
      const pharmacy = state.organisations.find(org => org.id === curaleafOrganisationId);
      const updatedSetup = await getPharmacySetupStatus(curaleafOrganisationId);
      setSetupByOrganisation(current => ({ ...current, [curaleafOrganisationId]: updatedSetup }));
      dispatch({ type: 'ADD_TOAST', message: `${pharmacy?.tradingName ?? 'Pharmacy'} activated with Curaleaf ${status.maskedIdentifier ?? ''}.`, toastType: 'success' });
      setCuraleafCustomerId('');
      setCuraleafPortalEmail('');
    } catch (error) {
      setCuraleafError(error instanceof Error ? error.message : 'Curaleaf activation failed.');
    } finally {
      setCuraleafBusy(false);
    }
  };

  const renderIntegrations = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Shared infrastructure</p><h1>Platform integrations</h1><p>Supplier, payment, intake and notification services configured for the HHH platform operated by Healius Consulting.</p></div><span className="pill pill-info"><ShieldCheck size={13} /> Platform-level access</span></div>
      <section className="integration-boundary card"><ShieldCheck size={20} /><div><strong>Tenant payment boundary</strong><p>Each pharmacy owns its patient prices and approved Worldpay merchant relationship. Patient funds settle directly to that pharmacy. HHH charges a separate platform subscription fee and does not retain a percentage of prescription sales.</p></div></section>
      <form className="card secure-integration-form" onSubmit={submitCuraleafActivation}>
        <div className="admin-directory-head"><div><p className="section-label">HHH administrator only</p><h2>Activate a pharmacy’s Curaleaf account</h2><p>After Curaleaf returns its onboarding email and customer ID, connect them here. Until this succeeds, the pharmacy stays in a session-only training workspace.</p></div><LockKeyhole size={22} /></div>
        <div className="form-grid-two">
          <label>Pharmacy<select className="input" value={curaleafOrganisationId} onChange={event => setCuraleafOrganisationId(event.target.value)} required>{state.organisations.map(org => <option value={org.id} key={org.id}>{org.tradingName}</option>)}</select></label>
          <label>Curaleaf portal email<input className="input" type="email" autoComplete="off" value={curaleafPortalEmail} onChange={event => setCuraleafPortalEmail(event.target.value)} required /></label>
          <label>Curaleaf customer ID<input className="input" autoComplete="off" value={curaleafCustomerId} onChange={event => setCuraleafCustomerId(event.target.value)} required /></label>
        </div>
        <div className="setup-security-note"><ShieldCheck size={16} /><span>HHH’s single Curaleaf API key is held once as a Firebase Functions deployment secret. This form stores only this pharmacy’s customer ID and portal email in a Europe-hosted Secret Manager secret; Firestore receives a masked identifier only.</span></div>
        {curaleafError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {curaleafError}</div>}
        <div className="drawer-actions"><button className="btn btn-primary" type="submit" disabled={curaleafBusy || !curaleafOrganisationId}>{curaleafBusy ? 'Verifying securely…' : 'Verify and activate pharmacy'}</button></div>
      </form>
      <div className="integration-cards">
        {state.platformIntegrations.map(integration => <section className="card integration-card" key={integration.id}><div className="integration-card-head"><div className="settings-card-icon">{integration.id === 'worldpay' ? <CreditCard size={18} /> : integration.id === 'eligibility-api' ? <Link2 size={18} /> : <Settings2 size={18} />}</div><span className={`pill ${integration.status === 'connected' ? 'pill-green' : integration.status === 'attention' ? 'pill-red' : 'pill-amber'}`}>{integration.status}</span></div><h2>{integration.name}</h2><p>{integration.description}</p><div className="integration-meta"><span>Scope</span><strong>{integration.id === 'worldpay' ? `${state.organisations.filter(org => org.worldpay.status === 'connected').length}/${state.organisations.length} merchants connected` : 'HHH platform'}</strong></div><button className="btn btn-sm" onClick={() => dispatch({ type: 'ADD_TOAST', message: `${integration.name} configuration requires live credentials and server-side setup.`, toastType: 'info' })}>View implementation status</button></section>)}
      </div>
    </>
  );

  return (
    <main className="admin-shell">
      <AdminHeader view={view} setView={next => { setView(next); setQuery(''); }} />
      <div className="admin-content">
        {view === 'overview' && renderOverview()}
        {view === 'referrals' && renderReferrals()}
        {view === 'patients' && renderPatients()}
        {view === 'compliance' && renderCompliance()}
        {view === 'integrations' && renderIntegrations()}
      </div>
      {showOnboarding && <OnboardPharmacy onClose={() => setShowOnboarding(false)} onCreated={id => { setShowOnboarding(false); setSelectedOrganisationId(id); }} />}
    </main>
  );
}
