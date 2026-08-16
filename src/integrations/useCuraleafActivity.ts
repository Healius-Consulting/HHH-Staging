import { useCallback, useEffect, useState } from 'react';
import { getCuraleafActivity, getDevCuraleafActivity, isApiConfigured } from '../shared/api';
import type { CuraleafActivity } from '../shared/contracts';
import { isLocalPortalPreview } from '../dev/localPortalPreview';

export function useCuraleafActivity(organisationId: string, workspaceMode: 'training' | 'live') {
  const enabled = isApiConfigured && (isLocalPortalPreview || workspaceMode === 'live' && Boolean(organisationId));
  const [activity, setActivity] = useState<CuraleafActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    try {
      setActivity(await (isLocalPortalPreview
        ? getDevCuraleafActivity()
        : getCuraleafActivity(organisationId)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled, organisationId]);

  useEffect(() => {
    setActivity(null);
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { activity, enabled, error, loading, refresh };
}
