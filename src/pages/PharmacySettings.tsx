import { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
  Tags,
} from 'lucide-react';
import { useApp, type TenantModule } from '../context/AppContext';
import { brandSwatchStyle } from '../utils/tenantTheme';
import { isApiConfigured, updatePaymentSettings } from '../shared/api';
import WorldpayConnectionPanel from '../components/WorldpayConnectionPanel';

const MODULE_LABELS: Record<TenantModule, { name: string; description: string }> = {
  intake: { name: 'Patient onboarding', description: 'Pharmacy-attributed eligibility submissions and HHH decisions' },
  rx: { name: 'Prescription workspace', description: 'Prescription verification and order preparation' },
  payments: { name: 'Payments', description: 'Worldpay checkout and pharmacy-managed payment records' },
  supplierOrders: { name: 'Supplier orders', description: 'Curaleaf ordering, invoices, dispatch status and pharmacy goods-in' },
  patients: { name: 'Patient directory', description: 'Tenant-scoped patient records and activity history' },
  resources: { name: 'Form and content pack', description: 'Pharmacy link, QR code and developer assets' },
};

export default function PharmacySettings() {
  const { state, dispatch } = useApp();
  const [savingRoute, setSavingRoute] = useState(false);
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
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
      if (state.workspaceMode === 'live' && isApiConfigured) await updatePaymentSettings(organisation.id, route);
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
        <span className={`pill ${organisation.status === 'live' ? 'pill-green' : 'pill-amber'}`}>{organisation.status}</span>
      </section>

      <div className="settings-grid">
        <section className="card settings-card worldpay-card">
          <div className="settings-card-head">
            <div className="settings-card-icon"><CreditCard size={18} /></div>
            <div><p className="section-label">Default payment route</p><h2>Choose how new orders take payment</h2></div>
            <span className={`pill ${organisation.defaultPaymentRoute === 'worldpay' ? 'pill-green' : ''}`}>{organisation.defaultPaymentRoute === 'worldpay' ? 'Worldpay' : 'Pharmacy payment'}</span>
          </div>

          <div className="payment-route-settings" role="radiogroup" aria-label="Default payment route">
            <button type="button" role="radio" aria-checked={organisation.defaultPaymentRoute === 'manual'} disabled={savingRoute} onClick={() => void setPaymentRoute('manual')}><span><strong>Pharmacy payment</strong><small>EPOS, cash, bank transfer or another pharmacy-controlled route.</small></span>{organisation.defaultPaymentRoute === 'manual' ? <CheckCircle2 size={16} /> : null}</button>
            <button type="button" role="radio" aria-checked={organisation.defaultPaymentRoute === 'worldpay'} disabled={savingRoute || organisation.worldpay.status !== 'connected'} onClick={() => void setPaymentRoute('worldpay')}><span><strong>Worldpay hosted checkout</strong><small>{organisation.worldpay.status === 'connected' ? 'Verified merchant connection; settlement goes directly to this pharmacy.' : 'Connect and verify the pharmacy merchant account below first.'}</small></span>{organisation.defaultPaymentRoute === 'worldpay' ? <CheckCircle2 size={16} /> : null}</button>
          </div>

          {organisation.worldpay.status === 'connected' && <div className="connection-summary">
            <div><span>Environment</span><strong>{organisation.worldpay.environment === 'live' ? 'Live' : 'Sandbox'}</strong></div>
            <div><span>Merchant</span><strong>{organisation.worldpay.merchantName ?? 'Not assigned'}</strong></div>
            <div><span>Merchant ID</span><strong>{organisation.worldpay.merchantId ?? 'Pending onboarding'}</strong></div>
            <div><span>Monthly HHH fee</span><strong>{organisation.platformFeeMonthly == null ? 'To be agreed' : `£${organisation.platformFeeMonthly.toFixed(2)}`}</strong></div>
          </div>}

          <div className="settings-note"><ShieldCheck size={16} /><span>Each order permanently records the route selected here when that order is created. Later changes apply only to future orders.</span></div>
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

        <section className="card settings-card">
          <div className="settings-card-head">
            <div className="settings-card-icon"><ShieldCheck size={18} /></div>
            <div><p className="section-label">Go-live setup</p><h2>Operational readiness</h2></div>
            <CheckCircle2 size={24} className="text-green" />
          </div>
          <div className="compact-checklist">
            <div><CheckCircle2 size={16} className="text-green" /><span><strong>Six setup steps completed</strong><small>Profile, Curaleaf account, payment route, pricing, communications and walkthrough recorded</small></span></div>
          </div>
          <p className="settings-footnote">HHH administrators can review the recorded evidence and connection status from the pharmacy readiness screen.</p>
        </section>
      </div>

      <section className="card settings-card pharmacy-pricing-card">
        <div className="settings-card-head">
          <div className="settings-card-icon"><Tags size={18} /></div>
          <div><p className="section-label">Pricing responsibilities</p><h2>Curaleaf prices and dispensing charges</h2><p>Curaleaf supplies the patient price and order-specific wholesale cost. Your team can only add an optional dispensing charge while building an order.</p></div>
        </div>
        <div className="settings-pricing-summary"><div><strong>Curaleaf connection</strong><span>Managed by HHH administration</span></div><div><strong>Dispensing charge</strong><span>£5, £10, £15 or a custom amount per order</span></div><button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'formulary' })}>Open Curaleaf catalogue</button></div>
        <div className="settings-note"><ShieldCheck size={16} /><span>If Curaleaf is temporarily unavailable, wait and try again. If the issue continues, contact your HHH administrator; pharmacy staff cannot change API credentials.</span></div>
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
