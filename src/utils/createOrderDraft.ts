export function preferredDraftPaymentRoute(worldpayEnabled: boolean, worldpayStatus: string) {
  return worldpayEnabled && worldpayStatus === 'connected' ? 'worldpay' as const : 'manual' as const;
}

export function nextDraftIdAfterDeletion(
  orders: Array<{ id: number; organisationId: string; payment: { status: string } }>,
  removedOrderId: number,
  organisationId: string,
) {
  const removedIndex = orders.findIndex(order => order.id === removedOrderId);
  const remaining = orders
    .map((order, index) => ({ order, index }))
    .filter(({ order }) => order.id !== removedOrderId && order.organisationId === organisationId && order.payment.status === 'none');
  return remaining.find(({ index }) => index >= removedIndex)?.order.id ?? remaining.at(-1)?.order.id ?? null;
}

export function mostRecentlyUpdatedDraftIndex(records: Array<{ createdAt: string; updatedAt: string }>) {
  return records.reduce((preferredIndex, record, index) => {
    if (preferredIndex < 0) return index;
    const timestamp = Date.parse(record.updatedAt) || Date.parse(record.createdAt) || 0;
    const preferred = records[preferredIndex];
    const preferredTimestamp = Date.parse(preferred.updatedAt) || Date.parse(preferred.createdAt) || 0;
    return timestamp >= preferredTimestamp ? index : preferredIndex;
  }, -1);
}

export function preferredDraftIndex(records: Array<{ createdAt: string; updatedAt: string; payload?: Record<string, unknown> }>) {
  const hasVerifiedAttachment = (record: { payload?: Record<string, unknown> }) => {
    const prescriptions = record.payload?.prescriptions;
    return Array.isArray(prescriptions) && prescriptions.some(prescription => {
      if (!prescription || typeof prescription !== 'object') return false;
      const fileId = (prescription as Record<string, unknown>).fileId;
      return typeof fileId === 'string' && fileId.trim().length > 0;
    });
  };

  const attachedDrafts = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => hasVerifiedAttachment(record));
  if (!attachedDrafts.length) return mostRecentlyUpdatedDraftIndex(records);
  const attachedIndex = mostRecentlyUpdatedDraftIndex(attachedDrafts.map(({ record }) => record));
  return attachedDrafts[attachedIndex]?.index ?? -1;
}
