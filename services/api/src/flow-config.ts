export interface FlowConfig {
  linkExpiryHours: number;
  placementMarginFloor: number;
  delayNotifyHours: number;
  stockBoundaryDays: number;
  advisoryMarginPct: number;
  dispensingFeeMinPence: number;
  dispensingFeeMaxPence: number;
  cutoffTime: string;
  deliveryWindowDays: readonly [number, number];
  autoPlacementEnabled: boolean;
  eventPollSeconds: number;
}

export const FLOW_CONFIG: FlowConfig = Object.freeze({
  linkExpiryHours: 72,
  placementMarginFloor: 0.15,
  delayNotifyHours: 48,
  stockBoundaryDays: 7,
  advisoryMarginPct: 0.25,
  dispensingFeeMinPence: 500,
  dispensingFeeMaxPence: 1_500,
  cutoffTime: '14:30',
  deliveryWindowDays: [2, 4] as const,
  autoPlacementEnabled: true,
  eventPollSeconds: 60,
});

export function validDispensingFeePence(value: number) {
  return value === 0 || Number.isInteger(value)
    && value >= FLOW_CONFIG.dispensingFeeMinPence
    && value <= FLOW_CONFIG.dispensingFeeMaxPence;
}
