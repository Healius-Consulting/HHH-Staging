export interface ShipmentRecord {
  id: string;
  orderId: string;
  supplierPurchaseOrderId: string;
  supplierShipmentId: string | null;
  supplierCustomerReference: string | null;
  status: string;
  dispatchedAt: string | null;
  createdAt: string;
}

export interface GoodsReceiptRecord {
  id: string;
  shipmentId: string;
  receivedByUid: string;
  receivedAt: string;
  status: string;
  notes?: string | null;
}

export interface FulfilmentRepositoryPort {
  listShipments(organisationId: string, limit?: number): Promise<ShipmentRecord[]>;
  findShipmentBySupplierId(organisationId: string, supplierShipmentId: string): Promise<ShipmentRecord | null>;
  upsertSupplierShipment(data: {
    organisationId: string;
    orderId: string;
    supplierPurchaseOrderId: string;
    supplierShipmentId: string;
    supplierCustomerReference?: string | null;
    dispatchedAt?: string | null;
  }): Promise<{ id?: string }>;
  listGoodsReceipts(organisationId: string, limit?: number): Promise<GoodsReceiptRecord[]>;
  createGoodsReceipt(data: {
    organisationId: string;
    shipmentId: string;
    receivedByUid: string;
    status: 'COMPLETE' | 'PARTIAL' | 'EXCEPTION';
    notes?: string | null;
  }): Promise<{ id?: string }>;
}
