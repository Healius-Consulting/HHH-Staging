import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  CreateOrderInput,
  OrderDraftRecord,
  OrderRecord,
  OrderRepositoryPort,
} from '../ports/order.port.js';

const GET_ORDER_DRAFT_BY_ID_GQL = `
  query GetOrderDraftById($id: UUID!, $organisationId: UUID!) {
    orderDrafts(
      where: {
        id: { eq: $id }
        organisationId: { eq: $organisationId }
      }
      limit: 1
    ) {
      id
      organisationId
      patientId
      status
      paymentStatus
      payload
      version
      createdAt
      updatedAt
    }
  }
`;

const CREATE_ORDER_DRAFT_GQL = `
  mutation CreateOrderDraft(
    $organisationId: UUID!
    $patientId: UUID
    $payload: Any!
    $createdByUid: String!
  ) {
    orderDraft_insert(data: {
      organisationId: $organisationId
      patientId: $patientId
      status: DRAFT
      paymentStatus: NONE
      payload: $payload
      createdByUid: $createdByUid
    })
  }
`;

const UPDATE_ORDER_DRAFT_GQL = `
  mutation UpdateOrderDraft(
    $id: UUID!
    $patientId: UUID
    $payload: Any!
  ) {
    orderDraft_update(
      key: { id: $id }
      data: {
        patientId: $patientId
        payload: $payload
        updatedAt_expr: "request.time"
      }
    )
  }
`;

const DELETE_ORDER_DRAFT_GQL = `
  mutation DeleteOrderDraft($id: UUID!) {
    orderDraft_delete(key: { id: $id })
  }
`;

const LIST_TENANT_ORDER_DRAFTS_GQL = `
  query ListTenantOrderDrafts($organisationId: UUID!, $limit: Int!) {
    orderDrafts(
      where: {
        organisationId: { eq: $organisationId }
        status: { eq: DRAFT }
      }
      orderBy: { updatedAt: DESC }
      limit: $limit
    ) {
      id
      organisationId
      patientId
      status
      paymentStatus
      payload
      version
      createdAt
      updatedAt
    }
  }
`;

const GET_ORDER_BY_ID_GQL = `
  query GetOrderById($id: UUID!, $organisationId: UUID!) {
    orders(
      where: {
        id: { eq: $id }
        organisationId: { eq: $organisationId }
      }
      limit: 1
    ) {
      id
      organisationId
      patientId
      draftId
      orderNumber
      status
      paymentStatus
      fulfilmentStatus
      paymentRoute
      currency
      medicineTotalPence
      dispensingFeePence
      deliveryPence
      taxPence
      totalPence
      quoteSnapshot
      version
      submittedAt
      paidAt
      collectedAt
      cancelledAt
      createdAt
      updatedAt
    }
  }
`;

const CREATE_ORDER_GQL = `
  mutation CreateOrder(
    $organisationId: UUID!
    $patientId: UUID!
    $draftId: UUID
    $orderNumber: String
    $status: OrderStatus!
    $paymentStatus: PaymentStatus!
    $fulfilmentStatus: FulfilmentStatus!
    $paymentRoute: PaymentRoute!
    $currency: String!
    $medicineTotalPence: Int64!
    $dispensingFeePence: Int64!
    $deliveryPence: Int64!
    $taxPence: Int64!
    $totalPence: Int64!
    $quoteSnapshot: Any
    $createdByUid: String!
  ) {
    order_insert(data: {
      organisationId: $organisationId
      patientId: $patientId
      draftId: $draftId
      orderNumber: $orderNumber
      status: $status
      paymentStatus: $paymentStatus
      fulfilmentStatus: $fulfilmentStatus
      paymentRoute: $paymentRoute
      currency: $currency
      medicineTotalPence: $medicineTotalPence
      dispensingFeePence: $dispensingFeePence
      deliveryPence: $deliveryPence
      taxPence: $taxPence
      totalPence: $totalPence
      quoteSnapshot: $quoteSnapshot
      createdByUid: $createdByUid
      submittedAt_expr: "request.time"
    })
  }
`;

const UPDATE_ORDER_STATUS_GQL = `
  mutation UpdateOrderStatus(
    $id: UUID!
    $status: OrderStatus
    $paymentStatus: PaymentStatus
    $fulfilmentStatus: FulfilmentStatus
    $paidAt: Timestamp
    $cancelledAt: Timestamp
  ) {
    order_update(
      key: { id: $id }
      data: {
        status: $status
        paymentStatus: $paymentStatus
        fulfilmentStatus: $fulfilmentStatus
        paidAt: $paidAt
        cancelledAt: $cancelledAt
        updatedAt_expr: "request.time"
      }
    )
  }
`;

const LIST_TENANT_ORDERS_GQL = `
  query ListTenantOrders($organisationId: UUID!, $limit: Int!) {
    orders(
      where: { organisationId: { eq: $organisationId } }
      limit: $limit
    ) {
      id
      organisationId
      patientId
      draftId
      orderNumber
      status
      paymentStatus
      fulfilmentStatus
      paymentRoute
      currency
      medicineTotalPence
      dispensingFeePence
      deliveryPence
      taxPence
      totalPence
      quoteSnapshot
      version
      submittedAt
      paidAt
      collectedAt
      cancelledAt
      createdAt
      updatedAt
    }
  }
`;

const APPEND_PLACEMENT_EVENT_GQL = `
  mutation AppendPlacementEvent(
    $organisationId: UUID!
    $orderId: UUID!
    $orderLineId: UUID
    $fromState: PlacementState
    $toState: PlacementState!
    $reason: String
    $externalReference: String
    $actorUid: String
  ) {
    placementEvent_insert(data: {
      organisationId: $organisationId
      orderId: $orderId
      orderLineId: $orderLineId
      fromState: $fromState
      toState: $toState
      reason: $reason
      externalReference: $externalReference
      actorUid: $actorUid
    })
  }
`;

export class SqlOrderRepository implements OrderRepositoryPort {
  async findDraftById(id: string, organisationId: string): Promise<OrderDraftRecord | null> {
    const result = await dataConnect.executeGraphql<{ orderDrafts: OrderDraftRecord[] }, any>(
      GET_ORDER_DRAFT_BY_ID_GQL,
      { variables: { id, organisationId } }
    );
    return result.data.orderDrafts?.[0] ?? null;
  }

  async createDraft(data: {
    organisationId: string;
    patientId?: string | null;
    payload: unknown;
    createdByUid: string;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ orderDraft_insert: { id: string } }, any>(
      CREATE_ORDER_DRAFT_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          patientId: data.patientId ?? null,
          payload: data.payload,
          createdByUid: data.createdByUid,
        },
      }
    );
    return { id: result.data.orderDraft_insert?.id };
  }

  async updateDraft(data: {
    id: string;
    organisationId: string;
    patientId?: string | null;
    payload: unknown;
  }): Promise<{ id: string } | null> {
    const existing = await this.findDraftById(data.id, data.organisationId);
    if (!existing) return null;
    const result = await dataConnect.executeGraphql<{ orderDraft_update: { id: string } | null }, any>(
      UPDATE_ORDER_DRAFT_GQL,
      {
        variables: {
          id: data.id,
          patientId: data.patientId || null,
          payload: data.payload ?? {},
        },
      }
    );
    return result.data.orderDraft_update ? { id: result.data.orderDraft_update.id } : { id: data.id };
  }

  async deleteDraft(id: string, organisationId: string): Promise<boolean> {
    const existing = await this.findDraftById(id, organisationId);
    if (!existing) return false;
    await dataConnect.executeGraphql<any, any>(
      DELETE_ORDER_DRAFT_GQL,
      { variables: { id } }
    );
    return true;
  }

  async listTenantDrafts(organisationId: string, limit = 200): Promise<OrderDraftRecord[]> {
    const result = await dataConnect.executeGraphql<{ orderDrafts: OrderDraftRecord[] }, any>(
      LIST_TENANT_ORDER_DRAFTS_GQL,
      { variables: { organisationId, limit } },
    );
    return result.data.orderDrafts ?? [];
  }

  async findOrderById(id: string, organisationId: string): Promise<OrderRecord | null> {
    const result = await dataConnect.executeGraphql<{ orders: OrderRecord[] }, any>(
      GET_ORDER_BY_ID_GQL,
      { variables: { id, organisationId } }
    );
    return result.data.orders?.[0] ?? null;
  }

  async createOrder(data: CreateOrderInput): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ order_insert: { id: string } }, any>(
      CREATE_ORDER_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          patientId: data.patientId,
          draftId: data.draftId ?? null,
          orderNumber: data.orderNumber ?? null,
          status: data.status,
          paymentStatus: data.paymentStatus,
          fulfilmentStatus: data.fulfilmentStatus,
          paymentRoute: data.paymentRoute,
          currency: data.currency,
          medicineTotalPence: data.medicineTotalPence,
          dispensingFeePence: data.dispensingFeePence,
          deliveryPence: data.deliveryPence,
          taxPence: data.taxPence,
          totalPence: data.totalPence,
          quoteSnapshot: data.quoteSnapshot ?? null,
          createdByUid: data.createdByUid,
        },
      }
    );
    return { id: result.data.order_insert?.id };
  }

  async listTenantOrders(organisationId: string, limit = 200): Promise<OrderRecord[]> {
    const result = await dataConnect.executeGraphql<{ orders: OrderRecord[] }, any>(
      LIST_TENANT_ORDERS_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.orders ?? [];
  }

  async updateOrderStatus(data: {
    id: string;
    organisationId: string;
    status?: 'DRAFT' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
    paymentStatus?: 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
    fulfilmentStatus?: 'SUPPLIER_PENDING' | 'SUPPLIER_PROCESSING' | 'DISPATCHED_TO_PHARMACY' | 'RECEIVED' | 'COLLECTED';
    paidAt?: string | null;
    cancelledAt?: string | null;
  }): Promise<boolean> {
    const existing = await this.findOrderById(data.id, data.organisationId);
    if (!existing) return false;
    await dataConnect.executeGraphql<any, any>(
      UPDATE_ORDER_STATUS_GQL,
      {
        variables: {
          id: data.id,
          status: data.status ?? null,
          paymentStatus: data.paymentStatus ?? null,
          fulfilmentStatus: data.fulfilmentStatus ?? null,
          paidAt: data.paidAt ?? null,
          cancelledAt: data.cancelledAt ?? null,
        },
      }
    );
    return true;
  }

  async appendPlacementEvent(data: {
    organisationId: string;
    orderId: string;
    orderLineId?: string | null;
    fromState?: string | null;
    toState: string;
    reason?: string | null;
    externalReference?: string | null;
    actorUid?: string | null;
  }): Promise<void> {
    await dataConnect.executeGraphql<any, any>(APPEND_PLACEMENT_EVENT_GQL, {
      variables: {
        organisationId: data.organisationId,
        orderId: data.orderId,
        orderLineId: data.orderLineId ?? null,
        fromState: data.fromState ?? null,
        toState: data.toState,
        reason: data.reason ?? null,
        externalReference: data.externalReference ?? null,
        actorUid: data.actorUid ?? null,
      },
    });
  }
}
