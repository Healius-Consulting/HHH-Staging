import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import type { PharmacySetupStatus, SetupTaskId } from '../shared/contracts';
import { ADMIN_SANDBOX_TASK_IDS, SETUP_TASKS, operationalStatusRows } from './setup';

const CONNECTION_ROW_IDS = new Set(['intake', 'workspace', 'staff', 'curaleaf', 'payment']);

interface AdminGoLivePanelProps {
  pharmacyName: string;
  liveWorkspace: boolean;
  setupStatus?: PharmacySetupStatus;
  setupError: string | null;
  goLiveError: string | null;
  goLiveBusy: boolean;
  recordingTask: SetupTaskId | null;
  onRecordTask: (taskId: SetupTaskId, completed: boolean) => void;
  onFlipLive: () => void;
}

export function AdminGoLivePanel({
  pharmacyName,
  liveWorkspace,
  setupStatus,
  setupError,
  goLiveError,
  goLiveBusy,
  recordingTask,
  onRecordTask,
  onFlipLive,
}: AdminGoLivePanelProps) {
  const operational = setupStatus?.operational;
  const connectionRows = operational ? operationalStatusRows(operational).filter(row => CONNECTION_ROW_IDS.has(row.id)) : [];
  const remaining = ADMIN_SANDBOX_TASK_IDS.filter(id => {
    const task = setupStatus?.tasks.find(item => item.id === id);
    if (id === 'pharmacy_profile') return !operational?.premises.confirmed;
    if (id === 'pricing') return !operational?.charges.saved;
    if (id === 'notifications') return !operational?.websitePack.published;
    if (id === 'operational_readiness') return !operational?.walkthrough.completed;
    return !task?.completed;
  });

  return (
    <section className="card admin-golive-panel">
      <div className="admin-golive-panel__head">
        <div>
          <p className="section-label">Go live</p>
          <h2>Sandbox call notes</h2>
          <p>HHH records these during the call. The pharmacy workspace does not show this checklist. Explain Worldpay there; they connect the merchant in Settings when ready.</p>
        </div>
        {liveWorkspace ? (
          <span className="pill pill-green">Live</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            disabled={goLiveBusy || !operational?.goLiveReady}
            onClick={onFlipLive}
          >
            {goLiveBusy ? 'Flipping…' : 'Flip workspace to live'}
          </button>
        )}
      </div>

      {setupError ? <div className="banner banner-red" role="alert">{setupError}</div> : null}
      {goLiveError ? <div className="banner banner-red" role="alert">{goLiveError}</div> : null}

      {operational ? (
        <ul className="admin-golive-facts" aria-label={`Connections for ${pharmacyName}`}>
          {connectionRows.map(row => (
            <li key={row.id}>
              <span>{row.title}</span>
              <span className={`pill ${row.passed ? 'pill-green' : 'pill-amber'}`}>{row.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-golive-panel__empty">Operational status is still loading.</p>
      )}

      <ol className="admin-golive-notes">
        {SETUP_TASKS.filter(task => ADMIN_SANDBOX_TASK_IDS.includes(task.id)).map(definition => {
          const complete = !remaining.includes(definition.id);
          return (
            <li key={definition.id} className={complete ? 'is-complete' : ''}>
              <div>
                <strong>{definition.title}</strong>
                <small>{definition.description}</small>
              </div>
              {complete ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={recordingTask === definition.id}
                  onClick={() => onRecordTask(definition.id, false)}
                >
                  <CheckCircle2 size={14} aria-hidden="true" /> Reopen
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={recordingTask === definition.id}
                  onClick={() => onRecordTask(definition.id, true)}
                >
                  <ClipboardCheck size={14} aria-hidden="true" /> {recordingTask === definition.id ? 'Saving…' : 'Record'}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {!liveWorkspace && operational && !operational.goLiveReady ? (
        <p className="admin-golive-panel__hint">Flip live after Curaleaf is connected, staff can sign in, and the sandbox-call notes above are recorded.</p>
      ) : null}
    </section>
  );
}
