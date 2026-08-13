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
