export interface ShipmentRecord {
  id: string;
  orderId: string;
  courier: string;
  trackingNumber: string;
  status: string;
  dispatchDate: string;
  deliveryDate?: string | null;
  createdAt: string;
}

export interface GoodsReceiptRecord {
  id: string;
  orderId: string;
  receiptNumber: string;
  receivedByUid: string;
  receivedDate: string;
  status: string;
  notes?: string | null;
  createdAt: string;
}

export interface FulfilmentRepositoryPort {
  listShipments(organisationId: string, limit?: number): Promise<ShipmentRecord[]>;
  createShipment(data: {
    organisationId: string;
    orderId: string;
    courier: string;
    trackingNumber: string;
    status: 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED';
    dispatchDate: string;
  }): Promise<{ id?: string }>;
  listGoodsReceipts(organisationId: string, limit?: number): Promise<GoodsReceiptRecord[]>;
  createGoodsReceipt(data: {
    organisationId: string;
    orderId: string;
    receiptNumber: string;
    receivedByUid: string;
    receivedDate: string;
    status: 'COMPLETE' | 'DAMAGED' | 'DISCREPANCY';
    notes?: string | null;
  }): Promise<{ id?: string }>;
}
