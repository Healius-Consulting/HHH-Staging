import { useEffect, useState } from 'react';
import type { PharmacyTenant } from '../context/AppContext';
import type { GoLiveReadiness, SetupTaskId } from '../shared/contracts';
import { getGoLiveReadiness, isApiConfigured, revertLiveOrganisation, updateAdminPharmacySetupTask } from '../shared/api';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

interface AdminGoLivePanelProps {
  organisation: PharmacyTenant;
  goLiveError: string | null;
  goLiveBusy: boolean;
  onFlipLive: () => void;
  onReverted?: (status: PharmacyTenant['status']) => void;
}

const LOG_TASKS: Array<{ id: SetupTaskId; title: string; detail: string; evidence: string }> = [
  {
    id: 'intake_call',
    title: 'Intake call',
    detail: 'Log that HHH completed the intake call with this pharmacy.',
    evidence: 'HHH logged the intake call.',
  },
  {
    id: 'operational_readiness',
    title: 'Platform walkthrough',
    detail: 'Log that HHH completed the platform walkthrough with this pharmacy.',
    evidence: 'HHH logged the platform walkthrough.',
  },
];

export function AdminGoLivePanel({
  organisation,
  goLiveError,
  goLiveBusy,
  onFlipLive,
  onReverted,
}: AdminGoLivePanelProps) {
  const liveWorkspace = organisation.status === 'live';
  const paused = organisation.status === 'paused';
  const trainingTenant = organisation.workspaceClassification === 'training';
  const [readiness, setReadiness] = useState<GoLiveReadiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loggingTask, setLoggingTask] = useState<SetupTaskId | null>(null);
  const [reverting, setReverting] = useState(false);

  const refresh = async () => {
    if (isLocalPortalPreview || !isApiConfigured) return;
    setLoadError(null);
    try {
      setReadiness(await getGoLiveReadiness(organisation.id));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Go-live status could not be loaded.');
    }
  };

  useEffect(() => {
    void refresh();
  }, [organisation.id]);

  const operational = readiness?.operational;
  const intakeLogged = operational?.intakeCall.completed === true;
  const walkthroughLogged = operational?.walkthrough.completed === true;
  const curaleafProduction = operational?.curaleaf.production === true;
  const curaleafLabel = operational?.curaleaf.label ?? 'Waiting';
  const serverReady = readiness?.ready === true;
  const canFlip = !liveWorkspace && !paused && !trainingTenant && (isLocalPortalPreview || serverReady);

  const logTask = async (taskId: SetupTaskId, evidence: string) => {
    if (isLocalPortalPreview) return;
    setLoggingTask(taskId);
    setLoadError(null);
    try {
      await updateAdminPharmacySetupTask(organisation.id, taskId, { completed: true, evidence });
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The call could not be logged.');
    } finally {
      setLoggingTask(null);
    }
  };

  const revertLive = async () => {
    if (isLocalPortalPreview) {
      onReverted?.('onboarding');
      return;
    }
    setReverting(true);
    setLoadError(null);
    try {
      const next = await revertLiveOrganisation(organisation.id);
      onReverted?.(next.status);
      setReadiness(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The workspace could not be returned to training.');
    } finally {
      setReverting(false);
    }
  };

  const blockers = [
    { id: 'intake_call', title: 'Intake call', value: intakeLogged ? 'Logged' : 'Not logged', passed: intakeLogged },
    { id: 'walkthrough', title: 'Platform walkthrough', value: walkthroughLogged ? 'Logged' : 'Not logged', passed: walkthroughLogged },
    { id: 'curaleaf', title: 'Curaleaf production', value: curaleafLabel, passed: curaleafProduction },
  ];

  return (
    <section className="card admin-golive-panel">
      <div className="admin-golive-panel__head">
        <div>
          <p className="section-label">Go live</p>
          <h2>Pharmacy workspace</h2>
          <p>Log the intake call and platform walkthrough, then activate Curaleaf production. Intake stays on independently. Worldpay stays optional until they connect a merchant in Settings.</p>
        </div>
        {liveWorkspace ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={goLiveBusy || reverting} onClick={() => void revertLive()}>
            {reverting ? 'Reverting…' : 'Return to training'}
          </button>
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

      {goLiveError || loadError ? <div className="banner banner-red" role="alert">{goLiveError || loadError}</div> : null}

      <ul className="admin-golive-facts" aria-label={`Go-live blockers for ${organisation.tradingName}`}>
        {blockers.map(row => (
          <li key={row.id}>
            <span>{row.title}</span>
            <span className={`pill ${row.passed ? 'pill-green' : 'pill-amber'}`}>{row.value}</span>
          </li>
        ))}
      </ul>

      {!liveWorkspace ? (
        <ul className="admin-golive-actions">
          {LOG_TASKS.map(task => {
            const logged = task.id === 'intake_call' ? intakeLogged : walkthroughLogged;
            return (
              <li key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </div>
                {logged ? (
                  <span className="pill pill-green">Logged</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={loggingTask !== null || isLocalPortalPreview}
                    onClick={() => void logTask(task.id, task.evidence)}
                  >
                    {loggingTask === task.id ? 'Logging…' : `Log ${task.title.toLowerCase()}`}
                  </button>
                )}
              </li>
            );
          })}
          <li>
            <div>
              <strong>Curaleaf production</strong>
              <span>Activate production credentials in the Curaleaf panel. Test connections do not unlock go-live.</span>
            </div>
            <span className={`pill ${curaleafProduction ? 'pill-green' : 'pill-amber'}`}>{curaleafLabel}</span>
          </li>
        </ul>
      ) : null}

      {paused ? (
        <p className="admin-golive-panel__hint">Unpause this pharmacy before flipping the workspace to live.</p>
      ) : null}
      {trainingTenant && !liveWorkspace ? (
        <p className="admin-golive-panel__hint">Training tenants stay in the training workspace.</p>
      ) : null}
    </section>
  );
}
