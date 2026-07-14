import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  LogOut,
  MapPin,
  Plus,
  PhoneCall,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import {
  PLATFORM_OPERATOR,
  useApp,
  type ComplianceStatus,
  type PharmacyTenant,
  type TenantModule,
} from '../context/AppContext';
import { downloadContentPack, eligibilityUrl } from '../utils/pharmacyResources';
import { brandSwatchStyle, deriveTenantTheme } from '../utils/tenantTheme';

type AdminView = 'overview' | 'referrals' | 'patients' | 'compliance' | 'integrations';

const MODULE_LABELS: Record<TenantModule, string> = {
  intake: 'Patient intake',
  rx: 'Prescription workspace',
  payments: 'Payments',
  supplierOrders: 'Supplier orders',
  patients: 'Patient directory',
  resources: 'Form and content pack',
};

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  ready: 'Ready',
  'not-applicable': 'Not applicable',
  blocked: 'Blocked',
};

const STATUS_PILLS: Record<ComplianceStatus, string> = {
  'not-started': 'pill-neutral',
  'in-progress': 'pill-amber',
  ready: 'pill-green',
  'not-applicable': 'pill-info',
  blocked: 'pill-red',
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
  const { dispatch } = useApp();
  const items: Array<{ id: AdminView; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Clients', icon: <LayoutDashboard size={15} /> },
    { id: 'referrals', label: 'Onboarding', icon: <UserCheck size={15} /> },
    { id: 'patients', label: 'Patients', icon: <Users size={15} /> },
    { id: 'compliance', label: 'Compliance', icon: <ClipboardCheck size={15} /> },
    { id: 'integrations', label: 'Integrations', icon: <Settings2 size={15} /> },
  ];
  return (
    <header className="admin-header">
      <div className="admin-header-brand"><img className="hhh-wordmark" src="/holistic-health-hub-logo.png" alt="Holistic Health Hub" /><span><small>Healius Consulting · Administration</small></span></div>
      <nav className="admin-nav" aria-label="Administration sections">
        {items.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.icon}{item.label}</button>)}
      </nav>
      <button className="btn btn-sm" onClick={() => dispatch({ type: 'SIGN_OUT_STAFF' })}><LogOut size={14} /> Sign out</button>
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
  const onboardingTheme = deriveTenantTheme(primary);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const slug = slugify(tradingName || name);
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `org-${Date.now()}`;
    const organisation: PharmacyTenant = {
      id,
      slug,
      referralToken: `${slug}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      tradingName,
      logoText: (tradingName || name).split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      gphcNumber,
      superintendent,
      address,
      websiteDomains: domain ? [domain.replace(/^https?:\/\//, '').replace(/\/$/, '')] : [],
      status: 'onboarding',
      staffCount: 0,
      platformFeeMonthly: null,
      deliveryOptions: [
        { id: 'standard', label: 'Standard tracked delivery', description: 'Tracked delivery to the pharmacy.', amount: 6.95, enabled: true },
        { id: 'priority', label: 'Priority tracked delivery', description: 'Faster service where available from the supplier.', amount: 12.95, enabled: true },
        { id: 'collection', label: 'No delivery charge', description: 'Use where no delivery charge is payable.', amount: 0, enabled: true },
      ],
      brand: { primary, portalName: `${tradingName} Patient Services` },
      modules: defaultModules,
      worldpay: { status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
    };
    dispatch({ type: 'ADD_ORGANISATION', organisation });
    dispatch({ type: 'ADD_TOAST', message: `${tradingName} onboarding record created.`, toastType: 'success' });
    onCreated(id);
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

          <div className="onboarding-callout"><ShieldCheck size={17} /><span>The tenant starts in onboarding status. It cannot be marked live until its mandatory compliance gates have evidence.</span></div>
          <div className="drawer-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary"><Plus size={14} /> Create onboarding record</button></div>
        </form>
      </aside>
    </div>
  );
}

export default function AdminPortal() {
  const { state, dispatch } = useApp();
  const [view, setView] = useState<AdminView>('overview');
  const [query, setQuery] = useState('');
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [complianceScope, setComplianceScope] = useState('all');

  const selectedOrganisation = state.organisations.find(org => org.id === selectedOrganisationId);

  useEffect(() => {
    document.querySelector<HTMLElement>('.admin-shell')?.scrollTo({ top: 0 });
  }, [view, selectedOrganisationId]);
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
  const platformItems = state.complianceItems.filter(item => item.organisationId === null);
  const blockingItems = state.complianceItems.filter(item => item.requiredForLive && item.status !== 'ready' && item.status !== 'not-applicable');
  const liveCount = state.organisations.filter(org => org.status === 'live').length;

  const tenantReadiness = (organisationId: string) => {
    const items = state.complianceItems.filter(item => item.organisationId === organisationId && item.requiredForLive);
    const ready = items.filter(item => item.status === 'ready' || item.status === 'not-applicable').length;
    return { ready, total: items.length, percent: items.length ? Math.round(ready / items.length * 100) : 0 };
  };

  if (selectedOrganisation) {
    const submissions = submissionsByOrganisation.get(selectedOrganisation.id) ?? [];
    const patients = crmByOrganisation.get(selectedOrganisation.id) ?? [];
    const compliance = state.complianceItems.filter(item => item.organisationId === selectedOrganisation.id);
    const readiness = tenantReadiness(selectedOrganisation.id);
    const formUrl = eligibilityUrl(selectedOrganisation);
    const tenantTheme = deriveTenantTheme(selectedOrganisation.brand.primary);
    const updateBrand = (updates: Partial<PharmacyTenant['brand']>) => dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisation.id, updates: { brand: { ...selectedOrganisation.brand, ...updates } } });
    const updateModule = (module: TenantModule) => dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisation.id, updates: { modules: { ...selectedOrganisation.modules, [module]: !selectedOrganisation.modules[module] } } });

    return (
      <main className="admin-shell">
        <AdminHeader view={view} setView={next => { setSelectedOrganisationId(null); setView(next); }} />
        <div className="admin-content">
          <button className="btn btn-sm admin-detail-back" onClick={() => setSelectedOrganisationId(null)}><ArrowLeft size={14} /> Back to client directory</button>

          <section className="admin-client-heading">
            <div className="admin-org-brand"><div className="tenant-mark" style={brandSwatchStyle(selectedOrganisation.brand.primary)}>{selectedOrganisation.logoText}</div><div><p className="section-label">Client account</p><h1>{selectedOrganisation.name}</h1><span>{selectedOrganisation.tradingName} · GPhC {selectedOrganisation.gphcNumber}</span></div></div>
            <div className="admin-client-status"><span className={`pill ${selectedOrganisation.status === 'live' ? 'pill-green' : selectedOrganisation.status === 'paused' ? 'pill-red' : 'pill-amber'}`}>{selectedOrganisation.status}</span><strong>{readiness.percent}% go-live evidence</strong></div>
          </section>

          <div className="stats-grid admin-detail-stats">
            <div className="stat-card"><Users size={18} /><strong>{new Set([...patients.map(p => p.email), ...submissions.map(s => s.email)]).size}</strong><span>Attributed patients</span></div>
            <div className="stat-card"><UserRound size={18} /><strong>{selectedOrganisation.staffCount}</strong><span>Staff accounts</span></div>
            <div className="stat-card"><ClipboardCheck size={18} /><strong>{readiness.ready}/{readiness.total}</strong><span>Mandatory gates ready</span></div>
            <div className="stat-card"><CreditCard size={18} /><strong>{selectedOrganisation.platformFeeMonthly == null ? 'Not set' : `£${selectedOrganisation.platformFeeMonthly.toFixed(2)}`}</strong><span>Monthly platform fee</span></div>
          </div>

          <div className="admin-detail-grid admin-config-grid">
            <section className="card admin-detail-card">
              <div className="admin-detail-card-title"><Building2 size={18} /><h2>Registered details</h2></div>
              <div className="admin-detail-list">
                <div><span>Display name</span><strong>{selectedOrganisation.name}</strong></div>
                <div><span>GPhC number</span><strong>{selectedOrganisation.gphcNumber}</strong></div>
                <div><span>Superintendent</span><strong>{selectedOrganisation.superintendent}</strong></div>
                <div><span>Address</span><strong><MapPin size={13} /> {selectedOrganisation.address}</strong></div>
                <div><span>Approved domains</span><strong><Globe2 size={13} /> {selectedOrganisation.websiteDomains.join(', ') || 'Not supplied'}</strong></div>
                <div><span>Monthly HHH platform fee</span><label className="tenant-platform-fee"><span>£</span><input type="number" min="0" step="0.01" value={selectedOrganisation.platformFeeMonthly ?? ''} onChange={event => dispatch({ type: 'UPDATE_ORGANISATION', organisationId: selectedOrganisation.id, updates: { platformFeeMonthly: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) } })} placeholder="Not set" /></label></div>
              </div>
            </section>

            <section className="card admin-detail-card tenant-brand-editor">
              <div className="admin-detail-card-title"><Settings2 size={18} /><h2>Brand and portal identity</h2></div>
              <label>Portal name<input className="input" value={selectedOrganisation.brand.portalName} onChange={event => updateBrand({ portalName: event.target.value })} /></label>
              <div className="brand-editor-row">
                <label>Primary colour<span><input type="color" value={selectedOrganisation.brand.primary} onChange={event => updateBrand({ primary: event.target.value })} /><code>{selectedOrganisation.brand.primary}</code></span></label>
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
                {(Object.keys(MODULE_LABELS) as TenantModule[]).map(module => <label key={module}><span><strong>{MODULE_LABELS[module]}</strong><small>{selectedOrganisation.modules[module] ? 'Available to pharmacy staff' : 'Hidden from navigation'}</small></span><input type="checkbox" checked={selectedOrganisation.modules[module]} onChange={() => updateModule(module)} /></label>)}
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
            <div className="admin-directory-head"><div><p className="section-label">Tenant gate</p><h2>Pharmacy compliance evidence</h2><p>All mandatory records must be ready before this client processes live patient data.</p></div><span className="pill pill-info">{readiness.ready} of {readiness.total} ready</span></div>
            <div className="compliance-table table-wrap"><table><thead><tr><th>Requirement</th><th>Owner</th><th>Evidence</th><th>Status</th></tr></thead><tbody>{compliance.map(item => <tr key={item.id}><td><strong>{item.requirement}</strong><small>{item.reference}</small></td><td>{item.owner}</td><td><input className="compliance-evidence-input" aria-label={`Evidence for ${item.id}`} value={item.evidence ?? ''} onChange={event => dispatch({ type: 'UPDATE_COMPLIANCE', itemId: item.id, status: item.status, evidence: event.target.value })} placeholder="Document, link or note" /></td><td><select className={`status-select ${STATUS_PILLS[item.status]}`} value={item.status} onChange={event => dispatch({ type: 'UPDATE_COMPLIANCE', itemId: item.id, status: event.target.value as ComplianceStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody></table></div>
          </section>

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
        <div className="stat-card"><AlertCircle size={18} /><strong>{blockingItems.length}</strong><span>Open mandatory controls</span></div>
      </div>

      <section className="card admin-attention-strip">
        <div><AlertCircle size={18} /><span><strong>Production gate is not complete</strong><small>{platformItems.filter(item => item.requiredForLive && item.status !== 'ready' && item.status !== 'not-applicable').length} platform controls still require evidence, including the Worldpay settlement model and DPIA.</small></span></div>
        <button className="btn btn-sm" onClick={() => setView('compliance')}>Open compliance register</button>
      </section>

      <section className="card admin-directory">
        <div className="admin-directory-head"><div><h2>Pharmacy clients</h2><p>Account records, tenant configuration and patient attribution.</p></div><label className="admin-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or GPhC number" /></label></div>
        <div className="admin-org-list">
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

  const complianceItems = state.complianceItems.filter(item => complianceScope === 'all' ? true : complianceScope === 'platform' ? item.organisationId === null : item.organisationId === complianceScope);
  const renderCompliance = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Assurance and evidence</p><h1>Compliance register</h1><p>A single operational register for platform controls and pharmacy-specific go-live evidence.</p></div><span className="pill pill-amber"><AlertCircle size={13} /> Professional review required</span></div>
      <section className="integration-boundary card operator-identity"><Building2 size={20} /><div><strong>Platform identity and contracting boundary</strong><p><b>{PLATFORM_OPERATOR.platformName}</b> ({PLATFORM_OPERATOR.platformLongName}) is the platform brand used by <b>{PLATFORM_OPERATOR.operatingName}</b>. The exact registered legal entity behind that business name, company status/number and registered office are not yet verified, so contracts, ICO registration, insurance and live privacy notices remain blocked until Shaylen supplies those details.</p></div></section>
      <section className="compliance-summary-grid">
        <div className="card"><span>Mandatory controls</span><strong>{state.complianceItems.filter(item => item.requiredForLive).length}</strong><small>Platform and tenant records</small></div>
        <div className="card"><span>Evidence ready</span><strong>{state.complianceItems.filter(item => item.status === 'ready').length}</strong><small>Verified or recorded</small></div>
        <div className="card"><span>Blocked</span><strong>{state.complianceItems.filter(item => item.status === 'blocked').length}</strong><small>Needs an external decision</small></div>
        <div className="card"><span>Due for action</span><strong>{state.complianceItems.filter(item => item.status === 'not-started' || item.status === 'in-progress').length}</strong><small>Work remains open</small></div>
      </section>
      <section className="card admin-patient-table compliance-register">
        <div className="admin-directory-head"><div><h2>Requirements and evidence</h2><p>This register supports governance; it does not replace solicitor, DPO, GPhC, CQC, NHS or Worldpay advice.</p></div><select className="input compliance-scope" value={complianceScope} onChange={event => setComplianceScope(event.target.value)}><option value="all">All scopes</option><option value="platform">Healius Consulting · HHH platform</option>{state.organisations.map(org => <option key={org.id} value={org.id}>{org.tradingName}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>Scope / category</th><th>Requirement</th><th>Owner</th><th>Evidence</th><th>Status</th></tr></thead><tbody>{complianceItems.map(item => { const org = state.organisations.find(record => record.id === item.organisationId); return <tr key={item.id}><td><span className="compliance-id">{item.id}</span><strong>{org?.tradingName ?? 'Healius Consulting · HHH'}</strong><small>{item.category}</small></td><td><strong>{item.requirement}</strong><small>{item.reference}{item.requiredForLive ? ' · Required for live' : ''}</small></td><td>{item.owner}</td><td><input className="compliance-evidence-input" aria-label={`Evidence for ${item.id}`} value={item.evidence ?? ''} onChange={event => dispatch({ type: 'UPDATE_COMPLIANCE', itemId: item.id, status: item.status, evidence: event.target.value })} placeholder="Document, link or note" /></td><td><select className={`status-select ${STATUS_PILLS[item.status]}`} value={item.status} onChange={event => dispatch({ type: 'UPDATE_COMPLIANCE', itemId: item.id, status: event.target.value as ComplianceStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>; })}</tbody></table></div>
      </section>
    </>
  );

  const renderIntegrations = () => (
    <>
      <div className="admin-title"><div><p className="section-label">Shared infrastructure</p><h1>Platform integrations</h1><p>Supplier, payment, intake and notification services configured for the HHH platform operated by Healius Consulting.</p></div><span className="pill pill-info"><ShieldCheck size={13} /> Platform-level access</span></div>
      <section className="integration-boundary card"><ShieldCheck size={20} /><div><strong>Tenant payment boundary</strong><p>Each pharmacy owns its patient prices and approved Worldpay merchant relationship. Patient funds settle directly to that pharmacy. HHH charges a separate platform subscription fee and does not retain a percentage of prescription sales.</p></div></section>
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
