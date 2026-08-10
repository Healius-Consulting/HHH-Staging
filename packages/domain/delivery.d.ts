export interface CuraleafDeliveryExpectation {
  approvedDate: string;
  approvedWeekday: string;
  beforeCutoff: boolean;
  windowStart: string;
  windowEnd: string;
  serviceLevel: 'next-working-day' | 'two-to-four-working-days';
}

export function curaleafDeliveryExpectation(approvedAt: Date | string): CuraleafDeliveryExpectation | null;
export function curaleafDeliveryWindowState(expectation: CuraleafDeliveryExpectation, now?: Date | string): 'upcoming' | 'due' | 'overdue';
