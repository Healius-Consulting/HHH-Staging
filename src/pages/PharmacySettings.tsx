import { useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import { useApp, type TenantModule } from '../context/AppContext';
import { brandSwatchStyle } from '../utils/tenantTheme';
import { isApiConfigured, updatePaymentSettings } from '../shared/api';

const MODULE_LABELS: Record<TenantModule, { name: string; description: string }> = {
  intake: { name: 'Patient onboarding', description: 'Pharmacy-attributed eligibility submissions and HHH decisions' },
  rx: { name: 'Prescription workspace', description: 'Prescription verification and order preparation' },
  payments: { name: 'Payments', description: 'Worldpay checkout and pharmacy-managed payment records' },
  supplierOrders: { name: 'Supplier orders', description: 'Curaleaf ordering, invoices, dispatch status and pharmacy goods-in' },
  patients: { name: 'Patient directory', description: 'Tenant-scoped patient records and activity history' },
  resources: { name: 'Form and content pack', description: 'Pharmacy link, QR code and developer assets' },
};

const statusLabel = {
  'not-connected': 'Not connected',
  onboarding: 'Onboarding in progress',
  connected: 'Connected',
  'action-required': 'Action required',
} as const;

export default function PharmacySettings() {
  const { state, dispatch } = useApp();
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const toggleWorldpay = async (enabled: boolean) => {
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled } });
    try {
      if (state.workspaceMode === 'live' && isApiConfigured) await updatePaymentSettings(organisation.id, enabled);
      dispatch({ type: 'ADD_TOAST', message: enabled ? 'Worldpay has been enabled as a payment option. Link the pharmacy merchant account before using it.' : 'Worldpay has been removed from the prescription checkout. The existing account link has not been deleted.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled: !enabled } });
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Payment settings could not be saved.', toastType: 'error' });
    }
  };
  const startWorldpayOnboarding = () => {
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { status: 'onboarding' } });
    dispatch({ type: 'ADD_TOAST', message: 'Worldpay onboarding started. Continue in the secure Worldpay window when platform access is configured.', toastType: 'info' });
  };

  const syncWorldpay = () => {
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { lastSyncedAt: new Date() } });
    dispatch({ type: 'ADD_TOAST', message: 'Worldpay account status refreshed.', toastType: 'success' });
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
        <span className={`pill ${organisation.status === 'live' ? 'pill-green' : 'pill-amber'}`}>{organisation.status}</span>
      </section>

      <div className="settings-grid">
        <section className="card settings-card worldpay-card">
          <div className="settings-card-head">
            <div className="settings-card-icon"><CreditCard size={18} /></div>
            <div><p className="section-label">Payment provider</p><h2>Your Worldpay connection</h2></div>
            <span className={`pill ${!organisation.worldpay.enabled ? '' : organisation.worldpay.status === 'connected' ? 'pill-green' : organisation.worldpay.status === 'action-required' ? 'pill-red' : 'pill-amber'}`}>{organisation.worldpay.enabled ? statusLabel[organisation.worldpay.status] : 'Disabled'}</span>
          </div>

          <label className="payment-provider-toggle">
            <input type="checkbox" checked={organisation.worldpay.enabled} onChange={event => void toggleWorldpay(event.target.checked)} />
            <span><strong>Offer Worldpay checkout</strong><small>Staff can select Worldpay while reviewing a prescription. The linked merchant account receives patient funds directly.</small></span>
          </label>

          {organisation.worldpay.enabled && <div className="connection-summary">
            <div><span>Environment</span><strong>{organisation.worldpay.environment === 'live' ? 'Live' : 'Sandbox'}</strong></div>
            <div><span>Merchant</span><strong>{organisation.worldpay.merchantName ?? 'Not assigned'}</strong></div>
            <div><span>Merchant ID</span><strong>{organisation.worldpay.merchantId ?? 'Pending onboarding'}</strong></div>
            <div><span>Monthly HHH fee</span><strong>{organisation.platformFeeMonthly == null ? 'To be agreed' : `£${organisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
          </div>}

          <div className="settings-note"><ShieldCheck size={16} /><span>{organisation.worldpay.enabled ? 'Patient funds settle directly to your pharmacy. HHH does not retain a percentage of prescription sales; your separate platform subscription is shown above.' : 'Pharmacy-managed payment remains available. Enabling Worldpay does not send an order or move funds until the pharmacy links its merchant account and staff create a payment request.'}</span></div>

          {organisation.worldpay.enabled && <div className="flex gap-sm flex-wrap">
            {organisation.worldpay.status === 'connected' ? (
              <>
                <button className="btn btn-primary" onClick={syncWorldpay}><RefreshCw size={14} /> Sync status</button>
                <button className="btn" onClick={() => setShowConnectionDetails(value => !value)}><SlidersHorizontal size={14} /> Manage connection</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={startWorldpayOnboarding}><ExternalLink size={14} /> Connect Worldpay</button>
            )}
          </div>}

          {showConnectionDetails && (
            <div className="connection-actions">
              <div><strong>Settlement ownership</strong><span>Worldpay → {organisation.tradingName}</span></div>
              <div><strong>HHH access</strong><span>Payment status and reconciliation only</span></div>
              <button className="btn btn-sm" onClick={() => dispatch({ type: 'ADD_TOAST', message: 'The live Worldpay dashboard link will be supplied during implementation.', toastType: 'info' })}>Open Worldpay dashboard <ArrowUpRight size={13} /></button>
            </div>
          )}
        </section>

        <section className="card settings-card">
          <div className="settings-card-head">
            <div className="settings-card-icon"><ShieldCheck size={18} /></div>
            <div><p className="section-label">Go-live setup</p><h2>Operational readiness</h2></div>
            <CheckCircle2 size={24} className="text-green" />
          </div>
          <div className="compact-checklist">
            <div><CheckCircle2 size={16} className="text-green" /><span><strong>Six setup steps completed</strong><small>Profile, Curaleaf account, payment route, pricing, communications and walkthrough recorded</small></span></div>
          </div>
          <p className="settings-footnote">HHH administrators can review the recorded evidence and connection status from the client readiness screen.</p>
        </section>
      </div>

      <section className="card settings-card pharmacy-pricing-card">
        <div className="settings-card-head">
          <div className="settings-card-icon"><Tags size={18} /></div>
          <div><p className="section-label">Pharmacy-controlled pricing</p><h2>Formulary and dispensing charges</h2><p>Curaleaf WX is read-only. Your team controls PX in the formulary and can add an optional dispensing charge while building an order.</p></div>
        </div>
        <div className="settings-pricing-summary"><div><strong>Fulfilment</strong><span>Patient collection from the pharmacy</span></div><div><strong>Dispensing charge</strong><span>Optional, set per prescription order</span></div><button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'formulary' })}>Open formulary pricing</button></div>
      </section>

      <section className="card settings-card modules-card">
        <div className="settings-card-head">
          <div className="settings-card-icon"><Building2 size={18} /></div>
          <div><p className="section-label">Workspace configuration</p><h2>Enabled modules</h2><p>Modules are provisioned by HHH administration for this pharmacy.</p></div>
        </div>
        <div className="module-grid">
          {(Object.keys(MODULE_LABELS) as TenantModule[]).map(key => (
            <div className={`module-row ${organisation.modules[key] ? 'enabled' : ''}`} key={key}>
              <span>{organisation.modules[key] ? <CheckCircle2 size={17} /> : <span className="module-dot" />}</span>
              <div><strong>{MODULE_LABELS[key].name}</strong><small>{MODULE_LABELS[key].description}</small></div>
              <span className="module-state">{organisation.modules[key] ? 'Enabled' : 'Not enabled'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
