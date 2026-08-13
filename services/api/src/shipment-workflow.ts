import type { FulfilmentStatus } from './types.js';

export type ShipmentReceiptLine = {
  expectedQuantity: number;
  receivedQuantity: number;
  issue: 'short' | 'damaged' | 'incorrect' | 'none';
};

export function shipmentReceiptStatus(items: ShipmentReceiptLine[]): FulfilmentStatus {
  const complete = items.length > 0 && items.every(item => item.receivedQuantity >= item.expectedQuantity && item.issue === 'none');
  if (complete) return 'received';
  return items.some(item => item.receivedQuantity > 0) ? 'partially_received' : 'exception';
}

export function canMarkShipmentReady(status: unknown) {
  return status === 'received' || status === 'ready_for_collection';
}

export function receivedLinesHaveBatchDetails(items: Array<{ receivedQuantity: number; batchNumber?: string | null; expiryDate?: string | null }>) {
  return items.every(item => item.receivedQuantity <= 0 || Boolean(item.batchNumber?.trim() && item.expiryDate));
}

export function prescriptionCollectionRollup(lines: Array<{ ordered?: number; returned?: number; received?: number; collected?: number }>) {
  if (!lines.length) return 'in_progress' as const;
  const due = (line: typeof lines[number]) => Math.max(0, Number(line.ordered ?? 0) - Number(line.returned ?? 0));
  if (lines.every(line => Number(line.collected ?? 0) >= due(line))) return 'collected' as const;
  if (lines.every(line => Number(line.received ?? 0) >= due(line))) return 'received' as const;
  return 'in_progress' as const;
}
