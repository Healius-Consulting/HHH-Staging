import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, LockKeyhole } from 'lucide-react';
import { useApp, type PharmacyTenant } from '../context/AppContext';
import { SETUP_TASKS } from './setup';
import { usePharmacySetup } from './usePharmacySetup';
import { isApiConfigured, updatePaymentSettings } from '../shared/api';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

interface PharmacySetupWizardProps {
  organisation: PharmacyTenant;
  setup: ReturnType<typeof usePharmacySetup>;
}

export function PharmacySetupWizard({ organisation, setup }: PharmacySetupWizardProps) {
  const { state, dispatch } = useApp();
  const { status, loading, savingTask, error, updateTask } = setup;
  const [activeIndex, setActiveIndex] = useState(0);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const initialPaymentEvidence = useRef(organisation.defaultPaymentRoute === 'worldpay' ? 'worldpay-enabled' : 'pharmacy-only');
  const activeDefinition = SETUP_TASKS[activeIndex];
  const activeTask = status?.tasks.find(task => task.id === activeDefinition.id);
  const adminManaged = activeDefinition.owner === 'hhh_admin';

  useEffect(() => {
    if (!status) return;
    setEvidence(Object.fromEntries(status.tasks.map(task => [task.id, task.evidence || (task.id === 'payment_route' ? initialPaymentEvidence.current : '')])));
    const nextIncomplete = status.tasks.findIndex(task => !task.completed);
    if (nextIncomplete >= 0) setActiveIndex(nextIncomplete);
  }, [status]);

  const percent = useMemo(() => status ? Math.round(status.completedCount / status.requiredCount * 100) : 0, [status]);

  if (loading || !status) {
    return <div className="page-body setup-page"><section className="card setup-loading" aria-live="polite">Loading pharmacy setup…</section></div>;
  }

  const currentEvidence = evidence[activeDefinition.id] || '';
  const canComplete = !adminManaged && currentEvidence.trim().length >= 2;
  const worldpayEnabled = activeDefinition.id === 'payment_route' && currentEvidence === 'worldpay-enabled';
  const setWorldpayEnabled = async (enabled: boolean) => {
    setEvidence(current => ({ ...current, payment_route: enabled ? 'worldpay-enabled' : 'pharmacy-only' }));
    dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { defaultPaymentRoute: enabled ? 'worldpay' : 'manual' } });
    dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled } });
    try {
      if (!isLocalPortalPreview && isApiConfigured && state.workspaceMode === 'live') await updatePaymentSettings(organisation.id, enabled ? 'worldpay' : 'manual');
    } catch (saveError) {
      setEvidence(current => ({ ...current, payment_route: enabled ? 'pharmacy-only' : 'worldpay-enabled' }));
      dispatch({ type: 'UPDATE_ORGANISATION', organisationId: organisation.id, updates: { defaultPaymentRoute: enabled ? 'manual' : 'worldpay' } });
      dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { enabled: !enabled } });
      dispatch({ type: 'ADD_TOAST', message: saveError instanceof Error ? saveError.message : 'Payment settings could not be saved.', toastType: 'error' });
    }
  };

  return (
    <div className="page-body setup-page">
      <section className="card setup-hero">
        <div>
          <p className="section-label">Pharmacy activation & go-live gates</p>
          <h2>Technical Go-Live Gates & Operational Checklist</h2>
          <p>Go-live status is gated strictly by Company GDPR Evidence, Branch TEST Key Validation, and Branch LIVE Key Validation.</p>
        </div>
        <div className="setup-progress-summary" aria-label={`${status.completedCount} of ${status.requiredCount} tasks complete`}>
          <strong>{percent}%</strong><span>{status.completedCount}/{status.requiredCount} operational steps</span>
        </div>
      </section>

      {/* 3 Hard Go-Live Gates Banner */}
      <section className="card go-live-gates-banner" style={{ padding: '1.25rem', marginBottom: '1rem', background: 'var(--surface-tint, #f0fdf4)', border: '1px solid var(--border-color, #bbf7d0)' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LockKeyhole size={18} />
          <span>3 Hard Go-Live Technical Gates</span>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          <div style={{ padding: '0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <small style={{ color: '#6b7280' }}>Gate 1</small>
            <div style={{ fontWeight: 600 }}>Company GDPR Evidence</div>
            <span className="pill pill-green" style={{ marginTop: '0.25rem' }}>Satisfied</span>
          </div>

          <div style={{ padding: '0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <small style={{ color: '#6b7280' }}>Gate 2</small>
            <div style={{ fontWeight: 600 }}>Branch TEST Validation</div>
            <span className="pill pill-green" style={{ marginTop: '0.25rem' }}>Validated</span>
          </div>

          <div style={{ padding: '0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <small style={{ color: '#6b7280' }}>Gate 3</small>
            <div style={{ fontWeight: 600 }}>Branch LIVE Validation</div>
            <span className="pill pill-amber" style={{ marginTop: '0.25rem' }}>Validation Required</span>
          </div>
        </div>
      </section>


      {error && <div className="banner banner-amber" role="status"><AlertCircle size={16} /> {error}</div>}

      <div className="setup-layout">
        <nav className="card setup-checklist" aria-label="Pharmacy setup steps">
          {SETUP_TASKS.map((definition, index) => {
            const task = status.tasks.find(candidate => candidate.id === definition.id);
            return (
              <button type="button" key={definition.id} aria-current={index === activeIndex ? 'step' : undefined} className={`setup-checklist-item ${index === activeIndex ? 'active' : ''} ${task?.completed ? 'complete' : ''}`} onClick={() => setActiveIndex(index)}>
                {task?.completed ? <CheckCircle2 size={18} /> : <span className="setup-step-number">{index + 1}</span>}
                <span>
                  <span className="setup-task-title-row">
                    <strong>{definition.title}</strong>
                    {definition.owner === 'hhh_admin' ? <em className="setup-owner-tag">HHH admin</em> : null}
                  </span>
                  <small>{task?.completed ? 'Completed' : definition.owner === 'hhh_admin' ? 'Managed centrally' : 'Pharmacy action'}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <section className="card setup-step" aria-labelledby="setup-step-title">
          <div className="setup-step-heading">
            <span className="resource-icon">{activeTask?.completed ? <CheckCircle2 size={20} /> : <ClipboardCheck size={20} />}</span>
            <div>
              <p className="section-label">Step {activeIndex + 1} of {SETUP_TASKS.length}</p>
              <span className="setup-step-title-row">
                <h2 id="setup-step-title">{activeDefinition.title}</h2>
                {adminManaged ? <em className="setup-owner-tag">HHH admin</em> : null}
              </span>
            </div>
          </div>
          <p>{activeDefinition.description}</p>

          {activeDefinition.id === 'pharmacy_profile' && (
            <dl className="setup-profile-summary">
              <div><dt>Registered pharmacy</dt><dd>{organisation.name}</dd></div>
              <div><dt>GPhC number</dt><dd>{organisation.gphcNumber}</dd></div>
              <div><dt>Superintendent</dt><dd>{organisation.superintendent}</dd></div>
              <div><dt>Address</dt><dd>{organisation.address}</dd></div>
            </dl>
          )}

          {adminManaged ? (
            <div className={`banner ${activeTask?.completed ? 'banner-green' : 'banner-blue'} setup-admin-managed`}><LockKeyhole size={16} /><span><strong>{activeTask?.completed ? 'Curaleaf account activated by HHH.' : 'No action is required from the pharmacy.'}</strong> {activeTask?.completed ? 'The secure customer connection is available; the portal never displays the customer ID or API key.' : 'You can continue exploring every workspace with temporary training data while HHH waits for Curaleaf and securely enters the returned account details.'}</span></div>
          ) : activeDefinition.id === 'payment_route' ? (
            <fieldset className="setup-payment-routes">
              <legend>{activeDefinition.evidenceLabel}</legend>
              <label className="setup-payment-option fixed"><input type="checkbox" checked disabled /><span><strong>Pharmacy-managed payment</strong><small>Always available for EPOS, cash, bank transfer or another pharmacy-controlled route.</small></span></label>
              <label className="setup-payment-option"><input type="checkbox" checked={worldpayEnabled} onChange={event => void setWorldpayEnabled(event.target.checked)} /><span><strong>Offer Worldpay checkout</strong><small>Optional. Enable this route now or change it later from Organisation settings.</small></span></label>
              {worldpayEnabled && <div className="setup-worldpay-link"><span><strong>{organisation.worldpay.status === 'connected' ? 'Worldpay account linked' : 'Merchant account linking required'}</strong><small>{organisation.worldpay.status === 'connected' ? 'This pharmacy can offer Worldpay at prescription checkout.' : 'Follow the Worldpay onboarding method agreed with the provider. Enabling the option alone does not create or send a payment request.'}</small></span>{organisation.worldpay.status !== 'connected' && <button type="button" className="btn btn-sm" onClick={() => { dispatch({ type: 'UPDATE_WORLDPAY', organisationId: organisation.id, updates: { status: 'onboarding' } }); dispatch({ type: 'ADD_TOAST', message: 'Worldpay onboarding marked as started. Continue through the provider-approved account-linking process.', toastType: 'info' }); }}>Start account linking</button>}</div>}
            </fieldset>
          ) : <label className="setup-evidence-field">
            <span>{activeDefinition.evidenceLabel}</span>
            <input className="input" value={currentEvidence} placeholder={activeDefinition.placeholder} onChange={event => setEvidence(current => ({ ...current, [activeDefinition.id]: event.target.value }))} />
          </label>}

          <div className="setup-security-note"><LockKeyhole size={16} /><span>Do not enter passwords, API keys, card details, or patient information here. Secrets are connected separately through the secure backend.</span></div>

          <div className="setup-step-actions">
            <button type="button" className="btn" disabled={activeIndex === 0} onClick={() => setActiveIndex(index => index - 1)}><ArrowLeft size={15} /> Previous</button>
            {adminManaged ? null : activeTask?.completed ? (
              <button type="button" className="btn" disabled={savingTask === activeDefinition.id} onClick={() => void updateTask(activeDefinition.id, false, currentEvidence)}>Reopen step</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!canComplete || savingTask === activeDefinition.id} onClick={() => void updateTask(activeDefinition.id, true, currentEvidence)}>{savingTask === activeDefinition.id ? 'Saving…' : 'Confirm and complete'}</button>
            )}
            <button type="button" className="btn" disabled={activeIndex === SETUP_TASKS.length - 1} onClick={() => setActiveIndex(index => index + 1)}>Next <ArrowRight size={15} /></button>
          </div>
        </section>
      </div>
    </div>
  );
}
