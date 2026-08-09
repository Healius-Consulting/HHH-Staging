import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Copy,
  Download,
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
  PoundSterling,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
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
import { onboardingStatusLabel, onboardingStatusPillClass } from '../utils/onboardingStatus';
import { useAuth } from '../auth/useAuth';
import { requireFirebaseAuth } from '../auth/firebase';
import { passwordResetActionSettings } from '../auth/passwordReset';
import { activateCuraleafPharmacy, approveCuraleafPharmacy, completeReferralRecordsCheck, createOrganisation, createPharmacyStaffInvitation, getAdminPatientRegister, getAdminReferralFinance, getCuraleafConnectionStatus, getPharmacySetupStatus, getPharmacyStaff, queueReferralPatientEmail, recordPatientRegisterExport, recordReferralDecision, removePharmacyStaff, updateOrganisation } from '../shared/api';
import type { AdminReferralFinanceReport, CuraleafConnectionStatus, CuraleafValidationReport, PatientRegisterExportResult, PharmacySetupStatus, PharmacyStaffAccount, PharmacyStaffInvitation, UpdateOrganisationInput } from '../shared/contracts';
import { SETUP_TASKS } from '../onboarding/setup';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { useModalFocus } from '../accessibility/useModalFocus';
import WorkspaceNavigation, { type WorkspaceNavGroup } from '../components/WorkspaceNavigation';
import HhhBrandMark from '../components/HhhBrandMark';
import WorkspacePageHeader from '../components/WorkspacePageHeader';
import CommandPalette, { type CommandDefinition } from '../components/CommandPalette';
import SummaryTiles from '../components/SummaryTiles';
import CompactPatientCell from '../components/CompactPatientCell';
import { formatPatientDob } from '../utils/patientDob';
import ConditionList from '../components/ConditionList';

type AdminView = 'overview' | 'referrals' | 'patients' | 'finance' | 'platform';
type PlatformTab = 'setup' | 'curaleaf';
type PharmacyDetailTab = 'access' | 'config' | 'patients';

type AdminFeeEvent = {
  id: string;
  kind: 'new-referral' | 'annual-patient';
  amount: number;
  occurredAt: Date;
  organisationId: string;
  pharmacyName: string;
  patientKey: string;
  patientName: string;
  patientEmail: string;
  anniversary: number | null;
};

const referralFeeFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

function toValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function referralAnniversary(referralDate: Date, yearNumber: number) {
  const anniversary = new Date(referralDate);
  anniversary.setFullYear(referralDate.getFullYear() + yearNumber);
  return anniversary;
}

function referralFinanceDateRange(period: 'all' | 'month' | 'year', month: string, year: string) {
  if (period === 'month' && /^\d{4}-\d{2}$/.test(month)) {
    const [yearNumber, monthNumber] = month.split('-').map(Number);
    const finalDay = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(finalDay).padStart(2, '0')}` };
  }
  if (period === 'year' && /^\d{4}$/.test(year)) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return {};
}

function londonDateKey(value: Date | string | null) {
  const date = toValidDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const text = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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

function AdminHeader({ view, setView, pending = 0, readiness = 0 }: { view: AdminView; setView: (view: AdminView) => void; pending?: number; readiness?: number }) {
  const { signOutStaff } = useAuth();
  const { state } = useApp();
  const staffName = state.staffSession?.name || 'HHH Administrator';
  const groups: WorkspaceNavGroup<AdminView>[] = [
    { label: 'Administration', items: [
      { key: 'overview', label: 'Pharmacies', icon: <LayoutDashboard size={17} /> },
      { key: 'referrals', label: 'Onboarding', icon: <UserCheck size={17} />, count: pending },
      { key: 'patients', label: 'Patients', icon: <Users size={17} /> },
      { key: 'finance', label: 'Finance', icon: <PoundSterling size={17} /> },
    ] },
    { label: 'Platform', items: [
      { key: 'platform', label: 'Platform', icon: <ClipboardCheck size={17} />, count: readiness },
    ] },
  ];
  return <WorkspaceNavigation
    ariaLabel="HHH administration"
    activeKey={view}
    groups={groups}
    mobilePrimaryKeys={['overview', 'referrals', 'patients', 'finance']}
    onNavigate={setView}
    brand={{ title: 'Holistic Health Hub', subtitle: 'Operations console', logo: <HhhBrandMark /> }}
    user={{ initials: staffName.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(), name: staffName, role: 'HHH administrator' }}
    exitAction={{ label: 'Sign out', icon: <LogOut size={14} />, onClick: () => void signOutStaff() }}
    moreTitle="More administration tools"
  />;
}

function OnboardPharmacy({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { dispatch } = useApp();
  const [name, setName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [gphcNumber, setGphcNumber] = useState('');
  const [superintendent, setSuperintendent] = useState('');
  const [companyNumber, setCompanyNumber] = useState('');
  const [mainContactName, setMainContactName] = useState('');
  const [mainContactPhone, setMainContactPhone] = useState('');
  const [mainContactEmail, setMainContactEmail] = useState('');
  const [address, setAddress] = useState('');
  const [domain, setDomain] = useState('');
  const [primary, setPrimary] = useState('#0f766e');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onboardingTheme = deriveTenantTheme(primary);
  const onboardingDialogRef = useModalFocus<HTMLElement>(true, onClose);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const slug = slugify(tradingName || name);
    const logoText = (tradingName || name).split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const websiteDomains = domain ? [domain.replace(/^https?:\/\//, '').replace(/\/$/, '')] : [];
    try {
      const created = await createOrganisation({ name, tradingName, gphcNumber, superintendent, companyNumber, mainContactName, mainContactPhone, mainContactEmail, address, websiteDomains, primaryColour: primary, logoText, status: 'onboarding' });
      const organisation: PharmacyTenant = {
        id: created.id, slug, referralToken: created.referralToken, name, tradingName, logoText, gphcNumber, superintendent, companyNumber, mainContactName, mainContactPhone, mainContactEmail, address, websiteDomains,
        status: 'onboarding', staffCount: 0, platformFeeMonthly: null, defaultPaymentRoute: 'manual',
        brand: { primary, portalName: name }, modules: defaultModules,
        worldpay: { enabled: false, status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
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
      <aside ref={onboardingDialogRef} className="drawer admin-onboarding-drawer" role="dialog" aria-modal="true" aria-labelledby="onboard-title" tabIndex={-1}>
        <div className="drawer-header"><div><p className="section-label">New pharmacy</p><h2 id="onboard-title">Onboard a pharmacy</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="drawer-body onboarding-form" onSubmit={submit}>
          <div className="form-section-heading"><span>01</span><div><strong>Registered organisation</strong><small>Legal and GPhC identity used for compliance evidence.</small></div></div>
          <label>Registered pharmacy name<input className="input" value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Company name<input className="input" value={tradingName} onChange={event => setTradingName(event.target.value)} required /></label>
          <div className="form-grid-two"><label>GPhC number<input className="input" value={gphcNumber} onChange={event => setGphcNumber(event.target.value)} required /></label><label>Superintendent pharmacist<input className="input" value={superintendent} onChange={event => setSuperintendent(event.target.value)} required /></label></div>
          <label>Company registration number<input className="input" value={companyNumber} onChange={event => setCompanyNumber(event.target.value)} required /></label>
          <label>Registered office address<textarea className="input" value={address} onChange={event => setAddress(event.target.value)} required /></label>
          <div className="form-grid-two"><label>Main contact name<input className="input" value={mainContactName} onChange={event => setMainContactName(event.target.value)} required /></label><label>Main contact number<input className="input" type="tel" value={mainContactPhone} onChange={event => setMainContactPhone(event.target.value)} required /></label></div>
          <label>Main contact email<input className="input" type="email" value={mainContactEmail} onChange={event => setMainContactEmail(event.target.value)} required /></label>
          <label>Approved website domain<input className="input" type="text" value={domain} onChange={event => setDomain(event.target.value)} placeholder="pharmacy.co.uk" /></label>

          <div className="form-section-heading"><span>02</span><div><strong>Workspace identity</strong><small>The colour is applied consistently across that pharmacy’s workspace.</small></div></div>
          <div className="brand-colour-field"><input type="color" value={primary} onChange={event => setPrimary(event.target.value)} /><div><strong>Primary brand colour</strong><small>{primary.toUpperCase()} · secondary generated automatically</small></div><div className="onboarding-palette"><i style={{ background: onboardingTheme.primary }} /><i style={{ background: onboardingTheme.secondary }} /><i style={{ background: onboardingTheme.primarySoft }} /></div><div className="brand-preview-button" style={{ background: onboardingTheme.primary, color: onboardingTheme.onPrimary }}>Action</div></div>

          <div className="onboarding-callout"><ShieldCheck size={17} /><span>The pharmacy starts in onboarding status. Its six setup steps must be completed before live processing begins.</span></div>
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
  const [companyNumber, setCompanyNumber] = useState(organisation.companyNumber ?? '');
  const [mainContactName, setMainContactName] = useState(organisation.mainContactName ?? organisation.superintendent);
  const [mainContactPhone, setMainContactPhone] = useState(organisation.mainContactPhone ?? '');
  const [mainContactEmail, setMainContactEmail] = useState(organisation.mainContactEmail ?? '');
  const [address, setAddress] = useState(organisation.address);
  const [domains, setDomains] = useState(organisation.websiteDomains.join('\n'));
  const [status, setStatus] = useState(organisation.status);
  const [logoText] = useState(organisation.logoText);
  const [primaryColour, setPrimaryColour] = useState(organisation.brand.primary);
  const [platformFee, setPlatformFee] = useState(organisation.platformFeeMonthly?.toString() ?? '');
  const [modules, setModules] = useState({ ...organisation.modules });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editTheme = deriveTenantTheme(primaryColour);
  const editDialogRef = useModalFocus<HTMLElement>(true, onClose);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const websiteDomains = [...new Set(domains.split(/[\n,]+/).map(value => value.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()).filter(Boolean))];
    const input: UpdateOrganisationInput = {
      name, tradingName, gphcNumber, superintendent, companyNumber, mainContactName, mainContactPhone, mainContactEmail, address, websiteDomains, status, logoText: logoText.toUpperCase(),
      primaryColour, portalName: name.trim(), platformFeeMonthly: platformFee === '' ? null : Number(platformFee), modules,
    };
    try {
      await updateOrganisation(organisation.id, input);
      onSaved({
        name: name.trim(), tradingName: tradingName.trim(), gphcNumber: gphcNumber.trim(), superintendent: superintendent.trim(), companyNumber: companyNumber.trim(), mainContactName: mainContactName.trim(), mainContactPhone: mainContactPhone.trim(), mainContactEmail: mainContactEmail.trim(), address: address.trim(),
        websiteDomains, status, logoText: logoText.trim().toUpperCase(), platformFeeMonthly: input.platformFeeMonthly,
        brand: { primary: primaryColour, portalName: name.trim() }, modules,
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
      <aside ref={editDialogRef} className="drawer admin-onboarding-drawer" role="dialog" aria-modal="true" aria-labelledby="edit-pharmacy-title" tabIndex={-1}>
        <div className="drawer-header"><div><p className="section-label">HHH administrator</p><h2 id="edit-pharmacy-title">Edit pharmacy details</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="drawer-body onboarding-form" onSubmit={submit}>
          <div className="form-section-heading"><span>01</span><div><strong>Registered organisation</strong><small>Corrections are saved to Firebase and added to the audit trail.</small></div></div>
          <label>Registered pharmacy name<input className="input" value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Company name<input className="input" value={tradingName} onChange={event => setTradingName(event.target.value)} required /></label>
          <div className="form-grid-two"><label>GPhC number<input className="input" value={gphcNumber} onChange={event => setGphcNumber(event.target.value)} required /></label><label>Superintendent pharmacist<input className="input" value={superintendent} onChange={event => setSuperintendent(event.target.value)} required /></label></div>
          <label>Company registration number<input className="input" value={companyNumber} onChange={event => setCompanyNumber(event.target.value)} required /></label>
          <label>Registered office address<textarea className="input" value={address} onChange={event => setAddress(event.target.value)} required /></label>
          <div className="form-grid-two"><label>Main contact name<input className="input" value={mainContactName} onChange={event => setMainContactName(event.target.value)} required /></label><label>Main contact number<input className="input" type="tel" value={mainContactPhone} onChange={event => setMainContactPhone(event.target.value)} required /></label></div>
          <label>Main contact email<input className="input" type="email" value={mainContactEmail} onChange={event => setMainContactEmail(event.target.value)} required /></label>
          <label>Approved website domains<textarea className="input" value={domains} onChange={event => setDomains(event.target.value)} placeholder={'pharmacy.co.uk\nanother-domain.co.uk'} /><small>Enter one domain per line. Protocols and page paths are removed automatically.</small></label>
          <div className="form-grid-two"><label>Account status<select className="input" value={status} onChange={event => setStatus(event.target.value as PharmacyTenant['status'])}><option value="onboarding">Onboarding</option><option value="live">Live</option><option value="paused">Paused</option></select></label><label>Monthly HHH platform fee (£)<input className="input" type="number" min="0" max="100000" step="0.01" value={platformFee} onChange={event => setPlatformFee(event.target.value)} placeholder="Not set" /></label></div>

          <div className="form-section-heading"><span>02</span><div><strong>Brand Customisation</strong><small>The portal name follows the pharmacy name automatically.</small></div></div>
          <div className="form-grid-two"><label>Pharmacy name<input className="input" value={name} readOnly /><small>Also used as the portal name.</small></label><label>Add logo<button className="btn" type="button" disabled>Choose logo file</button><small>Upload requirements are awaiting approval.</small></label></div>
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
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (isLocalPortalPreview) {
      const records: PharmacyStaffAccount[] = [
        { uid: `${organisation.id}-owner`, email: 'owner@pharmacy.example', displayName: 'Alex Morgan', role: 'pharmacy_staff', pharmacyId: organisation.id, organisationId: organisation.id, contactRole: 'owner', status: 'active', createdAt: new Date().toISOString() },
        { uid: `${organisation.id}-staff`, email: 'dispensary@pharmacy.example', displayName: 'Sam Reed', role: 'pharmacy_staff', pharmacyId: organisation.id, organisationId: organisation.id, contactRole: 'staff', status: 'active', createdAt: new Date().toISOString() },
      ];
      setStaff(records);
      onCountChange(records.length);
      setLoading(false);
      return;
    }
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
      const created = isLocalPortalPreview
        ? { uid: `preview-${Date.now()}`, pharmacyId: organisation.id, organisationId: organisation.id, displayName, email, role: 'pharmacy_staff' as const, contactRole: staff.length ? 'staff' as const : 'owner' as const, status: 'invited' as const, createdAt: new Date().toISOString(), invitationQueued: false, actionLink: '#local-preview' }
        : await createPharmacyStaffInvitation({ pharmacyId: organisation.id, organisationId: organisation.id, displayName, email });

      const updated = [...staff, created];
      setStaff(updated);
      setInvitation(created);
      setDisplayName('');
      setEmail('');
      onCountChange(updated.length);
      try {
        if (isLocalPortalPreview) {
          setEmailDelivery('sent');
          dispatch({ type: 'ADD_TOAST', message: 'Local preview account created. No email was sent.', toastType: 'success' });
          return;
        }
        await sendPasswordResetEmail(requireFirebaseAuth(), created.email, passwordResetActionSettings());
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

  const removeStaff = async (account: PharmacyStaffAccount) => {
    if (account.contactRole === 'owner' || !window.confirm(`Remove ${account.displayName}'s access? Their account history will be retained in the audit trail.`)) return;
    setDeletingUid(account.uid);
    setError(null);
    try {
      if (!isLocalPortalPreview) await removePharmacyStaff(account.uid);
      const updated = staff.filter(item => item.uid !== account.uid);
      setStaff(updated);
      onCountChange(updated.length);
      dispatch({ type: 'ADD_TOAST', message: `${account.displayName}'s access was removed. Audit history was retained.`, toastType: 'success' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The staff account could not be removed.');
    } finally {
      setDeletingUid(null);
    }
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
        {staff.map(account => <div className="admin-staff-row" key={account.uid}><div className="staff-avatar">{account.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><strong>{account.displayName}</strong><span>{account.email}</span></div><span className={`pill ${account.contactRole === 'owner' ? 'pill-info' : 'pill-neutral'}`}>{account.contactRole === 'owner' ? 'Owner' : 'Staff'}</span><span className={`pill ${account.status === 'active' ? 'pill-green' : account.status === 'disabled' ? 'pill-red' : 'pill-amber'}`}>{account.status}</span><button className="icon-btn" type="button" disabled={account.contactRole === 'owner' || deletingUid === account.uid} title={account.contactRole === 'owner' ? 'Owner account is protected' : 'Remove staff access'} aria-label={account.contactRole === 'owner' ? `${account.displayName} is the protected owner account` : `Remove ${account.displayName}`} onClick={() => void removeStaff(account)}><UserX size={16} /></button></div>)}
      </div>
    </section>
  );
}

export default function AdminPortal() {
  const { state, dispatch } = useApp();
  const [view, setView] = useState<AdminView>('overview');
  const [platformTab, setPlatformTab] = useState<PlatformTab>('setup');
  const [pharmacyDetailTab, setPharmacyDetailTab] = useState<PharmacyDetailTab>('access');
  const [query, setQuery] = useState('');
  const [patientOrganisationId, setPatientOrganisationId] = useState('all');
  const [patientStatus, setPatientStatus] = useState('all');
  const [patientFrom, setPatientFrom] = useState('');
  const [patientTo, setPatientTo] = useState('');
  const [patientExportBusy, setPatientExportBusy] = useState(false);
  const [patientExportError, setPatientExportError] = useState<string | null>(null);
  const [serverPatientRegister, setServerPatientRegister] = useState<PatientRegisterExportResult | null>(null);
  const [patientRegisterLoading, setPatientRegisterLoading] = useState(false);
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<string | null>(null);
  const [directoryMode, setDirectoryMode] = useState<'flat' | 'by-company'>('flat');
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [showPharmacyEditor, setShowPharmacyEditor] = useState(false);
  const [setupByOrganisation, setSetupByOrganisation] = useState<Record<string, PharmacySetupStatus>>({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [curaleafOrganisationId, setCuraleafOrganisationId] = useState(state.organisations[0]?.id ?? '');
  const [curaleafCustomerId, setCuraleafCustomerId] = useState('');
  const [curaleafWriteApiKey, setCuraleafWriteApiKey] = useState('');
  const [curaleafReadApiKey, setCuraleafReadApiKey] = useState('');
  const [curaleafBusy, setCuraleafBusy] = useState(false);
  const [curaleafApproveBusy, setCuraleafApproveBusy] = useState(false);
  const [curaleafError, setCuraleafError] = useState<string | null>(null);
  const [curaleafResult, setCuraleafResult] = useState<CuraleafConnectionStatus | null>(null);
  const [showCuraleafDrawer, setShowCuraleafDrawer] = useState(false);
  const [financeOrganisationId, setFinanceOrganisationId] = useState('all');
  const [financePatientKey, setFinancePatientKey] = useState('all');
  const [financePeriod, setFinancePeriod] = useState<'all' | 'month' | 'year'>('all');
  const [financeMonth, setFinanceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [financeYear, setFinanceYear] = useState(() => String(new Date().getFullYear()));
  const [adminFinanceReport, setAdminFinanceReport] = useState<AdminReferralFinanceReport | null>(null);
  const [adminFinanceLoading, setAdminFinanceLoading] = useState(false);
  const [adminFinanceError, setAdminFinanceError] = useState<string | null>(null);
  const [adminFinanceRefresh, setAdminFinanceRefresh] = useState(0);
  const [referralDialog, setReferralDialog] = useState<{ id: string | number; organisationId: string; patientName: string; action: 'records' | 'complete' | 'decline' | 'email' } | null>(null);
  const [referralNotes, setReferralNotes] = useState('');
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);

  const selectedOrganisation = state.organisations.find(org => org.id === selectedOrganisationId);

  const runReferralAction = async () => {
    if (!referralDialog) return;
    const submission = state.submissions.find(item => item.id === referralDialog.id);
    if (!submission) return;
    setReferralBusy(true);
    setReferralError(null);
    const now = new Date();
    const actor = state.staffSession?.name ?? 'HHH administrator';
    try {
      if (!isLocalPortalPreview) {
        if (referralDialog.action === 'records') {
          await completeReferralRecordsCheck(String(referralDialog.id), { organisationId: referralDialog.organisationId, notes: referralNotes.trim() });
        } else if (referralDialog.action === 'email') {
          await queueReferralPatientEmail(String(referralDialog.id), referralDialog.organisationId);
        } else {
          await recordReferralDecision(String(referralDialog.id), {
            organisationId: referralDialog.organisationId,
            decision: referralDialog.action === 'complete' ? 'completed' : 'declined',
            notes: referralNotes.trim() || null,
          });
        }
      }

      if (referralDialog.action === 'records') {
        dispatch({ type: 'UPDATE_SUBMISSION', subId: submission.id, updates: {
          status: 'Under HHH review',
          calls: [...submission.calls, { ts: now }],
          recordsCheck: { status: 'completed', notes: referralNotes.trim(), completedAt: now, completedBy: actor },
        } });
      } else if (referralDialog.action === 'complete') {
        dispatch({ type: 'UPDATE_SUBMISSION', subId: submission.id, updates: {
          status: 'Approved',
          reviewedAt: now,
          reviewedBy: actor,
          decisionNote: referralNotes.trim() || 'Referral completed.',
          referral: { status: 'completed', notes: referralNotes.trim() || null, completedAt: now, completedBy: actor },
        } });
      } else if (referralDialog.action === 'decline') {
        dispatch({ type: 'UPDATE_SUBMISSION', subId: submission.id, updates: {
          status: 'Declined',
          reviewedAt: now,
          reviewedBy: actor,
          decisionNote: referralNotes.trim() || 'Referral declined.',
          referral: { status: 'declined', notes: referralNotes.trim() || null, completedAt: now, completedBy: actor },
        } });
      } else {
        dispatch({ type: 'UPDATE_SUBMISSION', subId: submission.id, updates: {
          emailDelivery: { status: 'queued', queuedAt: now, sentAt: null, failedAt: null },
        } });
      }
      dispatch({ type: 'ADD_TOAST', message: referralDialog.action === 'records' ? 'Call and records check saved.' : referralDialog.action === 'email' ? 'Patient email queued separately.' : referralDialog.action === 'complete' ? 'Referral completed and £50 fee recorded.' : 'Referral declined.', toastType: referralDialog.action === 'decline' ? 'warning' : 'success' });
      setReferralDialog(null);
      setReferralNotes('');
    } catch (error) {
      setReferralError(error instanceof Error ? error.message : 'The referral action could not be saved.');
    } finally {
      setReferralBusy(false);
    }
  };
  const updateSelectedStaffCount = useCallback((count: number) => {
    if (selectedOrganisationId) dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisationId, updates: { staffCount: count } });
  }, [dispatch, selectedOrganisationId]);

  useEffect(() => {
    document.getElementById('admin-main-content')?.scrollTo({ top: 0 });
  }, [view, selectedOrganisationId, platformTab, pharmacyDetailTab]);

  useEffect(() => {
    if (selectedOrganisationId) setPharmacyDetailTab('access');
  }, [selectedOrganisationId]);

  useEffect(() => {
    if (!state.organisations.length) {
      setSetupByOrganisation({});
      return;
    }
    let cancelled = false;
    setSetupError(null);
    if (isLocalPortalPreview) {
      const statuses = state.organisations.map((organisation, organisationIndex): PharmacySetupStatus => {
        const completedCount = organisationIndex === 0 ? 4 : 2;
        return {
          organisationId: organisation.id,
          completed: completedCount === SETUP_TASKS.length,
          completedCount,
          requiredCount: SETUP_TASKS.length,
          updatedAt: new Date().toISOString(),
          tasks: SETUP_TASKS.map((task, taskIndex) => ({ id: task.id, completed: taskIndex < completedCount, completedAt: taskIndex < completedCount ? new Date().toISOString() : null, completedBy: taskIndex < completedCount ? 'Preview staff' : null, evidence: taskIndex < completedCount ? 'Preview evidence recorded' : null })),
        };
      });
      setSetupByOrganisation(Object.fromEntries(statuses.map(status => [status.organisationId, status])));
      return;
    }
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
    const records = new Map<string, { id: string; name: string; email: string; mobile: string; dob: string; organisationId: string; stage: string; source: string; date: Date | string | null }>();
    state.crm.forEach(patient => records.set(`${patient.organisationId}:${patient.email.toLowerCase()}`, { id: patient.id, name: patient.name, email: patient.email, mobile: patient.mobile, dob: patient.dob ?? '', organisationId: patient.organisationId, stage: patient.status, source: 'Patient record', date: patient.interactions?.at(-1)?.ts ?? null }));
    state.submissions.forEach(submission => {
      const key = `${submission.organisationId}:${submission.email.toLowerCase()}`;
      const existing = records.get(key);
      records.set(key, { id: existing?.id ?? `sub-${submission.id}`, name: submission.name, email: submission.email, mobile: submission.mobile, dob: submission.dob || existing?.dob || '', organisationId: submission.organisationId, stage: submission.status, source: submission.source, date: submission.submittedAt });
    });
    return [...records.values()];
  }, [state.crm, state.submissions]);

  const previewReferralFeeEvents = useMemo<AdminFeeEvent[]>(() => {
    const now = new Date();
    const organisations = new Map(state.organisations.map(organisation => [organisation.id, organisation]));
    const patients = new Map(state.crm.map(patient => [
      `${patient.organisationId}:${patient.email.trim().toLowerCase()}`,
      patient,
    ]));
    const events: AdminFeeEvent[] = [];

    state.submissions
      .filter(submission => submission.status === 'Approved')
      .forEach(submission => {
        const patientKey = `${submission.organisationId}:${submission.email.trim().toLowerCase()}`;
        const patient = patients.get(patientKey);
        const financePatient = patient as (typeof patient & {
          referralCompletedAt?: Date | string | null;
          activatedAt?: Date | string | null;
        });
        const completedAt = toValidDate(financePatient?.referralCompletedAt)
          ?? toValidDate(submission.reviewedAt)
          ?? toValidDate(submission.submittedAt);
        if (!completedAt) return;

        const pharmacyName = organisations.get(submission.organisationId)?.tradingName
          ?? submission.pharmacyName
          ?? 'Unknown pharmacy';
        const eventBase = {
          organisationId: submission.organisationId,
          pharmacyName,
          patientKey,
          patientName: submission.name,
          patientEmail: submission.email,
        };

        events.push({
          ...eventBase,
          id: `referral-${submission.id}`,
          kind: 'new-referral',
          amount: 50,
          occurredAt: completedAt,
          anniversary: null,
        });

        const patientStatus = String(patient?.status ?? '').toLowerCase();
        const patientIsActive = Boolean(patient)
          && patientStatus !== 'suspended'
          && patientStatus !== 'inactive'
          && patientStatus !== 'referred';
        if (!patientIsActive) return;

        for (let anniversaryNumber = 1; anniversaryNumber <= 100; anniversaryNumber += 1) {
          const anniversaryDate = referralAnniversary(completedAt, anniversaryNumber);
          if (anniversaryDate > now) break;
          events.push({
            ...eventBase,
            id: `annual-${submission.id}-${anniversaryNumber}`,
            kind: 'annual-patient',
            amount: 40,
            occurredAt: anniversaryDate,
            anniversary: anniversaryNumber,
          });
        }
      });

    return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }, [state.crm, state.organisations, state.submissions]);

  useEffect(() => {
    if (view !== 'finance' || isLocalPortalPreview) {
      setAdminFinanceError(null);
      setAdminFinanceLoading(false);
      return;
    }
    let cancelled = false;
    setAdminFinanceLoading(true);
    setAdminFinanceError(null);
    const range = referralFinanceDateRange(financePeriod, financeMonth, financeYear);
    void getAdminReferralFinance({
      ...range,
      organisationId: financeOrganisationId === 'all' ? undefined : financeOrganisationId,
    })
      .then(report => {
        if (!cancelled) setAdminFinanceReport(report);
      })
      .catch(error => {
        if (!cancelled) {
          setAdminFinanceReport(null);
          setAdminFinanceError(error instanceof Error ? error.message : 'Referral finance could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setAdminFinanceLoading(false);
      });
    return () => { cancelled = true; };
  }, [adminFinanceRefresh, financeMonth, financeOrganisationId, financePeriod, financeYear, view]);

  const referralFeeEvents = useMemo<AdminFeeEvent[]>(() => {
    if (isLocalPortalPreview) return previewReferralFeeEvents;
    return (adminFinanceReport?.rows ?? []).flatMap(row => {
      const occurredAt = toValidDate(row.occurredAt) ?? toValidDate(row.dueDate);
      if (!occurredAt) return [];
      const patient = state.crm.find(record => record.id === row.patientId);
      return [{
        id: row.id,
        kind: row.kind === 'new_referral' ? 'new-referral' as const : 'annual-patient' as const,
        amount: row.amountPence / 100,
        occurredAt,
        organisationId: row.organisationId,
        pharmacyName: row.pharmacyName,
        patientKey: `${row.organisationId}:${row.patientId}`,
        patientName: row.patientName || patient?.name || `Patient ${row.patientId.slice(0, 8)}`,
        patientEmail: row.patientEmail || patient?.email || row.patientId,
        anniversary: null,
      }];
    }).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }, [adminFinanceReport, previewReferralFeeEvents, state.crm]);

  const financePatients = useMemo(() => {
    const patients = new Map<string, { key: string; name: string; email: string }>();
    referralFeeEvents
      .filter(event => financeOrganisationId === 'all' || event.organisationId === financeOrganisationId)
      .forEach(event => patients.set(event.patientKey, { key: event.patientKey, name: event.patientName, email: event.patientEmail }));
    return [...patients.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [financeOrganisationId, referralFeeEvents]);

  const filteredReferralFeeEvents = useMemo(() => referralFeeEvents.filter(event => {
    if (financeOrganisationId !== 'all' && event.organisationId !== financeOrganisationId) return false;
    if (financePatientKey !== 'all' && event.patientKey !== financePatientKey) return false;
    if (financePeriod === 'month') {
      const eventMonth = `${event.occurredAt.getFullYear()}-${String(event.occurredAt.getMonth() + 1).padStart(2, '0')}`;
      return eventMonth === financeMonth;
    }
    if (financePeriod === 'year') return String(event.occurredAt.getFullYear()) === financeYear;
    return true;
  }), [financeMonth, financeOrganisationId, financePatientKey, financePeriod, financeYear, referralFeeEvents]);

  useEffect(() => {
    if (financePatientKey !== 'all' && !financePatients.some(patient => patient.key === financePatientKey)) {
      setFinancePatientKey('all');
    }
  }, [financePatientKey, financePatients]);

  useEffect(() => {
    if (isLocalPortalPreview || view !== 'patients') {
      setPatientRegisterLoading(false);
      return;
    }
    let cancelled = false;
    setPatientRegisterLoading(true);
    const timer = window.setTimeout(() => {
      void getAdminPatientRegister({ query: query.trim(), organisationId: patientOrganisationId, status: patientStatus, from: patientFrom || null, to: patientTo || null })
        .then(result => {
          if (!cancelled) {
            setServerPatientRegister(result);
            setPatientExportError(null);
          }
        })
        .catch(error => {
          if (!cancelled) {
            setServerPatientRegister(null);
            setPatientExportError(error instanceof Error ? error.message : 'The patient register could not be loaded.');
          }
        })
        .finally(() => { if (!cancelled) setPatientRegisterLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [patientFrom, patientOrganisationId, patientStatus, patientTo, query, view]);

  const filteredOrganisations = state.organisations.filter(org => `${org.name} ${org.tradingName} ${org.gphcNumber}`.toLowerCase().includes(query.toLowerCase()));
  const patientStatuses = [...new Set(allPatients.map(patient => patient.stage))].sort((a, b) => onboardingStatusLabel(a).localeCompare(onboardingStatusLabel(b)));
  const filteredPatients = allPatients.filter(patient => {
    const org = state.organisations.find(item => item.id === patient.organisationId);
    const searchMatches = `${patient.name} ${patient.email} ${patient.mobile} ${patient.dob} ${formatPatientDob(patient.dob)} ${org?.name ?? ''} ${org?.tradingName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
    if (!searchMatches) return false;
    if (patientOrganisationId !== 'all' && patient.organisationId !== patientOrganisationId) return false;
    if (patientStatus !== 'all' && patient.stage !== patientStatus) return false;
    const date = londonDateKey(patient.date);
    if (patientFrom && (!date || date < patientFrom)) return false;
    if (patientTo && (!date || date > patientTo)) return false;
    return true;
  });
  const displayedPatients = isLocalPortalPreview ? filteredPatients : serverPatientRegister?.rows ?? [];

  const exportPatients = async () => {
    setPatientExportBusy(true);
    setPatientExportError(null);
    try {
      const exportRows = isLocalPortalPreview
        ? filteredPatients.map(patient => {
            const organisation = state.organisations.find(item => item.id === patient.organisationId);
            return { ...patient, pharmacyName: organisation?.tradingName ?? 'Unknown pharmacy' };
          })
        : (await recordPatientRegisterExport({ query: query.trim(), organisationId: patientOrganisationId, status: patientStatus, from: patientFrom || null, to: patientTo || null, expectedScopeHash: serverPatientRegister?.recordScopeHash ?? '' })).rows;
      const header = ['Patient', 'Attributed pharmacy', 'Current stage', 'Last recorded'];
      const rows = exportRows.map(patient => [
          `${patient.name} | ${patient.email} | ${patient.mobile || '—'} | DOB ${formatPatientDob(patient.dob)}`,
          patient.pharmacyName,
          onboardingStatusLabel(patient.stage),
          patient.date ? new Date(patient.date).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '—',
        ]);
      const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hhh-patient-register-${londonDateKey(new Date())}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      dispatch({ type: 'ADD_TOAST', message: `Exported ${exportRows.length} server-scoped patient record${exportRows.length === 1 ? '' : 's'}.`, toastType: 'success' });
    } catch (error) {
      setPatientExportError(error instanceof Error ? error.message : 'The patient register could not be exported.');
    } finally {
      setPatientExportBusy(false);
    }
  };
  const liveCount = state.organisations.filter(org => org.status === 'live').length;
  const remainingSetupSteps = Object.values(setupByOrganisation).reduce((total, status) => total + status.requiredCount - status.completedCount, 0);
  const pendingAdminDecisions = state.submissions.filter(submission => submission.status === 'New' || submission.status === 'Under HHH review').length;
  const adminCommands: CommandDefinition[] = [
    { label: 'Open pharmacies', detail: 'Manage pharmacy organisations', icon: <LayoutDashboard size={16} />, run: () => { setSelectedOrganisationId(null); setView('overview'); } },
    { label: 'Review onboarding', detail: 'Record patient calls and decisions', icon: <UserCheck size={16} />, run: () => { setSelectedOrganisationId(null); setView('referrals'); } },
    { label: 'Search patients', detail: 'Open the cross-pharmacy patient register', icon: <Users size={16} />, run: () => { setSelectedOrganisationId(null); setView('patients'); } },
    { label: 'Open referral finance', detail: 'Review £50 referrals and £40 annual fees', icon: <PoundSterling size={16} />, run: () => { setSelectedOrganisationId(null); setView('finance'); } },
    { label: 'Open platform', detail: 'Pharmacy setup progress and Curaleaf activation', icon: <ClipboardCheck size={16} />, run: () => { setSelectedOrganisationId(null); setView('platform'); setPlatformTab('setup'); } },
    { label: 'Activate Curaleaf', detail: 'Connect a pharmacy Curaleaf API account', icon: <LockKeyhole size={16} />, run: () => { setSelectedOrganisationId(null); setView('platform'); setPlatformTab('curaleaf'); } },
    { label: 'Onboard pharmacy', detail: 'Create a new pharmacy workspace', icon: <Plus size={16} />, run: () => { setSelectedOrganisationId(null); setView('overview'); setShowOnboarding(true); } },
  ];

  const tenantReadiness = (organisationId: string) => {
    const status = setupByOrganisation[organisationId];
    const ready = status?.completedCount ?? 0;
    const total = status?.requiredCount ?? SETUP_TASKS.length;
    return { ready, total, percent: total ? Math.round(ready / total * 100) : 0 };
  };

  useEffect(() => {
    if (!showCuraleafDrawer || !curaleafOrganisationId) return;
    let cancelled = false;
    void getCuraleafConnectionStatus(curaleafOrganisationId)
      .then(status => {
        if (!cancelled) setCuraleafResult(status);
      })
      .catch(() => {
        if (!cancelled) setCuraleafResult(null);
      });
    return () => { cancelled = true; };
  }, [curaleafOrganisationId, showCuraleafDrawer]);

  if (selectedOrganisation) {
    const submissions = submissionsByOrganisation.get(selectedOrganisation.id) ?? [];
    const patients = crmByOrganisation.get(selectedOrganisation.id) ?? [];
    const setupStatus = setupByOrganisation[selectedOrganisation.id];
    const readiness = tenantReadiness(selectedOrganisation.id);
    const formUrl = eligibilityUrl(selectedOrganisation);
    const tenantTheme = deriveTenantTheme(selectedOrganisation.brand.primary);

    return (
      <div className="app-shell admin-shell unified-admin-shell admin-view-detail">
        <a className="skip-link" href="#admin-main-content">Skip to main content</a>
        <AdminHeader view={view} pending={pendingAdminDecisions} readiness={remainingSetupSteps} setView={next => { setSelectedOrganisationId(null); setView(next); }} />
        <div className="app-main">
          <WorkspacePageHeader section="HHH operations" context="Pharmacy detail" title={selectedOrganisation.tradingName} subtitle={`Manage identity, access, readiness and attributed patients for ${selectedOrganisation.name}.`} contextControl={!setupStatus?.completed ? <div className="header-context"><span>Setup</span><span className={`tenant-status tenant-status--${selectedOrganisation.status}`}>{readiness.percent}%</span></div> : undefined} />
          <div id="admin-main-content" className="page-container admin-content" tabIndex={-1}>
          <button className="btn btn-sm admin-detail-back" onClick={() => setSelectedOrganisationId(null)}><ArrowLeft size={14} /> {view === 'patients' ? 'Back to patient register' : 'Back to pharmacy directory'}</button>

          <section className="admin-client-heading">
            <div className="admin-org-brand"><div className="tenant-mark" style={brandSwatchStyle(selectedOrganisation.brand.primary)}>{selectedOrganisation.logoText}</div><div><p className="section-label">Pharmacy account</p><h1>{selectedOrganisation.name}</h1><span>{selectedOrganisation.tradingName} · GPhC {selectedOrganisation.gphcNumber}</span></div></div>
            <div className="admin-client-status"><span className={`pill ${selectedOrganisation.status === 'live' ? 'pill-green' : selectedOrganisation.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{selectedOrganisation.status}</span><button className="btn btn-sm" onClick={() => setShowPharmacyEditor(true)}><Pencil size={13} /> Edit details</button></div>
          </section>

          <SummaryTiles className="summary-tiles--compact admin-detail-summary" label="Pharmacy account summary" items={[
            { label: 'Patients', value: new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size, detail: 'attributed records' },
            { label: 'Access', value: selectedOrganisation.staffCount, detail: 'staff accounts' },
            { label: 'Platform fee', value: selectedOrganisation.platformFeeMonthly == null ? '—' : `£${selectedOrganisation.platformFeeMonthly.toFixed(2)}`, detail: 'per month' },
          ]} />

          <div className="filter-grid admin-detail-tabs admin-segment-tabs" role="tablist" aria-label="Pharmacy detail sections">
            <button type="button" role="tab" aria-selected={pharmacyDetailTab === 'access'} className={`filter-card${pharmacyDetailTab === 'access' ? ' active' : ''}`} onClick={() => setPharmacyDetailTab('access')}>
              <div className="filter-card__head"><span>Access</span></div>
              <span className="filter-card__value filter-card__value--text">Staff accounts</span>
            </button>
            <button type="button" role="tab" aria-selected={pharmacyDetailTab === 'config'} className={`filter-card${pharmacyDetailTab === 'config' ? ' active' : ''}`} onClick={() => setPharmacyDetailTab('config')}>
              <div className="filter-card__head"><span>Config</span></div>
              <span className="filter-card__value filter-card__value--text">Identity and assets</span>
            </button>
            <button type="button" role="tab" aria-selected={pharmacyDetailTab === 'patients'} className={`filter-card${pharmacyDetailTab === 'patients' ? ' active' : ''}`} onClick={() => setPharmacyDetailTab('patients')}>
              <div className="filter-card__head"><span>Patients</span></div>
              <span className="filter-card__value filter-card__value--text">Attribution and setup</span>
            </button>
          </div>

          {pharmacyDetailTab === 'access' && (
            <PharmacyStaffManager key={selectedOrganisation.id} organisation={selectedOrganisation} onCountChange={updateSelectedStaffCount} />
          )}

          {pharmacyDetailTab === 'config' && (
            <>
              <div className="admin-detail-grid admin-config-grid">
                <section className="card admin-detail-card">
                  <div className="admin-detail-card-title"><Building2 size={18} /><h2>Registered details</h2></div>
                  <div className="admin-detail-list">
                    <div><span>Pharmacy name</span><strong>{selectedOrganisation.name}</strong></div>
                    <div><span>Curaleaf ID (PHAR code)</span><strong>{selectedOrganisation.curaleafPharmacyCode ?? (setupStatus?.tasks.find(task => task.id === 'curaleaf_account')?.completed ? 'Connected securely' : 'Not connected')}</strong></div>
                    <div><span>Company name</span><strong>{selectedOrganisation.tradingName}</strong></div>
                    <div><span>Company registration number</span><strong>{selectedOrganisation.companyNumber || 'Not supplied'}</strong></div>
                    <div><span>GPhC number</span><strong>{selectedOrganisation.gphcNumber}</strong></div>
                    <div><span>Main contact name</span><strong>{selectedOrganisation.mainContactName || selectedOrganisation.superintendent}</strong></div>
                    <div><span>Main contact number</span><strong>{selectedOrganisation.mainContactPhone || 'Not supplied'}</strong></div>
                    <div><span>Main contact email</span><strong>{selectedOrganisation.mainContactEmail || 'Not supplied'}</strong></div>
                    <div><span>Registered office address</span><strong><MapPin size={13} /> {selectedOrganisation.address}</strong></div>
                    <div><span>Approved domains</span><strong><Globe2 size={13} /> {selectedOrganisation.websiteDomains.join(', ') || 'Not supplied'}</strong></div>
                    <div><span>Monthly HHH platform fee</span><strong>{selectedOrganisation.platformFeeMonthly == null ? 'Not set' : `£${selectedOrganisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
                  </div>
                </section>

                <section className="card admin-detail-card tenant-brand-editor">
                  <div className="admin-detail-card-title"><Settings2 size={18} /><h2>Brand Customisation</h2></div>
                  <label>Pharmacy name<input className="input" value={selectedOrganisation.name} readOnly /></label>
                  <div className="brand-editor-row">
                    <label>Primary colour<span><input type="color" value={selectedOrganisation.brand.primary} disabled /><code>{selectedOrganisation.brand.primary}</code></span></label>
                    <label>Automatic secondary<span className="derived-colour"><i style={{ background: tenantTheme.secondary }} /><code>{tenantTheme.secondary}</code><small>Derived from primary</small></span></label>
                  </div>
                  <div className="generated-palette" aria-label="Automatically generated pharmacy palette"><span style={{ background: tenantTheme.primary }} title="Primary" /><span style={{ background: tenantTheme.secondary }} title="Secondary" /><span style={{ background: tenantTheme.primaryMuted }} title="Muted brand" /><span style={{ background: tenantTheme.primarySoft }} title="Soft surface" /><span style={{ background: tenantTheme.sidebar }} title="Navigation" /></div>
                  <p className="theme-help">Secondary, soft surfaces, navigation and readable text colours update automatically. Success, warning and error colours remain consistent across every pharmacy.</p>
                  <div className="tenant-brand-preview" style={{ borderTopColor: tenantTheme.primary, background: tenantTheme.surfaceTint }}><div className="tenant-mark" style={brandSwatchStyle(selectedOrganisation.brand.primary)}>{selectedOrganisation.logoText}</div><span><strong>{selectedOrganisation.brand.portalName}</strong><small>Patient and pharmacy workspace preview</small></span><button style={{ background: tenantTheme.primary, color: tenantTheme.onPrimary }}>Primary action</button><button className="preview-secondary" style={{ background: tenantTheme.secondary, color: tenantTheme.onSecondary }}>Secondary</button></div>
                </section>
              </div>

              <div className="admin-detail-grid admin-config-grid">
                <section className="card admin-detail-card">
                  <div className="admin-detail-card-title"><Settings2 size={18} /><h2>Pharmacy modules</h2></div>
                  <p className="admin-card-intro">Enable only the capabilities included in this pharmacy’s service.</p>
                  <div className="admin-module-list">
                    {(Object.keys(MODULE_LABELS) as TenantModule[]).map(module => <label key={module}><span><strong>{MODULE_LABELS[module]}</strong><small>{selectedOrganisation.modules[module] ? 'Available to pharmacy staff' : 'Hidden from navigation'}</small></span><input type="checkbox" checked={selectedOrganisation.modules[module]} disabled /></label>)}
                  </div>
                </section>

                <section className="card admin-detail-card admin-detail-assets">
                  <div className="admin-detail-card-title"><Link2 size={18} /><h2>Eligibility form and content assets</h2></div>
                  <p>Every submission through this hosted URL is permanently attributed to this pharmacy token.</p>
                  <div className="resource-url">{formUrl}</div>
                  <div className="flex gap-sm flex-wrap"><button className="btn btn-primary btn-sm" onClick={async () => { await navigator.clipboard.writeText(formUrl); dispatch({ type: 'ADD_TOAST', message: 'Eligibility link copied.', toastType: 'success' }); }}><Copy size={13} /> Copy link</button><a className="btn btn-sm" href={formUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Preview form</a><button className="btn btn-sm" onClick={() => void downloadContentPack(selectedOrganisation)}><FileArchive size={13} /> Content pack</button></div>
                </section>
              </div>
            </>
          )}

          {pharmacyDetailTab === 'patients' && (
            <>
              {!setupStatus?.completed && <section className="card admin-patient-table admin-client-compliance">
                <div className="admin-directory-head"><div><p className="section-label">Go-live checklist</p><h2>Pharmacy setup</h2><p>The pharmacy completes its operational steps in Settings; HHH completes Curaleaf activation.</p></div></div>
                {setupError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {setupError}</div>}
                <div className="compliance-table table-wrap"><table><thead><tr><th>Setup step</th><th>Owner</th><th>Evidence</th><th>Status</th></tr></thead><tbody>{SETUP_TASKS.map(definition => { const task = setupStatus?.tasks.find(item => item.id === definition.id); return <tr key={definition.id}><td><strong>{definition.title}</strong><small>{definition.description}</small></td><td><span className={`setup-owner-tag${definition.owner === 'hhh_admin' ? ' setup-owner-tag--admin' : ''}`}>{definition.owner === 'hhh_admin' ? 'HHH admin' : 'Pharmacy'}</span></td><td>{task?.evidence || 'Not supplied yet'}</td><td><span className={`pill ${task?.completed ? 'pill-green' : 'pill-amber'}`}>{task?.completed ? 'Complete' : 'Waiting'}</span></td></tr>; })}</tbody></table></div>
              </section>}

              <section className="card admin-patient-table admin-attributed-patients">
                <div className="admin-directory-head"><div><h2>Patients attributed to this pharmacy</h2><p>Attribution is derived from the pharmacy token and retained on the patient record.</p></div></div>
                {submissions.length === 0 ? <div className="empty-state">No attributed eligibility submissions yet.</div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Submitted</th><th>Conditions</th><th>Source</th><th>Status</th></tr></thead><tbody>{submissions.map(sub => <tr key={sub.id}><td><CompactPatientCell name={sub.name} email={sub.email} dob={sub.dob} /></td><td>{new Date(sub.submittedAt).toLocaleDateString('en-GB')}</td><td><ConditionList conditions={sub.conditions} primaryCondition={sub.primaryCondition} /></td><td>{sub.source}</td><td><span className={`pill onboarding-status-pill ${onboardingStatusPillClass(sub.status)}`}>{onboardingStatusLabel(sub.status)}</span></td></tr>)}</tbody></table></div>}
              </section>
            </>
          )}

          {showPharmacyEditor && <EditPharmacy key={selectedOrganisation.id} organisation={selectedOrganisation} onClose={() => setShowPharmacyEditor(false)} onSaved={updates => {
            dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisation.id, updates });
            dispatch({ type: 'ADD_TOAST', message: `${updates.tradingName ?? selectedOrganisation.tradingName} details saved to Firebase.`, toastType: 'success' });
          }} />}
          </div>
        </div>
        <CommandPalette commands={adminCommands} contextLabel="HHH administration" placeholder="Find a pharmacy, patient or platform action…" />
      </div>
    );
  }

  const renderOverview = () => (
    <>
      <div className="admin-page-actions">
        <button className="btn btn-primary" onClick={() => setShowOnboarding(true)}><Plus size={15} /> Onboard pharmacy</button>
      </div>
      <SummaryTiles className="admin-overview-summary" label="Portfolio summary" items={[
        { label: 'Portfolio', value: state.organisations.length, detail: 'pharmacies' },
        { label: 'Operating', value: liveCount, detail: 'live pharmacies' },
        { label: 'Patient reach', value: allPatients.length, detail: 'attributed records' },
        { label: 'Readiness', value: remainingSetupSteps, detail: 'steps outstanding' },
      ]} />

      {remainingSetupSteps > 0 && <section className="card admin-attention-strip">
        <div><AlertCircle size={18} /><span><strong>Some pharmacy setup is still incomplete</strong><small>{remainingSetupSteps} step{remainingSetupSteps === 1 ? '' : 's'} remain across the current pharmacies.</small></span></div>
        <button className="btn btn-sm" onClick={() => { setView('platform'); setPlatformTab('setup'); }}>Open platform</button>
      </section>}

      <section className="card admin-directory">
        <div className="admin-directory-head">
          <div>
            <p className="section-label">Directory</p>
            <h2>Pharmacy directory</h2>
            <p>Account records, legal companies, workspace configuration and patient attribution.</p>
          </div>
          <div className="directory-view-toggle" role="group" aria-label="Directory layout">
            <button type="button" className={`filter-card${directoryMode === 'flat' ? ' active' : ''}`} onClick={() => setDirectoryMode('flat')}>
              <div className="filter-card__head"><span>Flat</span></div>
              <span className="filter-card__value">{filteredOrganisations.length}</span>
            </button>
            <button type="button" className={`filter-card${directoryMode === 'by-company' ? ' active' : ''}`} onClick={() => setDirectoryMode('by-company')}>
              <div className="filter-card__head"><span>By company</span></div>
              <span className="filter-card__value">{filteredOrganisations.length}</span>
            </button>
          </div>
          <label className="search-box admin-search">
            <Search size={15} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or GPhC number" />
          </label>
        </div>

        <div className="admin-org-list">
          {filteredOrganisations.length === 0 && (
            <div className="empty-state">
              {state.organisations.length === 0 ? 'No pharmacies have been onboarded yet.' : 'No pharmacies match this search.'}
            </div>
          )}

          {directoryMode === 'flat' ? (
            filteredOrganisations.map(org => {
              const submissions = submissionsByOrganisation.get(org.id) ?? [];
              const patients = crmByOrganisation.get(org.id) ?? [];
              const readiness = tenantReadiness(org.id);
              return (
                <article className="admin-org-row" key={org.id}>
                  <div className="admin-org-brand">
                    <div className="tenant-mark" style={brandSwatchStyle(org.brand.primary)}>{org.logoText}</div>
                    <div>
                      <strong>{org.name}</strong>
                      <span>GPhC {org.gphcNumber} · {org.websiteDomains.join(', ') || 'domain pending'}</span>
                    </div>
                  </div>
                  <div className="admin-org-metric">
                    <strong>{new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size}</strong>
                    <span>Patients</span>
                  </div>
                  <div className="readiness-cell">
                    <div><strong>{readiness.percent}%</strong><span>{readiness.ready}/{readiness.total} gates</span></div>
                    <div className="mini-progress"><span style={{ width: `${readiness.percent}%` }} /></div>
                  </div>
                  <div className="admin-org-actions">
                    <span className={`pill ${org.status === 'live' ? 'pill-green' : org.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{org.status}</span>
                    <button className="btn btn-sm" onClick={() => setSelectedOrganisationId(org.id)}>Manage pharmacy</button>
                  </div>
                </article>
              );
            })
          ) : (
            // By Company View Grouping
            <div className="company-directory-groups">
              {filteredOrganisations.map(org => {
                const submissions = submissionsByOrganisation.get(org.id) ?? [];
                const patients = crmByOrganisation.get(org.id) ?? [];
                const readiness = tenantReadiness(org.id);
                // Rollups: earning patients = unique patients with >=1 referral-fee event
                const earningPatientsCount = new Set([...patients.map(p => p.email)]).size;
                const accruedCommission = earningPatientsCount * 50;

                return (
                  <div className="company-group-card card" key={org.id}>
                    <header className="company-group-card__header">
                      <div>
                        <span className="pill pill-info">Legal company</span>
                        <h3>{org.tradingName || org.name}</h3>
                        <small>Company Reg: {org.companyNumber || 'N/A'} · Superintendent: {org.superintendent}</small>
                      </div>
                      <div className="company-group-card__meta">
                        <span className="pill pill-green">GDPR confirmed</span>
                        <div>
                          <strong>{earningPatientsCount}</strong> earning patients · <strong>£{accruedCommission}</strong> accrued
                        </div>
                      </div>
                    </header>
                    <article className="admin-org-row admin-org-row--nested">
                      <div className="admin-org-brand">
                        <div className="tenant-mark" style={brandSwatchStyle(org.brand.primary)}>{org.logoText}</div>
                        <div>
                          <strong>{org.name} (Branch)</strong>
                          <span>GPhC {org.gphcNumber} · {org.address}</span>
                        </div>
                      </div>
                      <div className="admin-org-metric">
                        <strong>{new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size}</strong>
                        <span>Attributed patients</span>
                      </div>
                      <div className="readiness-cell">
                        <div><strong>{readiness.percent}%</strong><span>{readiness.ready}/{readiness.total} gates</span></div>
                        <div className="mini-progress"><span style={{ width: `${readiness.percent}%` }} /></div>
                      </div>
                      <div className="admin-org-actions">
                        <span className={`pill ${org.status === 'live' ? 'pill-green' : org.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{org.status}</span>
                        <button className="btn btn-sm" onClick={() => setSelectedOrganisationId(org.id)}>Manage branch</button>
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );


  const renderReferrals = () => {
    const pending = state.submissions.filter(submission => submission.status === 'New' || submission.status === 'Under HHH review');
    const reviewed = state.submissions.filter(submission => submission.status === 'Approved' || submission.status === 'Declined');
    const referralCard = (submission: typeof state.submissions[number], section: 'queue' | 'history') => {
      const organisation = state.organisations.find(org => org.id === submission.organisationId);
      const recordsComplete = submission.recordsCheck?.status === 'completed' || submission.calls.length > 0;
      const referralComplete = submission.referral?.status === 'completed' || submission.status === 'Approved';
      const emailStatus = submission.emailDelivery?.status ?? 'not_sent';
      const openAction = (action: 'records' | 'complete' | 'decline' | 'email') => {
        setReferralNotes(action === 'records' ? submission.recordsCheck?.notes ?? '' : action === 'complete' || action === 'decline' ? submission.decisionNote ?? '' : '');
        setReferralError(null);
        setReferralDialog({ id: submission.id, organisationId: submission.organisationId, patientName: submission.name, action });
      };
      return (
        <article className={`admin-referral-item admin-referral-item--${section}`} key={submission.id}>
          <div className="admin-referral-item__identity">
            <CompactPatientCell name={submission.name} email={submission.email} mobile={submission.mobile} dob={submission.dob} />
            <div className="admin-referral-item__pharmacy">
              <span className="admin-referral-item__label">Attributed pharmacy</span>
              <strong>{organisation?.tradingName ?? submission.pharmacyName}</strong>
              <small>Token-attributed record</small>
            </div>
          </div>

          <div className="admin-referral-item__screening">
            <span className="admin-referral-item__label">Screening summary</span>
            <ConditionList conditions={submission.conditions} primaryCondition={submission.primaryCondition} />
            <small>{submission.tried2 ? 'Two treatments reported' : 'Treatment history requires review'} · {submission.psychExclusion ? 'Exclusion flagged' : 'No psychosis exclusion reported'}</small>
          </div>

          <div className="admin-referral-item__workflow">
            <div>
              <span className="admin-referral-item__label">Call / check</span>
              <strong>{recordsComplete ? 'Completed' : 'Pending'}</strong>
              <small>{submission.recordsCheck?.completedAt ? new Date(submission.recordsCheck.completedAt).toLocaleDateString('en-GB') : recordsComplete ? 'Recorded in the audit trail' : 'Patient call and records check required'}</small>
            </div>
            <div>
              <span className="admin-referral-item__label">Referral</span>
              <div className="onboarding-status-stack"><span className={`pill onboarding-status-pill ${onboardingStatusPillClass(submission.status)}`}>{onboardingStatusLabel(submission.status)}</span>{submission.reviewedBy && <small>{submission.reviewedBy} · {submission.reviewedAt ? new Date(submission.reviewedAt).toLocaleDateString('en-GB') : ''}</small>}</div>
            </div>
          </div>

          <div className="admin-referral-actions" aria-label={`Actions for ${submission.name}`}>
            {!recordsComplete && <button className="btn btn-sm" onClick={() => openAction('records')}><PhoneCall size={13} /> Log call / records check</button>}
            {!referralComplete && submission.status !== 'Declined' && <button className="btn btn-sm btn-primary" disabled={!recordsComplete} onClick={() => openAction('complete')}><UserCheck size={13} /> Complete referral</button>}
            {!referralComplete && submission.status !== 'Declined' && <button className="btn btn-sm" disabled={!recordsComplete} onClick={() => openAction('decline')}><UserX size={13} /> Decline</button>}
            {referralComplete && emailStatus === 'not_sent' && <button className="btn btn-sm btn-primary" onClick={() => openAction('email')}><ExternalLink size={13} /> Send email</button>}
            {referralComplete && emailStatus !== 'not_sent' && <span className={`pill ${emailStatus === 'failed' ? 'pill-red' : 'pill-green'}`}>Email {emailStatus.replace('_', ' ')}</span>}
          </div>
        </article>
      );
    };
    return (
      <>
        <section className="integration-boundary card"><ShieldCheck size={20} /><div><strong>Approval boundary</strong><p>HHH approval authorises programme onboarding only. It does not diagnose, prescribe, replace a doctor’s prescription, or replace the pharmacy’s legal and professional checks before dispensing.</p></div></section>
        <section className="card admin-referral-section">
          <div className="admin-directory-head"><div><p className="section-label">Action queue</p><h2>Awaiting HHH review</h2><p>The patient call and records outcome must be recorded before referral completion.</p></div><span className="pill pill-amber">{pending.length} waiting</span></div>
          {pending.length ? <div className="admin-referral-list">{pending.map(submission => referralCard(submission, 'queue'))}</div> : <div className="empty-state">No onboarding decisions are waiting.</div>}
        </section>
        <section className="card admin-referral-section admin-referral-section--history">
          <div className="admin-directory-head"><div><p className="section-label">Audit trail</p><h2>Decision history</h2><p>Approved patients become available only inside their attributed pharmacy workspace.</p></div><span className="pill pill-neutral">{reviewed.length} recorded</span></div>
          {reviewed.length ? <div className="admin-referral-list">{reviewed.map(submission => referralCard(submission, 'history'))}</div> : <div className="empty-state">No decisions have been recorded.</div>}
        </section>
      </>
    );
  };

  const renderPatients = () => (
    <>
      <div className="admin-page-actions">
        <span className="pill pill-info"><Users size={13} /> {displayedPatients.length}{isLocalPortalPreview ? ` of ${allPatients.length}` : ''} records</span>
        <button className="btn btn-sm" type="button" onClick={() => void exportPatients()} disabled={patientExportBusy || patientRegisterLoading || (!isLocalPortalPreview && !serverPatientRegister)}><Download size={14} /> {patientExportBusy ? 'Preparing CSV…' : patientRegisterLoading ? 'Loading scope…' : 'Export filtered CSV'}</button>
      </div>
      <section className="card admin-patient-table admin-master-patients">
        <div className="admin-directory-head"><div><p className="section-label">Register</p><h2>Patient register</h2></div><label className="search-box admin-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search patient, DOB or pharmacy" /></label></div>
        <div className="admin-patient-filters filter-toolbar" aria-label="Patient register filters">
          <label>Pharmacy<select className="input" value={patientOrganisationId} onChange={event => setPatientOrganisationId(event.target.value)}><option value="all">All pharmacies</option>{state.organisations.map(organisation => <option key={organisation.id} value={organisation.id}>{organisation.tradingName}</option>)}</select></label>
          <label>Eligibility status<select className="input" value={patientStatus} onChange={event => setPatientStatus(event.target.value)}><option value="all">All statuses</option>{patientStatuses.map(status => <option key={status} value={status}>{onboardingStatusLabel(status)}</option>)}</select></label>
          <label>From date<input className="input" type="date" value={patientFrom} max={patientTo || undefined} onChange={event => setPatientFrom(event.target.value)} /></label>
          <label>To date<input className="input" type="date" value={patientTo} min={patientFrom || undefined} onChange={event => setPatientTo(event.target.value)} /></label>
          <button className="btn btn-sm" type="button" onClick={() => { setQuery(''); setPatientOrganisationId('all'); setPatientStatus('all'); setPatientFrom(''); setPatientTo(''); }}>Clear filters</button>
        </div>
        {patientExportError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {patientExportError}</div>}
        {patientRegisterLoading && !isLocalPortalPreview ? <div className="empty-state">Loading the protected patient register…</div> : displayedPatients.length === 0 ? <div className="empty-state">No patient records match the current search and filters.</div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Attributed pharmacy</th><th>Current stage</th><th>Last recorded</th></tr></thead><tbody>{displayedPatients.map(patient => { const org = state.organisations.find(item => item.id === patient.organisationId); const pharmacyName = 'pharmacyName' in patient ? patient.pharmacyName : org?.tradingName; const gphcNumber = 'gphcNumber' in patient ? patient.gphcNumber : org?.gphcNumber; return <tr key={`${patient.organisationId}-${patient.email}`}><td><CompactPatientCell name={patient.name} email={patient.email} mobile={patient.mobile} dob={patient.dob} /></td><td><button className="table-link" onClick={() => setSelectedOrganisationId(patient.organisationId)}>{pharmacyName ?? 'Unknown pharmacy'}</button><small>{gphcNumber}</small></td><td><span className={`pill onboarding-status-pill ${onboardingStatusPillClass(patient.stage)}`}>{onboardingStatusLabel(patient.stage)}</span></td><td>{patient.date ? new Date(patient.date).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '—'}</td></tr>; })}</tbody></table></div>}
      </section>
    </>
  );

  const renderFinance = () => {
    const newReferralEvents = filteredReferralFeeEvents.filter(event => event.kind === 'new-referral');
    const annualEvents = filteredReferralFeeEvents.filter(event => event.kind === 'annual-patient');
    const totalAccrued = filteredReferralFeeEvents.reduce((total, event) => total + event.amount, 0);
    const patientsWithFees = new Set(filteredReferralFeeEvents.map(event => event.patientKey)).size;
    const pharmacyPositions = state.organisations
      .map(organisation => {
        const events = filteredReferralFeeEvents.filter(event => event.organisationId === organisation.id);
        return {
          organisation,
          newReferrals: events.filter(event => event.kind === 'new-referral').length,
          annualFees: events.filter(event => event.kind === 'annual-patient').length,
          newReferralAmount: events.filter(event => event.kind === 'new-referral').reduce((sum, event) => sum + event.amount, 0),
          annualFeeAmount: events.filter(event => event.kind === 'annual-patient').reduce((sum, event) => sum + event.amount, 0),
          patients: new Set(events.map(event => event.patientKey)).size,
          total: events.reduce((sum, event) => sum + event.amount, 0),
        };
      })
      .filter(position => financeOrganisationId === 'all' ? position.total > 0 : position.organisation.id === financeOrganisationId);

    return (
      <>
        <div className="admin-page-actions">
          <span className="pill pill-info"><PoundSterling size={13} /> £50 + £40 model</span>
          <button type="button" className="btn btn-sm" onClick={() => setAdminFinanceRefresh(value => value + 1)} disabled={adminFinanceLoading}><RefreshCw size={13} className={adminFinanceLoading ? 'spin' : ''} /> Refresh</button>
        </div>

        <div className="filter-grid admin-finance-period-grid admin-segment-tabs" role="group" aria-label="Finance period">
          {([
            { id: 'all' as const, label: 'All time', value: String(filteredReferralFeeEvents.length) },
            { id: 'month' as const, label: 'Month', value: financeMonth || '—' },
            { id: 'year' as const, label: 'Year', value: financeYear || '—' },
          ]).map(period => (
            <button
              key={period.id}
              type="button"
              className={`filter-card${financePeriod === period.id ? ' active' : ''}`}
              aria-pressed={financePeriod === period.id}
              onClick={() => setFinancePeriod(period.id)}
            >
              <div className="filter-card__head"><span>{period.label}</span></div>
              <span className="filter-card__value">{period.value}</span>
            </button>
          ))}
        </div>

        <section className="card admin-finance-filters filter-toolbar" aria-label="Referral finance filters">
          <div className="admin-finance-filter">
            <label htmlFor="finance-pharmacy">Pharmacy</label>
            <select id="finance-pharmacy" className="input" value={financeOrganisationId} onChange={event => setFinanceOrganisationId(event.target.value)}>
              <option value="all">All pharmacies</option>
              {state.organisations.map(organisation => <option value={organisation.id} key={organisation.id}>{organisation.tradingName}</option>)}
            </select>
          </div>
          <div className="admin-finance-filter">
            <label htmlFor="finance-patient">Patient</label>
            <select id="finance-patient" className="input" value={financePatientKey} onChange={event => setFinancePatientKey(event.target.value)}>
              <option value="all">All patients</option>
              {financePatients.map(patient => <option value={patient.key} key={patient.key}>{patient.name} · {patient.email}</option>)}
            </select>
          </div>
          {financePeriod === 'month' && <div className="admin-finance-filter">
            <label htmlFor="finance-month">Month</label>
            <input id="finance-month" className="input" type="month" value={financeMonth} onChange={event => setFinanceMonth(event.target.value)} />
          </div>}
          {financePeriod === 'year' && <div className="admin-finance-filter">
            <label htmlFor="finance-year">Year</label>
            <input id="finance-year" className="input" type="number" min="2000" max="2200" step="1" value={financeYear} onChange={event => setFinanceYear(event.target.value)} />
          </div>}
        </section>

        {adminFinanceError && <div className="banner banner-amber" role="alert"><AlertCircle size={16} /><span><strong>Referral finance is temporarily unavailable</strong><small>{adminFinanceError}</small></span><button className="btn btn-sm" type="button" onClick={() => setAdminFinanceRefresh(value => value + 1)}>Try again</button></div>}
        {adminFinanceLoading && !adminFinanceReport && !isLocalPortalPreview && <div className="empty-state admin-finance-loading">Loading the referral fee ledger…</div>}

        <SummaryTiles className="admin-finance-summary" label="Referral finance summary" items={[
          { label: 'Total accrued', value: referralFeeFormatter.format(totalAccrued), detail: `${filteredReferralFeeEvents.length} fee event${filteredReferralFeeEvents.length === 1 ? '' : 's'}` },
          { label: 'New referrals', value: referralFeeFormatter.format(newReferralEvents.reduce((sum, event) => sum + event.amount, 0)), detail: `${newReferralEvents.length} × £50` },
          { label: 'Annual fees', value: referralFeeFormatter.format(annualEvents.reduce((sum, event) => sum + event.amount, 0)), detail: `${annualEvents.length} × £40` },
          { label: 'Patients', value: patientsWithFees, detail: 'with accrued fees' },
        ]} />

        <section className="card admin-patient-table admin-finance-position">
          <div className="admin-directory-head"><div><h2>Pharmacy fee position</h2><p>Referral fees attributed to each pharmacy for the selected reporting period.</p></div><TrendingUp size={20} /></div>
          {pharmacyPositions.length === 0 ? <div className="empty-state">No referral fees match the selected filters.</div> : <div className="table-wrap"><table><thead><tr><th>Pharmacy</th><th>Patients</th><th>New referrals</th><th>Annual fees</th><th>Total accrued</th></tr></thead><tbody>{pharmacyPositions.map(position => <tr key={position.organisation.id}><td><button className="table-link" onClick={() => setFinanceOrganisationId(position.organisation.id)}>{position.organisation.tradingName}</button><small>GPhC {position.organisation.gphcNumber}</small></td><td>{position.patients}</td><td><strong>{referralFeeFormatter.format(position.newReferralAmount)}</strong><small>{position.newReferrals} × £50</small></td><td><strong>{referralFeeFormatter.format(position.annualFeeAmount)}</strong><small>{position.annualFees} × £40</small></td><td><strong>{referralFeeFormatter.format(position.total)}</strong></td></tr>)}</tbody></table></div>}
        </section>

        <section className="card admin-patient-table admin-finance-ledger">
          <div className="admin-directory-head"><div><h2>Fee event register</h2><p>Patient-level accrual history. This is an operational ledger, not an invoice or payment-receipt register.</p></div></div>
          {filteredReferralFeeEvents.length === 0 ? <div className="empty-state">No fee events match the selected filters.</div> : <div className="table-wrap"><table><thead><tr><th>Accrued</th><th>Patient</th><th>Pharmacy</th><th>Fee event</th><th>Amount</th></tr></thead><tbody>{filteredReferralFeeEvents.map(event => <tr key={event.id}><td><strong>{event.occurredAt.toLocaleDateString('en-GB')}</strong><small>{event.occurredAt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</small></td><td><CompactPatientCell name={event.patientName} email={event.patientEmail} /></td><td>{event.pharmacyName}</td><td><span className={`pill ${event.kind === 'new-referral' ? 'pill-green' : 'pill-info'}`}>{event.kind === 'new-referral' ? 'Completed referral' : event.anniversary ? `Annual fee · year ${event.anniversary}` : 'Annual patient fee'}</span></td><td><strong>{referralFeeFormatter.format(event.amount)}</strong></td></tr>)}</tbody></table></div>}
        </section>
      </>
    );
  };

  const openCuraleafDrawer = (organisationId: string) => {
    setCuraleafOrganisationId(organisationId);
    setCuraleafCustomerId('');
    setCuraleafWriteApiKey('');
    setCuraleafReadApiKey('');
    setCuraleafResult(null);
    setCuraleafError(null);
    setShowCuraleafDrawer(true);
  };

  const closeCuraleafDrawer = () => {
    if (curaleafBusy || curaleafApproveBusy) return;
    setShowCuraleafDrawer(false);
    setCuraleafError(null);
  };

  const curaleafValidation: CuraleafValidationReport | undefined = curaleafResult?.validation;
  const curaleafApproved = Boolean(
    curaleafResult?.approved
    || setupByOrganisation[curaleafOrganisationId]?.tasks.find(task => task.id === 'curaleaf_account')?.completed,
  );

  const submitCuraleafTestAndSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCuraleafBusy(true);
    setCuraleafError(null);
    try {
      const status = await activateCuraleafPharmacy({
        organisationId: curaleafOrganisationId,
        customerId: curaleafCustomerId.trim(),
        writeApiKey: curaleafWriteApiKey.trim(),
        ...(curaleafReadApiKey.trim() ? { readApiKey: curaleafReadApiKey.trim() } : {}),
      });
      setCuraleafResult(status);
      const pharmacy = state.organisations.find(org => org.id === curaleafOrganisationId);
      const updatedSetup = await getPharmacySetupStatus(curaleafOrganisationId);
      setSetupByOrganisation(current => ({ ...current, [curaleafOrganisationId]: updatedSetup }));
      dispatch({
        type: 'ADD_TOAST',
        message: status.validation?.passed
          ? `${pharmacy?.tradingName ?? 'Pharmacy'} credentials validated. Approve Curaleaf to complete this setup step.`
          : `${pharmacy?.tradingName ?? 'Pharmacy'} credentials saved, but validation did not pass.`,
        toastType: status.validation?.passed ? 'success' : 'error',
      });
      setCuraleafWriteApiKey('');
      setCuraleafReadApiKey('');
    } catch (error) {
      setCuraleafError(error instanceof Error ? error.message : 'Curaleaf test & save failed.');
    } finally {
      setCuraleafBusy(false);
    }
  };

  const curaleafPharmacy = state.organisations.find(org => org.id === curaleafOrganisationId);

  const submitCuraleafApproval = async () => {
    if (!curaleafOrganisationId) return;
    setCuraleafApproveBusy(true);
    setCuraleafError(null);
    try {
      const status = await approveCuraleafPharmacy(curaleafOrganisationId);
      setCuraleafResult(status);
      const pharmacy = state.organisations.find(org => org.id === curaleafOrganisationId);
      const updatedSetup = status.setup ?? await getPharmacySetupStatus(curaleafOrganisationId);
      setSetupByOrganisation(current => ({ ...current, [curaleafOrganisationId]: updatedSetup }));
      if (updatedSetup.completed) {
        dispatch({ type: 'UPDATE_ORGANISATION', organisationId: curaleafOrganisationId, updates: { status: 'live' } });
      }
      dispatch({
        type: 'ADD_TOAST',
        message: updatedSetup.completed
          ? `${pharmacy?.tradingName ?? 'Pharmacy'} Curaleaf approved — all setup complete; pharmacy is live.`
          : `${pharmacy?.tradingName ?? 'Pharmacy'} Curaleaf approved. Remaining setup steps still required before live.`,
        toastType: 'success',
      });
      setShowCuraleafDrawer(false);
    } catch (error) {
      setCuraleafError(error instanceof Error ? error.message : 'Curaleaf approval failed.');
    } finally {
      setCuraleafApproveBusy(false);
    }
  };

  const curaleafStatusLabel = (organisationId: string) => {
    const approved = Boolean(setupByOrganisation[organisationId]?.tasks.find(task => task.id === 'curaleaf_account')?.completed);
    if (approved) return { label: 'Approved', pill: 'pill-green' as const };
    if (curaleafOrganisationId === organisationId && curaleafValidation?.passed) {
      return { label: 'Validated — pending approval', pill: 'pill-amber' as const };
    }
    if (curaleafOrganisationId === organisationId && curaleafResult?.status === 'attention') {
      return { label: 'Attention', pill: 'pill-neutral' as const };
    }
    return { label: 'Pending', pill: 'pill-amber' as const };
  };

  const renderPlatform = () => (
    <>
      <div className="filter-grid directory-view-toggle admin-platform-tabs admin-segment-tabs" role="tablist" aria-label="Platform sections">
        <button type="button" role="tab" aria-selected={platformTab === 'setup'} className={`filter-card${platformTab === 'setup' ? ' active' : ''}`} onClick={() => setPlatformTab('setup')}>
          <div className="filter-card__head"><span>Setup</span></div>
          <span className="filter-card__value">{remainingSetupSteps}</span>
        </button>
        <button type="button" role="tab" aria-selected={platformTab === 'curaleaf'} className={`filter-card${platformTab === 'curaleaf' ? ' active' : ''}`} onClick={() => setPlatformTab('curaleaf')}>
          <div className="filter-card__head"><span>Curaleaf</span></div>
          <span className="filter-card__value filter-card__value--text">Validate & approve</span>
        </button>
      </div>

      {platformTab === 'setup' && (
        <>
          <SummaryTiles className="admin-platform-summary" label="Readiness summary" items={[
            { label: 'Pharmacies', value: state.organisations.length, detail: 'pharmacy accounts' },
            { label: 'Fully ready', value: Object.values(setupByOrganisation).filter(status => status.completed).length, detail: 'all steps complete' },
            { label: 'Completed', value: Object.values(setupByOrganisation).reduce((total, status) => total + status.completedCount, 0), detail: 'steps recorded' },
            { label: 'Waiting', value: remainingSetupSteps, detail: 'actions remaining' },
          ]} />
          <section className="card admin-external-gates" aria-label="External Curaleaf gates">
            <div className="admin-directory-head">
              <div>
                <p className="section-label">External gates</p>
                <h2>Curaleaf production blockers</h2>
                <p>Phil answered Q1–Q13 on 5 August 2026. These remaining items still block full Rocky production order flow.</p>
              </div>
            </div>
            <div className="filter-grid admin-gate-grid">
              {[
                { label: 'Sandbox stocked products', detail: 'Quote / PO / shipment UAT', status: 'pending' as const },
                { label: 'Second sandbox pharmacy key', detail: 'Multi-tenant isolation UAT', status: 'pending' as const },
                { label: 'Ellis catalogue confirmation', detail: 'Customer-specific pricing N/A?', status: 'pending' as const },
                { label: 'Direct-to-live written OK', detail: 'Onboarding runbook gate', status: 'pending' as const },
                { label: 'Curaleaf DPA / scan retention', detail: 'Legal production gate', status: 'pending' as const },
                { label: 'Partner master API key', detail: 'Not offered yet — per-pharmacy keys', status: 'blocked' as const },
              ].map(gate => (
                <div key={gate.label} className={`filter-card admin-gate-card${gate.status === 'blocked' ? ' is-blocked' : ''}`} aria-pressed={false}>
                  <div className="filter-card__head">
                    <span>{gate.label}</span>
                    <span className={`pill ${gate.status === 'blocked' ? 'pill-neutral' : 'pill-amber'}`}>{gate.status === 'blocked' ? 'Unavailable' : 'Pending'}</span>
                  </div>
                  <span className="filter-card__value text-xs">{gate.detail}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card admin-patient-table compliance-register">
            <div className="admin-directory-head"><div><h2>Pharmacy setup progress</h2><p>Open a pharmacy to see its evidence. Pharmacy staff update their own steps; Curaleaf validate & approve remains HHH-admin only. Completing the last required step promotes the pharmacy to live.</p></div></div>
            {setupError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {setupError}</div>}
            {state.organisations.length === 0 ? <div className="empty-state">No pharmacies have been onboarded yet.</div> : <div className="table-wrap"><table><thead><tr><th>Pharmacy</th><th>Setup progress</th><th>Next action</th><th>Status</th><th /></tr></thead><tbody>{state.organisations.map(organisation => { const status = setupByOrganisation[organisation.id]; const readiness = tenantReadiness(organisation.id); const nextTask = SETUP_TASKS.find(definition => !status?.tasks.find(task => task.id === definition.id)?.completed); return <tr key={organisation.id}><td><strong>{organisation.tradingName}</strong><small>GPhC {organisation.gphcNumber}</small></td><td><strong>{readiness.ready} of {readiness.total} complete</strong><small>{readiness.percent}% ready</small></td><td><strong>{nextTask?.title ?? 'No action required'}</strong>{nextTask?.owner === 'hhh_admin' ? <span className="setup-owner-tag setup-owner-tag--admin">HHH admin</span> : <small>{nextTask ? 'Pharmacy team' : 'Setup complete'}</small>}</td><td><span className={`pill ${status?.completed ? 'pill-green' : 'pill-amber'}`}>{status?.completed ? 'Ready' : 'In setup'}</span></td><td><button className="btn btn-sm" onClick={() => setSelectedOrganisationId(organisation.id)}>Review</button></td></tr>; })}</tbody></table></div>}
          </section>
        </>
      )}

      {platformTab === 'curaleaf' && (
        <>
          <section className="integration-boundary card">
            <ShieldCheck size={20} />
            <div>
              <strong>Curaleaf validate, then approve</strong>
              <p>Test & save runs API and PHAR-match checks. Approve Curaleaf completes that setup step only — the pharmacy goes live automatically when all six steps are done. Worldpay and payment routes stay in the pharmacy portal.</p>
            </div>
          </section>

          <section className="card admin-patient-table admin-curaleaf-status" aria-label="Curaleaf connection status">
            <div className="admin-directory-head">
              <div>
                <p className="section-label">Per pharmacy</p>
                <h2>Curaleaf connection status</h2>
                <p>Approval completes the Curaleaf setup step. Live workspace unlocks when every required setup step is complete.</p>
              </div>
            </div>
            {state.organisations.length === 0 ? (
              <div className="empty-state">Onboard a pharmacy before connecting Curaleaf.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Pharmacy</th><th>Curaleaf</th><th /></tr></thead>
                  <tbody>
                    {state.organisations.map(organisation => {
                      const statusMeta = curaleafStatusLabel(organisation.id);
                      const approved = Boolean(setupByOrganisation[organisation.id]?.tasks.find(task => task.id === 'curaleaf_account')?.completed);
                      return (
                        <tr key={organisation.id}>
                          <td><strong>{organisation.tradingName}</strong><small>{organisation.name}</small></td>
                          <td><span className={`pill ${statusMeta.pill}`}>{statusMeta.label}</span></td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => openCuraleafDrawer(organisation.id)}
                            >
                              {approved ? 'Rotate keys' : 'Connect'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );

  const pageMeta: Record<AdminView, { title: string; subtitle: string }> = {
    overview: { title: 'Pharmacy administration', subtitle: 'Provision pharmacy workspaces, monitor attribution and control each pharmacy’s go-live gate.' },
    referrals: { title: 'Patient onboarding decisions', subtitle: 'Record patient calls and release approved patients to their attributed pharmacy.' },
    patients: { title: 'Patients and pharmacy attribution', subtitle: 'Review the cross-pharmacy patient index and its pharmacy ownership.' },
    finance: { title: 'HHH referral finance', subtitle: 'Track £50 completed-referral fees and recurring £40 annual patient fees.' },
    platform: { title: 'Platform', subtitle: 'Track pharmacy setup progress and validate each pharmacy’s Curaleaf connection.' },
  };

  return (
    <div className={`app-shell admin-shell unified-admin-shell admin-view-${view}`}>
      <a className="skip-link" href="#admin-main-content">Skip to main content</a>
      <AdminHeader view={view} pending={pendingAdminDecisions} readiness={remainingSetupSteps} setView={next => { setView(next); setQuery(''); }} />
      <div className="app-main">
        <WorkspacePageHeader section="HHH operations" context="Administration" title={pageMeta[view].title} subtitle={pageMeta[view].subtitle} contextControl={<div className="header-context"><span>Access</span><span className="tenant-status tenant-status--live">Admin</span></div>} />
        <div id="admin-main-content" className="page-container admin-content" tabIndex={-1}>
          {view === 'overview' && renderOverview()}
          {view === 'referrals' && renderReferrals()}
          {view === 'patients' && renderPatients()}
          {view === 'finance' && renderFinance()}
          {view === 'platform' && renderPlatform()}
        </div>
      </div>
      {showOnboarding && <OnboardPharmacy onClose={() => setShowOnboarding(false)} onCreated={id => { setShowOnboarding(false); setSelectedOrganisationId(id); }} />}
      {referralDialog && (
        <div className="drawer-backdrop admin-onboarding-backdrop" role="presentation">
          <aside className="drawer admin-referral-drawer" role="dialog" aria-modal="true" aria-labelledby="referral-action-title">
            <div className="drawer-header">
              <div><p className="section-label">Patient referral</p><h2 id="referral-action-title">{referralDialog.action === 'records' ? 'Log call and records check' : referralDialog.action === 'complete' ? 'Complete referral' : referralDialog.action === 'decline' ? 'Decline referral' : 'Send patient email'}</h2></div>
              <button className="icon-btn" disabled={referralBusy} onClick={() => setReferralDialog(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="drawer-body onboarding-form">
              <div className="integration-boundary"><ShieldCheck size={17} /><div><strong>{referralDialog.patientName}</strong><p>{referralDialog.action === 'records' ? 'Record the outcome only. Do not upload or paste Summary Care Records or supporting health documents.' : referralDialog.action === 'email' ? 'This queues the approved referral template as a separate, audited action.' : 'This decision is recorded in the audit trail and cannot be silently changed.'}</p></div></div>
              {referralDialog.action !== 'email' && <label>{referralDialog.action === 'records' ? 'Call / records-check notes' : 'Decision notes'}<textarea className="input" rows={6} value={referralNotes} onChange={event => setReferralNotes(event.target.value)} placeholder="Record the operational outcome without attaching health records." /></label>}
              {referralError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {referralError}</div>}
              <div className="drawer-actions"><button type="button" className="btn" disabled={referralBusy} onClick={() => setReferralDialog(null)}>Cancel</button><button type="button" className={`btn ${referralDialog.action === 'decline' ? 'btn-danger' : 'btn-primary'}`} disabled={referralBusy || (referralDialog.action === 'records' && !referralNotes.trim())} onClick={() => void runReferralAction()}>{referralBusy ? 'Saving…' : referralDialog.action === 'records' ? 'Save check' : referralDialog.action === 'complete' ? 'Complete referral' : referralDialog.action === 'decline' ? 'Record decline' : 'Queue patient email'}</button></div>
            </div>
          </aside>
        </div>
      )}
      {showCuraleafDrawer && (
        <div className="drawer-backdrop admin-onboarding-backdrop" role="presentation" onClick={closeCuraleafDrawer}>
          <aside
            className="drawer admin-referral-drawer secure-integration-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="curaleaf-drawer-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <p className="section-label">HHH administrator only</p>
                <h2 id="curaleaf-drawer-title">{curaleafApproved ? 'Rotate Curaleaf keys' : 'Connect Curaleaf'}</h2>
              </div>
              <button className="icon-btn" disabled={curaleafBusy || curaleafApproveBusy} onClick={closeCuraleafDrawer} aria-label="Close"><X size={18} /></button>
            </div>
            <form className="drawer-body onboarding-form" onSubmit={submitCuraleafTestAndSave}>
              <div className="integration-boundary">
                <LockKeyhole size={17} />
                <div>
                  <strong>{curaleafPharmacy?.tradingName ?? 'Pharmacy'}</strong>
                  <p>Test & save runs API and PHAR-match checks. Approve Curaleaf completes that setup step only.</p>
                </div>
              </div>
              <label>Curaleaf internal pharmacy / PHAR ID
                <input className="input" autoComplete="off" value={curaleafCustomerId} onChange={event => setCuraleafCustomerId(event.target.value)} required />
                <small className="field-help">Curaleaf’s internal customer UUID for this pharmacy — not the HHH organisation id.</small>
              </label>
              <label>Pharmacy read/write API key
                <input className="input" type="password" autoComplete="new-password" value={curaleafWriteApiKey} onChange={event => setCuraleafWriteApiKey(event.target.value)} required />
              </label>
              <label>Pharmacy read-only API key (optional)
                <input className="input" type="password" autoComplete="new-password" value={curaleafReadApiKey} onChange={event => setCuraleafReadApiKey(event.target.value)} />
              </label>
              <div className="setup-security-note">
                <ShieldCheck size={16} />
                <span>Keys are stored only in this pharmacy’s Europe-hosted Secret Manager secret. The portal never displays them after save.</span>
              </div>
              {curaleafError && <div className="banner banner-red" role="alert"><AlertCircle size={16} /> {curaleafError}</div>}
              {curaleafValidation && (
                <div className={`banner ${curaleafValidation.passed ? 'banner-green' : 'banner-amber'}`} role="status">
                  <ClipboardCheck size={16} />
                  <span>
                    <strong>{curaleafValidation.passed ? 'Validation passed' : 'Validation failed'}</strong>
                    <small>{curaleafValidation.message}</small>
                    {curaleafValidation.observedCustomerId && <small>Observed customer ID: {curaleafValidation.observedCustomerId}</small>}
                  </span>
                </div>
              )}
              {curaleafValidation?.checks?.length ? (
                <div className="filter-grid admin-gate-grid" aria-label="Curaleaf validation checks">
                  {curaleafValidation.checks.map(check => (
                    <div key={check.id} className="filter-card admin-gate-card">
                      <div className="filter-card__head">
                        <span>{check.label}</span>
                        <span className={`pill ${check.passed ? 'pill-green' : 'pill-amber'}`}>{check.passed ? 'Pass' : 'Fail'}</span>
                      </div>
                      <span className="filter-card__value text-xs">{check.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="drawer-actions">
                <button type="button" className="btn" disabled={curaleafBusy || curaleafApproveBusy} onClick={closeCuraleafDrawer}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={curaleafBusy || curaleafApproveBusy || !curaleafOrganisationId}>
                  {curaleafBusy ? 'Testing…' : 'Test & save'}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={curaleafBusy || curaleafApproveBusy || !curaleafOrganisationId || !curaleafValidation?.passed || curaleafApproved}
                  onClick={() => void submitCuraleafApproval()}
                >
                  {curaleafApproveBusy ? 'Approving…' : curaleafApproved ? 'Curaleaf approved' : 'Approve Curaleaf'}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
      <CommandPalette commands={adminCommands} contextLabel="HHH administration" placeholder="Find a pharmacy, patient or platform action…" />
    </div>
  );
}
