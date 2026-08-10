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
