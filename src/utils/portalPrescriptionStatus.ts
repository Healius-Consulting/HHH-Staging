import type { PortalOrderRecord } from '../shared/contracts';

export type PortalPrescriptionStatus =
  | 'draft'
  | 'awaiting-approval'
  | 'approved'
  | 'dispatched'
  | 'partially-received'
  | 'received'
  | 'ready'
  | 'collected';

/**
 * A newly-created order starts at `supplier_pending`, before anything has been
 * sent to Curaleaf. Only present Curaleaf result data proves that the supplier
 * workflow has actually started.
 */
export function portalPrescriptionStatus(
  record: Pick<PortalOrderRecord, 'curaleaf' | 'fulfilmentStatus'>,
): PortalPrescriptionStatus {
  if (!record.curaleaf) return 'draft';

  return ({
    supplier_pending: 'awaiting-approval',
    supplier_processing: 'approved',
    supplier_allocated: 'approved',
    dispatched_to_pharmacy: 'dispatched',
    partially_received: 'partially-received',
    received: 'received',
    ready_for_collection: 'ready',
    collected: 'collected',
    exception: 'awaiting-approval',
  } as Record<string, PortalPrescriptionStatus>)[record.fulfilmentStatus] ?? 'awaiting-approval';
}
