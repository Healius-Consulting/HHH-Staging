import type { OrderRecord, OrderRepositoryPort } from '../../repositories/ports/order.port.js';

export async function resolveOrdersForCuraleafEntity(
  organisationId: string,
  sqlOrderIds: string[],
  deps: { orderRepo: OrderRepositoryPort },
  fallbackMatch: (order: OrderRecord) => boolean,
): Promise<OrderRecord[]> {
  const uniqueIds = [...new Set(sqlOrderIds.filter(Boolean))];
  const fromSql: OrderRecord[] = [];
  for (const id of uniqueIds) {
    const order = await deps.orderRepo.findOrderById(id, organisationId);
    if (order) fromSql.push(order);
  }
  if (fromSql.length) return fromSql;
  const orders = await deps.orderRepo.listTenantOrders(organisationId, 500);
  return orders.filter(fallbackMatch);
}
