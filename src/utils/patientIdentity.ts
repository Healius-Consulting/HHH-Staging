export type PatientIdentityCheck =
  | { status: 'unavailable'; reason: string }
  | { status: 'match' }
  | { status: 'mismatch'; reason: string };

export function normalisePatientName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-GB')
    .replace(/\b(mr|mrs|miss|ms|mx|dr)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function normaliseIsoDate(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Compare two patient identities when both sides are available.
 * Curaleaf Clinic barcode scans do not return name or date of birth —
 * those stay on the HHH patient record selected for the order.
 */
export function checkPatientIdentity(input: {
  selectedName: string;
  selectedDob?: string;
  prescriptionName?: string;
  prescriptionDob?: string;
}): PatientIdentityCheck {
  const prescriptionName = normalisePatientName(input.prescriptionName ?? '');
  const selectedName = normalisePatientName(input.selectedName);
  const prescriptionDob = normaliseIsoDate(input.prescriptionDob);
  const selectedDob = normaliseIsoDate(input.selectedDob);

  if (!prescriptionName || !prescriptionDob) {
    return {
      status: 'unavailable',
      reason: 'Curaleaf did not return the prescription patient’s full name and date of birth.',
    };
  }
  if (!selectedName || !selectedDob) {
    return {
      status: 'unavailable',
      reason: 'The selected patient record does not have a complete name and date of birth.',
    };
  }
  if (prescriptionDob !== selectedDob) {
    return {
      status: 'mismatch',
      reason: 'The date of birth on the prescription does not match the selected patient.',
    };
  }
  if (prescriptionName !== selectedName) {
    return {
      status: 'mismatch',
      reason: 'The name on the prescription does not match the selected patient.',
    };
  }
  return { status: 'match' };
}
