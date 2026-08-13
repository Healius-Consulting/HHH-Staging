export interface CuraleafDeliveryExpectation {
  approvedDate: string;
  approvedWeekday: string;
  beforeCutoff: boolean;
  windowStart: string;
  windowEnd: string;
  serviceLevel: 'next-to-fourth-working-day';
}

export interface CuraleafDeliveryGuidance {
  scenario: 'DT-1' | 'DT-2' | 'DT-3' | 'DT-4';
  placedDate: string;
  placedWeekday: string;
  beforeCutoff: boolean;
  countdownMinutes: number;
  effectiveProcessingDate: string;
  nextDay: string;
  windowStart: string;
  windowEnd: string;
  serviceLevel: 'next-to-fourth-working-day';
}

export function curaleafDeliveryExpectation(approvedAt: Date | string): CuraleafDeliveryExpectation | null;
export function curaleafDeliveryWindowState(expectation: CuraleafDeliveryExpectation, now?: Date | string): 'upcoming' | 'due' | 'overdue';
export function curaleafDeliveryGuidance(value: Date | string): CuraleafDeliveryGuidance | null;
export function addWorkingDays(dateKey: string, numberOfDays: number): string;
