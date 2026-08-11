export function canPatientCreateOrder(status: unknown) {
  return status === 'referred' || status === 'active';
}
