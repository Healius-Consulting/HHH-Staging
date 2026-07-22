import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPharmacySetupStatus, isApiConfigured, updatePharmacySetupTask } from '../shared/api';
import type { PharmacySetupStatus, SetupTaskId } from '../shared/contracts';
import { SETUP_TASKS } from './setup';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

function emptyStatus(organisationId: string): PharmacySetupStatus {
  return {
    organisationId,
    completed: false,
    completedCount: 0,
    requiredCount: SETUP_TASKS.length,
    tasks: SETUP_TASKS.map(task => ({
      id: task.id,
      completed: false,
      completedAt: null,
      completedBy: null,
      evidence: null,
    })),
    updatedAt: new Date(0).toISOString(),
  };
}

function normaliseStatus(status: PharmacySetupStatus): PharmacySetupStatus {
  const supplied = new Map(status.tasks.map(task => [task.id, task]));
  const tasks = SETUP_TASKS.map(definition => supplied.get(definition.id) || {
    id: definition.id,
    completed: false,
    completedAt: null,
    completedBy: null,
    evidence: null,
  });
  const completedCount = tasks.filter(task => task.completed).length;
  return {
    ...status,
    tasks,
    completedCount,
    requiredCount: tasks.length,
    completed: completedCount === tasks.length,
  };
}

function localStorageKey(organisationId: string) {
  return `hhh_dev_pharmacy_setup:${organisationId}`;
}

function readDevelopmentStatus(organisationId: string) {
  if (!import.meta.env.DEV) return null;
  try {
    const saved = localStorage.getItem(localStorageKey(organisationId));
    return saved ? normaliseStatus(JSON.parse(saved) as PharmacySetupStatus) : null;
  } catch {
    return null;
  }
}

function writeDevelopmentStatus(status: PharmacySetupStatus) {
  if (!import.meta.env.DEV) return;
  localStorage.setItem(localStorageKey(status.organisationId), JSON.stringify(status));
}

export function usePharmacySetup(organisationId: string | undefined) {
  const [status, setStatus] = useState<PharmacySetupStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(organisationId));
  const [savingTask, setSavingTask] = useState<SetupTaskId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!organisationId) {
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const load = async () => {
      if (!isApiConfigured || isLocalPortalPreview) {
        const local = readDevelopmentStatus(organisationId);
        if (!cancelled) {
          setStatus(local || emptyStatus(organisationId));
          setLoading(false);
        }
        return;
      }
      try {
        const remote = normaliseStatus(await getPharmacySetupStatus(organisationId));
        if (!cancelled) setStatus(remote);
      } catch (loadError) {
        const local = readDevelopmentStatus(organisationId);
        if (!cancelled) {
          setStatus(local || emptyStatus(organisationId));
          setError(import.meta.env.DEV
            ? 'The setup API is unavailable, so changes are stored in this browser for local development only.'
            : loadError instanceof Error ? loadError.message : 'Setup status could not be loaded.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [organisationId]);

  const updateTask = useCallback(async (taskId: SetupTaskId, completed: boolean, evidence: string) => {
    if (!organisationId || !status) return;
    const previous = status;
    const now = new Date().toISOString();
    const optimistic = normaliseStatus({
      ...status,
      updatedAt: now,
      tasks: status.tasks.map(task => task.id === taskId ? {
        ...task,
        completed,
        completedAt: completed ? now : null,
        completedBy: completed ? 'Current staff user' : null,
        evidence: evidence.trim() || null,
      } : task),
    });
    setStatus(optimistic);
    setSavingTask(taskId);
    setError(null);

    try {
      if (!isApiConfigured || isLocalPortalPreview) {
        writeDevelopmentStatus(optimistic);
        return;
      }
      const remote = await updatePharmacySetupTask(taskId, { organisationId, completed, evidence: evidence.trim() });
      setStatus(normaliseStatus(remote));
    } catch (saveError) {
      if (import.meta.env.DEV) {
        writeDevelopmentStatus(optimistic);
        setError('The setup API is unavailable. This change is stored locally for development and is not production evidence.');
      } else {
        setStatus(previous);
        setError(saveError instanceof Error ? saveError.message : 'The setup task could not be saved.');
      }
    } finally {
      setSavingTask(null);
    }
  }, [organisationId, status]);

  return useMemo(() => ({ status, loading, savingTask, error, updateTask }), [error, loading, savingTask, status, updateTask]);
}
