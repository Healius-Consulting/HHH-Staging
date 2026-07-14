import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
} from 'lucide-react';
import { useApp, type DeliveryOption, type TenantModule } from '../context/AppContext';
import { brandSwatchStyle } from '../utils/tenantTheme';

const MODULE_LABELS: Record<TenantModule, { name: string; description: string }> = {
  intake: { name: 'Patient onboarding', description: 'Pharmacy-attributed eligibility submissions and HHH decisions' },
  rx: { name: 'Prescription workspace', description: 'Prescription verification and order preparation' },
  payments: { name: 'Payments', description: 'Worldpay checkout and pharmacy-managed payment records' },
  supplierOrders: { name: 'Supplier orders', description: 'Curaleaf ordering, invoices and shipment tracking' },
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
  const pharmacyCompliance = useMemo(
    () => state.complianceItems.filter(item => item.organisationId === organisation.id),
    [organisation.id, state.complianceItems],
  );
  const complete = pharmacyCompliance.filter(item => item.status === 'ready' || item.status === 'not-applicable').length;
  const required = pharmacyCompliance.filter(item => item.requiredForLive);

  const startWorldpayOnboarding = () => {
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { status: 'onboarding' } });
    dispatch({ type: 'ADD_TOAST', message: 'Worldpay onboarding started. Continue in the secure Worldpay window when platform access is configured.', toastType: 'info' });
  };

  const syncWorldpay = () => {
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { lastSyncedAt: new Date() } });
    dispatch({ type: 'ADD_TOAST', message: 'Worldpay account status refreshed.', toastType: 'success' });
  };

  const updateDeliveryOption = (optionId: string, updates: Partial<DeliveryOption>) => {
    dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { deliveryOptions: organisation.deliveryOptions.map(option => option.id === optionId ? { ...option, ...updates } : option) } });
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
            <span className={`pill ${organisation.worldpay.status === 'connected' ? 'pill-green' : organisation.worldpay.status === 'action-required' ? 'pill-red' : 'pill-amber'}`}>{statusLabel[organisation.worldpay.status]}</span>
          </div>

          <div className="connection-summary">
            <div><span>Environment</span><strong>{organisation.worldpay.environment === 'live' ? 'Live' : 'Sandbox'}</strong></div>
            <div><span>Merchant</span><strong>{organisation.worldpay.merchantName ?? 'Not assigned'}</strong></div>
            <div><span>Merchant ID</span><strong>{organisation.worldpay.merchantId ?? 'Pending onboarding'}</strong></div>
            <div><span>Monthly HHH fee</span><strong>{organisation.platformFeeMonthly == null ? 'To be agreed' : `£${organisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
          </div>

          <div className="settings-note"><ShieldCheck size={16} /><span>Patient funds settle directly to your pharmacy. HHH does not retain a percentage of prescription sales; your separate platform subscription is shown above.</span></div>

          <div className="flex gap-sm flex-wrap">
            {organisation.worldpay.status === 'connected' ? (
              <>
                <button className="btn btn-primary" onClick={syncWorldpay}><RefreshCw size={14} /> Sync status</button>
                <button className="btn" onClick={() => setShowConnectionDetails(value => !value)}><SlidersHorizontal size={14} /> Manage connection</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={startWorldpayOnboarding}><ExternalLink size={14} /> Connect Worldpay</button>
            )}
          </div>

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
            <div><p className="section-label">Go-live evidence</p><h2>Compliance readiness</h2></div>
            <strong className="settings-score">{complete}/{pharmacyCompliance.length}</strong>
          </div>
          <div className="compliance-progress"><span style={{ width: `${pharmacyCompliance.length ? complete / pharmacyCompliance.length * 100 : 0}%` }} /></div>
          <div className="compact-checklist">
            {pharmacyCompliance.map(item => (
              <div key={item.id}>
                {item.status === 'ready' ? <CheckCircle2 size={16} className="text-green" /> : <AlertCircle size={16} className={item.status === 'blocked' ? 'text-red' : 'text-amber'} />}
                <span><strong>{item.requirement}</strong><small>{item.owner} · {item.status.replace('-', ' ')}</small></span>
              </div>
            ))}
          </div>
          <p className="settings-footnote">Healius Consulting administers the HHH master evidence register. Your pharmacy must complete all {required.length} mandatory tenant gates before live activation.</p>
        </section>
      </div>

      <section className="card settings-card pharmacy-pricing-card">
        <div className="settings-card-head">
          <div className="settings-card-icon"><Truck size={18} /></div>
          <div><p className="section-label">Pharmacy-controlled pricing</p><h2>Prescription and delivery charges</h2><p>Your team sets each prescription item’s patient price in the Rx Builder. Configure the delivery choices shown during order preparation here.</p></div>
        </div>
        <div className="pharmacy-delivery-list">
          {organisation.deliveryOptions.map(option => (
            <div className="pharmacy-delivery-row" key={option.id}>
              <label className="delivery-enabled"><input type="checkbox" checked={option.enabled} onChange={event => updateDeliveryOption(option.id, { enabled: event.target.checked })} /><span>{option.enabled ? 'Enabled' : 'Disabled'}</span></label>
              <label>Delivery option<input className="input" value={option.label} onChange={event => updateDeliveryOption(option.id, { label: event.target.value })} /></label>
              <label>Description<input className="input" value={option.description} onChange={event => updateDeliveryOption(option.id, { description: event.target.value })} /></label>
              <label>Patient charge<span className="money-input"><span>£</span><input type="number" min="0" step="0.01" value={option.amount} onChange={event => updateDeliveryOption(option.id, { amount: Math.max(0, Number(event.target.value)) })} /></span></label>
            </div>
          ))}
        </div>
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
