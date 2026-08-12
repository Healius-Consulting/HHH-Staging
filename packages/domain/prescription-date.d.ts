export type PrescriptionDateWindowStatus = 'current' | 'future' | 'expired' | 'invalid';

export function prescriptionIssueDateBounds(now?: Date | string): { min: string; max: string } | null;
export function calculatePrescriptionExpiryDate(issueDate: string): string | null;
export function prescriptionDateWindowStatus(issueDate?: string, suppliedExpiryDate?: string, now?: Date | string): PrescriptionDateWindowStatus;
export function prescriptionDateIsCurrent(issueDate?: string, suppliedExpiryDate?: string, now?: Date | string): boolean;
