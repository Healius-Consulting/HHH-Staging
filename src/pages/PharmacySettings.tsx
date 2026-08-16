import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileArchive,
  Link2,
  QrCode,
  ShieldCheck,
  Tags,
} from 'lucide-react';
import { useApp, type TenantModule } from '../context/AppContext';
import { brandSwatchStyle } from '../utils/tenantTheme';
import { isApiConfigured, updatePaymentSettings } from '../shared/api';
import WorldpayConnectionPanel from '../components/WorldpayConnectionPanel';
import { downloadContentPack, downloadDataUrl, eligibilityUrl, qrDataUrl } from '../utils/pharmacyResources';
import { PharmacySetupWizard } from '../onboarding/PharmacySetupWizard';
import type { usePharmacySetup } from '../onboarding/usePharmacySetup';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

const MODULE_LABELS: Record<TenantModule, { name: string; description: string }> = {
  intake: { name: 'Patient onboarding', description: 'Pharmacy-attributed eligibility submissions and HHH decisions' },
  rx: { name: 'Prescription workspace', description: 'Prescription verification and order preparation' },
  payments: { name: 'Payments', description: 'Worldpay checkout and pharmacy-managed payment records' },
  supplierOrders: { name: 'Supplier orders', description: 'Curaleaf ordering, invoices, dispatch status and pharmacy goods-in' },
  patients: { name: 'Patient directory', description: 'Tenant-scoped patient records and activity history' },
  resources: { name: 'Form and content pack', description: 'Pharmacy link, QR code and developer assets' },
};

interface PharmacySettingsProps {
  setup: ReturnType<typeof usePharmacySetup>;
}

export default function PharmacySettings({ setup }: PharmacySettingsProps) {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<'settings' | 'assets' | 'activation'>('settings');
  const [savingRoute, setSavingRoute] = useState(false);
  const [qr, setQr] = useState('');
  const organisation = useMemo(() => state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0], [state]);
  const formUrl = eligibilityUrl(organisation);
  const enabledModules = (Object.keys(MODULE_LABELS) as TenantModule[]).filter(key => organisation.modules[key]).length;

  useEffect(() => { void qrDataUrl(organisation).then(setQr); }, [organisation]);

  const notify = (message: string) => dispatch({ type: 'ADD_TOAST', message, toastType: 'success' });
  const copyLink = async () => { await navigator.clipboard.writeText(formUrl); notify('Pharmacy eligibility link copied to clipboard.'); };

  const setPaymentRoute = async (route: 'manual' | 'worldpay') => {
    if (route === 'worldpay' && organisation.worldpay.status !== 'connected') {
      dispatch({ type: 'ADD_TOAST', message: 'Verify this pharmacy’s Worldpay merchant connection before making it the default.', toastType: 'warning' });
      return;
    }
    const previousRoute = organisation.defaultPaymentRoute;
    setSavingRoute(true);
    dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { defaultPaymentRoute: route } });
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled: route === 'worldpay' } });
    try {
      if (!isLocalPortalPreview && isApiConfigured) await updatePaymentSettings(organisation.id, route);
      dispatch({ type: 'ADD_TOAST', message: `${route === 'worldpay' ? 'Worldpay' : 'Pharmacy payment'} will be used for new orders. Existing orders are unchanged.`, toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { defaultPaymentRoute: previousRoute } });
      dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled: previousRoute === 'worldpay' } });
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Payment settings could not be saved.', toastType: 'error' });
    } finally {
      setSavingRoute(false);
    }
  };

  return (
    <div className="page-body settings-page">
      <section className="settings-identity card">
        <div className="tenant-mark" style={brandSwatchStyle(organisation.brand.primary)}>{organisation.logoText}</div>
        <div>
          <p className="section-label">Organisation profile</p>
          <h2>{organisation.brand.portalName}</h2>
          <p>{organisation.name} · GPhC {organisation.gphcNumber}</p>
        </div>
        <span className={`pill ${organisation.status === 'live' ? 'pill-green' : organisation.status === 'intake_live' ? 'pill-info' : 'pill-amber'}`}>{organisation.status.replace('_', ' ')}</span>
      </section>

      <div className="filter-grid settings-tabs" role="group" aria-label="Settings views">
        <button type="button" aria-pressed={activeTab === 'settings'} className={`filter-card ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <div className="filter-card__head"><span>Organisation</span><Building2 size={14} className={activeTab === 'settings' ? 'text-primary' : 'text-muted'} /></div>
          <span className="filter-card__value filter-card__value--text">Payments, modules & readiness</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'assets'} className={`filter-card ${activeTab === 'assets' ? 'active' : ''}`} onClick={() => setActiveTab('assets')}>
          <div className="filter-card__head"><span>Assets</span><QrCode size={14} className={activeTab === 'assets' ? 'text-primary' : 'text-muted'} /></div>
          <span className="filter-card__value filter-card__value--text">Intake link, QR & content pack</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'activation'} className={`filter-card ${activeTab === 'activation' ? 'active' : ''}`} onClick={() => setActiveTab('activation')}>
          <div className="filter-card__head"><span>Activation</span><ClipboardCheck size={14} className={activeTab === 'activation' ? 'text-primary' : 'text-muted'} /></div>
          <span className="filter-card__value filter-card__value--text">
            {setup.loading ? 'Loading readiness…' : `${setup.status?.completedCount ?? 0} of ${setup.status?.requiredCount ?? 0} steps complete`}
          </span>
        </button>
      </div>

      {activeTab === 'settings' ? (
        <div className="settings-stack">
          {!setup.loading && !setup.status?.completed ? (
            <div className="banner banner-amber" role="status">
              <ClipboardCheck size={16} />
              <span><strong>Pharmacy activation is incomplete.</strong> Organisation settings remain available. Review the activation tab before requesting go-live.</span>
              <button type="button" className="btn btn-sm" onClick={() => setActiveTab('activation')}>Review activation</button>
            </div>
          ) : null}
          <section className="card settings-panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Default payment route</p>
                <h3><CreditCard size={17} /> How new orders take payment</h3>
              </div>
              <span className={`pill ${organisation.defaultPaymentRoute === 'worldpay' ? 'pill-green' : 'pill-neutral'}`}>
                {organisation.defaultPaymentRoute === 'worldpay' ? 'Worldpay' : 'Pharmacy payment'}
              </span>
            </div>

            <div className="payment-route-settings" role="radiogroup" aria-label="Default payment route">
              <button type="button" role="radio" aria-checked={organisation.defaultPaymentRoute === 'manual'} disabled={savingRoute} onClick={() => void setPaymentRoute('manual')}>
                <span><strong>Pharmacy payment</strong><small>EPOS, cash, bank transfer or another pharmacy-controlled route.</small></span>
                {organisation.defaultPaymentRoute === 'manual' ? <CheckCircle2 size={16} /> : null}
              </button>
              <button type="button" role="radio" aria-checked={organisation.defaultPaymentRoute === 'worldpay'} disabled={savingRoute || organisation.worldpay.status !== 'connected'} onClick={() => void setPaymentRoute('worldpay')}>
                <span><strong>Worldpay hosted checkout</strong><small>{organisation.worldpay.status === 'connected' ? 'Verified merchant connection; settlement goes directly to this pharmacy.' : 'Connect and verify the pharmacy merchant account below first.'}</small></span>
                {organisation.defaultPaymentRoute === 'worldpay' ? <CheckCircle2 size={16} /> : null}
              </button>
            </div>

            {organisation.worldpay.status === 'connected' && (
              <div className="connection-summary">
                <div><span>Environment</span><strong>{organisation.worldpay.environment === 'live' ? 'Live' : 'Sandbox'}</strong></div>
                <div><span>Merchant</span><strong>{organisation.worldpay.merchantName ?? 'Not assigned'}</strong></div>
                <div><span>Merchant ID</span><strong>{organisation.worldpay.merchantId ?? 'Pending onboarding'}</strong></div>
                <div><span>Monthly HHH fee</span><strong>{organisation.platformFeeMonthly == null ? 'To be agreed' : `£${organisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
              </div>
            )}

            <div className="settings-note"><ShieldCheck size={16} /><span>Each order permanently records the route selected when that order is created. Later changes apply only to future orders.</span></div>
            <WorldpayConnectionPanel
              organisationId={organisation.id}
              onConnected={connection => dispatch({
                type: 'UPDATE_WORLDPAY',
                organisationId: organisation.id,
                updates: {
                  status: connection.connected ? 'connected' : connection.configured ? 'onboarding' : 'not-connected',
                  merchantId: connection.maskedIdentifier ?? null,
                  lastSyncedAt: connection.updatedAt ?? new Date(),
                },
              })}
            />
          </section>

          <div className="settings-split">
            <section className="card settings-panel">
              <div className="section-heading">
                <div>
                  <p className="section-label">Pricing</p>
                  <h3><Tags size={17} /> Curaleaf prices & dispensing</h3>
                </div>
              </div>
              <div className="settings-meta-grid">
                <div><span>Curaleaf connection</span><strong>Managed by HHH</strong></div>
                <div><span>Dispensing charge</span><strong>£5, £10, £15 or custom</strong></div>
              </div>
              <p className="settings-copy">Curaleaf supplies patient price and wholesale cost. Your team can only add an optional dispensing charge while building an order.</p>
              <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'formulary' })}>Open Curaleaf catalogue</button>
            </section>

            <section className="card settings-panel">
              <div className="section-heading">
                <div>
                  <p className="section-label">Readiness</p>
                  <h3><ShieldCheck size={17} /> Operational status</h3>
                </div>
                <CheckCircle2 size={20} className="text-green" />
              </div>
              <div className="settings-meta-grid">
                <div><span>Modules enabled</span><strong>{enabledModules} of {Object.keys(MODULE_LABELS).length}</strong></div>
                <div><span>Account status</span><strong className="text-capitalize">{organisation.status.replace('_', ' ')}</strong></div>
              </div>
              <p className="settings-copy">HHH administrators can review connection status and go-live evidence from the pharmacy readiness screen.</p>
            </section>
          </div>

          <section className="card settings-panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Workspace configuration</p>
                <h3><Building2 size={17} /> Enabled modules</h3>
              </div>
              <span>{enabledModules} enabled</span>
            </div>
            <div className="module-grid">
              {(Object.keys(MODULE_LABELS) as TenantModule[]).map(key => (
                <div className={`module-row ${organisation.modules[key] ? 'enabled' : ''}`} key={key}>
                  <span>{organisation.modules[key] ? <CheckCircle2 size={17} /> : <span className="module-dot" />}</span>
                  <div><strong>{MODULE_LABELS[key].name}</strong><small>{MODULE_LABELS[key].description}</small></div>
                  <span className="module-state">{organisation.modules[key] ? 'Enabled' : 'Off'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : activeTab === 'assets' ? (
        <div className="settings-stack">
          <div className="alert-success settings-assets-banner">
            <Link2 size={18} />
            <div>
              <strong>Submissions from this link are attributed to {organisation.name}</strong>
              <span>Keep the token pharmacy-specific. Do not share another pharmacy’s URL.</span>
            </div>
          </div>

          <div className="settings-split settings-split--assets">
            <section className="card settings-panel">
              <div className="section-heading">
                <div>
                  <p className="section-label">Patient intake link</p>
                  <h3><Link2 size={17} /> Share the eligibility form</h3>
                </div>
              </div>
              <p className="settings-copy">The form stays hosted by HHH. Use this URL on the pharmacy website, email, or counter materials.</p>
              <div className="resource-url">{formUrl}</div>
              <div className="settings-actions">
                <button className="btn btn-primary" type="button" onClick={copyLink}><Copy size={14} /> Copy link</button>
                <a className="btn btn-secondary" href={formUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview form</a>
              </div>
            </section>

            <section className="card settings-panel settings-panel--center">
              <div className="section-heading">
                <div>
                  <p className="section-label">Print-ready QR</p>
                  <h3><QrCode size={17} /> Leaflets & counter cards</h3>
                </div>
              </div>
              {qr ? (
                <img className="resource-qr" src={qr} alt={`Eligibility QR code for ${organisation.name}`} />
              ) : (
                <div className="resource-qr-placeholder">Generating QR…</div>
              )}
              <button
                className="btn btn-primary"
                type="button"
                disabled={!qr}
                onClick={() => { downloadDataUrl(qr, `${organisation.slug}-eligibility-qr.png`); notify('High-resolution QR code saved.'); }}
              >
                <Download size={14} /> Save QR code
              </button>
            </section>
          </div>

          <section className="card settings-panel settings-pack">
            <div className="settings-pack__copy">
              <div className="resource-icon"><FileArchive size={20} /></div>
              <div>
                <p className="section-label">Developer hand-off</p>
                <h3>Pharmacy website content pack</h3>
                <p className="settings-copy">Suggested page copy, hosted-form link, QR usage notes and high-resolution QR image.</p>
              </div>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              onClick={async () => { await downloadContentPack(organisation); notify('Developer content pack created.'); }}
            >
              <FileArchive size={15} /> Download content pack (.zip)
            </button>
          </section>
        </div>
      ) : (
        <PharmacySetupWizard organisation={organisation} setup={setup} embedded />
      )}
    </div>
  );
}
