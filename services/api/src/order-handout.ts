export type HandoutFlow = Record<string, Record<string, unknown>>;

export function planOrderHandout(flow: HandoutFlow) {
  const activeFlows = Object.entries(flow).filter(([, prescription]) => !['CANCELLED_PURCHASE_ORDER', 'CANCELLED_REFUNDED', 'EXPIRED'].includes(String(prescription.state)));
  if (!activeFlows.length) return { ready: false as const, code: 'NO_ACTIVE_PRESCRIPTIONS', activeFlows, shipmentIds: [] as string[] };
  if (activeFlows.some(([, prescription]) => !['READY_FOR_COLLECTION', 'COLLECTED'].includes(String(prescription.state)))) {
    return { ready: false as const, code: 'ORDER_NOT_READY_FOR_HANDOUT', activeFlows, shipmentIds: [] as string[] };
  }
  const shipmentIds = [...new Set(activeFlows.flatMap(([, prescription]) => Array.isArray(prescription.shipmentIds) ? prescription.shipmentIds.map(String) : []))];
  if (!shipmentIds.length) return { ready: false as const, code: 'SHIPMENT_REQUIRED', activeFlows, shipmentIds };
  return { ready: true as const, code: null, activeFlows, shipmentIds };
}

export function shipmentsReadyForHandout(shipmentIds: string[], statuses: Record<string, string>) {
  return shipmentIds.length > 0 && shipmentIds.every(shipmentId => ['ready_for_collection', 'collected'].includes(statuses[shipmentId] ?? ''));
}
