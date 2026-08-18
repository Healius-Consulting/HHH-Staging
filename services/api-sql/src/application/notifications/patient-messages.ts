export const PATIENT_MESSAGE_KINDS = [
  'patient_payment_request',
  'patient_fulfilment_delay',
  'patient_payment_confirmation',
  'patient_ready_for_collection',
] as const;

export type PatientMessageKind = (typeof PATIENT_MESSAGE_KINDS)[number];

export function isPatientMessageKind(value: string): value is PatientMessageKind {
  return (PATIENT_MESSAGE_KINDS as readonly string[]).includes(value);
}

export function patientMessageIdempotencyKey(parts: Array<string | number>) {
  return parts.map(part => String(part)).join(':').slice(0, 180);
}
