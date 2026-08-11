type OrderPatientStatus = 'Referred' | 'HHH approved' | 'Suspended';

export function canCreateOrderForPatient<T extends { status: OrderPatientStatus }>(
  patient: T | null | undefined,
): patient is T & { status: 'Referred' | 'HHH approved' } {
  return patient?.status === 'Referred' || patient?.status === 'HHH approved';
}
