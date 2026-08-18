export const DELAY_NOTIFY_HOURS = 48;
export const STOCK_BOUNDARY_DAYS = 7;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function count(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function snapshotObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

export function prescriptionFlowMap(snapshot: unknown): Record<string, Record<string, unknown>> {
  const flow = asRecord(asRecord(snapshot).prescriptionFlow);
  const next: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(flow)) {
    if (value && typeof value === 'object') next[key] = value as Record<string, unknown>;
  }
  return next;
}

function unfulfilled(lines: unknown) {
  if (!Array.isArray(lines)) return false;
  return lines.some(line => {
    const item = asRecord(line);
    return Math.max(0, count(item.shipped) - count(item.returned)) < count(item.ordered);
  });
}

export type MaintenanceAction =
  | { type: 'none' }
  | { type: 'open_delay_episode' }
  | { type: 'notify_delay' }
  | { type: 'close_delay' }
  | { type: 'renewal_boundary' }
  | { type: 'renewal_expired' };

export function evaluatePrescriptionMaintenance(input: {
  state?: string;
  lines?: unknown;
  delayEpisode?: unknown;
  renewal?: unknown;
  expiryDate?: string | null;
  placedAt?: string | null;
  orderUpdatedAt?: string | null;
  now?: Date;
}): MaintenanceAction {
  const now = input.now ?? new Date();
  if (['COLLECTED', 'CANCELLED_PURCHASE_ORDER', 'CANCELLED_REFUNDED'].includes(String(input.state ?? ''))) {
    return { type: 'none' };
  }

  const episode = asRecord(input.delayEpisode);
  const missing = unfulfilled(input.lines);
  if (missing && episode.closedAt) return { type: 'open_delay_episode' };
  const episodeStartedAt = Date.parse(String(episode.startedAt ?? input.placedAt ?? input.orderUpdatedAt ?? ''));
  const delayAt = episodeStartedAt + DELAY_NOTIFY_HOURS * 60 * 60 * 1_000;
  if (missing && Number.isFinite(episodeStartedAt) && now.getTime() >= delayAt && !episode.notifiedAt) {
    return { type: 'notify_delay' };
  }
  if (!missing && episode.id && !episode.closedAt) return { type: 'close_delay' };

  const expiryAt = Date.parse(`${String(input.expiryDate ?? '')}T23:59:59.999Z`);
  if (!missing || !Number.isFinite(expiryAt)) return { type: 'none' };
  const renewal = asRecord(input.renewal);
  const boundaryAt = expiryAt - STOCK_BOUNDARY_DAYS * 24 * 60 * 60 * 1_000;
  if (now.getTime() >= boundaryAt && !['boundary_alerted', 'expired_alerted', 'attaching', 'attached', 'manual_resolution'].includes(String(renewal.state ?? ''))) {
    return { type: 'renewal_boundary' };
  }
  if (now.getTime() >= expiryAt && renewal.state === 'boundary_alerted') return { type: 'renewal_expired' };
  return { type: 'none' };
}

export function applyPrescriptionMaintenance(
  prescription: Record<string, unknown>,
  action: MaintenanceAction,
  now: Date,
  ids: { episodeId: string; taskId: string },
): Record<string, unknown> {
  const episode = asRecord(prescription.delayEpisode);
  const renewal = asRecord(prescription.renewal);
  if (action.type === 'open_delay_episode') {
    return {
      ...prescription,
      delayEpisode: { id: ids.episodeId, startedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
  }
  if (action.type === 'notify_delay') {
    return {
      ...prescription,
      delayEpisode: {
        id: String(episode.id ?? ids.episodeId),
        startedAt: String(episode.startedAt ?? now.toISOString()),
        notifiedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    };
  }
  if (action.type === 'close_delay') {
    return {
      ...prescription,
      delayEpisode: { ...episode, closedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
  }
  if (action.type === 'renewal_boundary') {
    return {
      ...prescription,
      state: 'HELD_FOR_RENEWAL',
      renewal: {
        state: 'boundary_alerted',
        boundaryAt: now.toISOString(),
        taskId: ids.taskId,
      },
      updatedAt: now.toISOString(),
    };
  }
  if (action.type === 'renewal_expired') {
    return {
      ...prescription,
      state: 'HELD_FOR_RENEWAL',
      renewal: {
        ...renewal,
        state: 'expired_alerted',
        expiredTaskId: ids.taskId,
        expiredAlertedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    };
  }
  return prescription;
}
