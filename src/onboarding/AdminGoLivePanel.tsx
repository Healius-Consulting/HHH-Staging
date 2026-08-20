import type { PharmacyTenant } from '../context/AppContext';

interface AdminGoLivePanelProps {
  organisation: PharmacyTenant;
  goLiveError: string | null;
  goLiveBusy: boolean;
  onFlipLive: () => void;
}

function paymentCopy(organisation: PharmacyTenant) {
  if (organisation.defaultPaymentRoute === 'worldpay') {
    return organisation.worldpay.status === 'connected'
      ? { value: 'Worldpay connected', passed: true }
      : { value: 'Worldpay not connected', passed: false };
  }
  return { value: 'Pharmacy-managed', passed: true };
}

export function AdminGoLivePanel({
  organisation,
  goLiveError,
  goLiveBusy,
  onFlipLive,
}: AdminGoLivePanelProps) {
  const liveWorkspace = organisation.status === 'live';
  const paused = organisation.status === 'paused';
  const trainingTenant = organisation.workspaceClassification === 'training';
  const canFlip = !liveWorkspace && !paused && !trainingTenant;
  const payment = paymentCopy(organisation);
  const intakeLive = !paused;
  const workspaceLabel = liveWorkspace ? 'Live' : paused ? 'Paused' : 'Training';
  const staffLabel = organisation.staffCount === 0 ? 'No active staff' : `${organisation.staffCount} active`;
  const curaleafConnected = Boolean(organisation.curaleafPharmacyCode);
  const facts = [
    { id: 'intake', title: 'Intake link', value: intakeLive ? 'Live' : 'Off', passed: intakeLive },
    { id: 'workspace', title: 'Workspace', value: workspaceLabel, passed: liveWorkspace },
    { id: 'staff', title: 'Staff', value: staffLabel, passed: organisation.staffCount > 0 },
    { id: 'curaleaf', title: 'Curaleaf', value: curaleafConnected ? 'Connected' : 'Waiting', passed: curaleafConnected },
    { id: 'payment', title: 'Payment', value: payment.value, passed: payment.passed },
  ];

  return (
    <section className="card admin-golive-panel">
      <div className="admin-golive-panel__head">
        <div>
          <p className="section-label">Go live</p>
          <h2>Pharmacy workspace</h2>
          <p>Flip this workspace live when the pharmacy can run orders. Intake is already on. Worldpay stays optional until they connect a merchant in Settings.</p>
        </div>
        {liveWorkspace ? (
          <span className="pill pill-green">Live</span>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={goLiveBusy || !canFlip}
            onClick={onFlipLive}
          >
            {goLiveBusy ? 'Flipping…' : 'Flip workspace to live'}
          </button>
        )}
      </div>

      {goLiveError ? <div className="banner banner-red" role="alert">{goLiveError}</div> : null}

      <ul className="admin-golive-facts" aria-label={`Connections for ${organisation.tradingName}`}>
        {facts.map(row => (
          <li key={row.id}>
            <span>{row.title}</span>
            <span className={`pill ${row.passed ? 'pill-green' : 'pill-amber'}`}>{row.value}</span>
          </li>
        ))}
      </ul>

      {paused ? (
        <p className="admin-golive-panel__hint">Unpause this pharmacy before flipping the workspace to live.</p>
      ) : null}
      {trainingTenant && !liveWorkspace ? (
        <p className="admin-golive-panel__hint">Training tenants stay in the training workspace.</p>
      ) : null}
    </section>
  );
}
