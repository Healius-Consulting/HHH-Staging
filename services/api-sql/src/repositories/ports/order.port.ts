export interface OrderDraftRecord {
  id: string;
  organisationId: string;
  patientId: string | null;
  status: string;
  paymentStatus: string;
  payload: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRecord {
  id: string;
  organisationId: string;
  patientId: string;
  draftId: string | null;
  orderNumber: string | null;
  status: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  paymentRoute: string;
  currency: string;
  medicineTotalPence: number;
  dispensingFeePence: number;
  deliveryPence: number;
  taxPence: number;
  totalPence: number;
  quoteSnapshot?: unknown;
  version: number;
  submittedAt: string | null;
  paidAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderInput {
  organisationId: string;
  patientId: string;
  draftId?: string | null;
  orderNumber?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
  paymentStatus: 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  fulfilmentStatus: 'SUPPLIER_PENDING' | 'SUPPLIER_PROCESSING' | 'SUPPLIER_ALLOCATED' | 'PARTIALLY_DISPATCHED_TO_PHARMACY' | 'DISPATCHED_TO_PHARMACY' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'READY_FOR_COLLECTION' | 'COLLECTED' | 'EXCEPTION';
  paymentRoute: 'MANUAL' | 'WORLDPAY';
  currency: string;
  medicineTotalPence: number;
  dispensingFeePence: number;
  deliveryPence: number;
  taxPence: number;
  totalPence: number;
  quoteSnapshot?: unknown;
  createdByUid: string;
}

export interface OrderRepositoryPort {
  findDraftById(id: string, organisationId: string): Promise<OrderDraftRecord | null>;
  listTenantDrafts(organisationId: string, limit?: number): Promise<OrderDraftRecord[]>;
  createDraft(data: { organisationId: string; patientId?: string | null; payload: unknown; createdByUid: string }): Promise<{ id?: string }>;
  updateDraft(data: { id: string; organisationId: string; patientId?: string | null; payload: unknown }): Promise<{ id: string } | null>;
  deleteDraft(id: string, organisationId: string): Promise<boolean>;
  findOrderById(id: string, organisationId: string): Promise<OrderRecord | null>;
  createOrder(data: CreateOrderInput): Promise<{ id?: string }>;
  updateOrderStatus(data: {
    id: string;
    organisationId: string;
    status?: 'DRAFT' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
    paymentStatus?: 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
    fulfilmentStatus?: 'SUPPLIER_PENDING' | 'SUPPLIER_PROCESSING' | 'SUPPLIER_ALLOCATED' | 'PARTIALLY_DISPATCHED_TO_PHARMACY' | 'DISPATCHED_TO_PHARMACY' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'READY_FOR_COLLECTION' | 'COLLECTED' | 'EXCEPTION';
    paidAt?: string | null;
    cancelledAt?: string | null;
  }): Promise<boolean>;
  listTenantOrders(organisationId: string, limit?: number): Promise<OrderRecord[]>;
  listPaidOpenOrders(limit?: number): Promise<OrderRecord[]>;
  updateQuoteSnapshot(data: {
    id: string;
    organisationId: string;
    quoteSnapshot: unknown;
    fulfilmentStatus?: CreateOrderInput['fulfilmentStatus'];
    dispensingFeePence?: number;
  }): Promise<boolean>;
  appendPlacementEvent(data: {
    organisationId: string;
    orderId: string;
    orderLineId?: string | null;
    fromState?: string | null;
    toState: string;
    reason?: string | null;
    externalReference?: string | null;
    actorUid?: string | null;
  }): Promise<void>;
}
