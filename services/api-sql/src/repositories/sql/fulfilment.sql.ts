import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  FulfilmentRepositoryPort,
  GoodsReceiptRecord,
  ShipmentRecord,
} from '../ports/fulfilment.port.js';

const LIST_TENANT_SHIPMENTS_GQL = `
  query ListTenantShipments($organisationId: UUID!, $limit: Int!) {
    shipments(where: { organisationId: { eq: $organisationId } }, limit: $limit) {
      id
      orderId
      supplierPurchaseOrderId
      supplierShipmentId
      supplierCustomerReference
      status
      dispatchedAt
      createdAt
    }
  }
`;

const FIND_SHIPMENT_BY_SUPPLIER_ID_GQL = `
  query FindShipmentBySupplierId($organisationId: UUID!, $supplierShipmentId: String!) {
    shipments(
      where: {
        organisationId: { eq: $organisationId }
        supplierShipmentId: { eq: $supplierShipmentId }
      }
      limit: 1
    ) {
      id
      orderId
      supplierPurchaseOrderId
      supplierShipmentId
      supplierCustomerReference
      status
      dispatchedAt
      createdAt
    }
  }
`;

const CREATE_SHIPMENT_GQL = `
  mutation CreateShipment(
    $organisationId: UUID!
    $orderId: UUID!
    $supplierPurchaseOrderId: String!
    $supplierShipmentId: String
    $supplierCustomerReference: String
    $status: ShipmentStatus!
    $dispatchedAt: Timestamp
  ) {
    shipment_insert(data: {
      organisationId: $organisationId
      orderId: $orderId
      supplierPurchaseOrderId: $supplierPurchaseOrderId
      supplierShipmentId: $supplierShipmentId
      supplierCustomerReference: $supplierCustomerReference
      status: $status
      dispatchedAt: $dispatchedAt
    })
  }
`;

const LIST_TENANT_GOODS_RECEIPTS_GQL = `
  query ListTenantGoodsReceipts($organisationId: UUID!, $limit: Int!) {
    goodsReceipts(where: { organisationId: { eq: $organisationId } }, limit: $limit) {
      id
      shipmentId
      receivedByUid
      receivedAt
      status
      notes
    }
  }
`;

const CREATE_GOODS_RECEIPT_GQL = `
  mutation CreateGoodsReceipt(
    $organisationId: UUID!
    $shipmentId: UUID!
    $receivedByUid: String!
    $status: ReceiptStatus!
    $notes: String
  ) {
    goodsReceipt_insert(data: {
      organisationId: $organisationId
      shipmentId: $shipmentId
      receivedByUid: $receivedByUid
      status: $status
      notes: $notes
    })
  }
`;

export class SqlFulfilmentRepository implements FulfilmentRepositoryPort {
  async listShipments(organisationId: string, limit = 200): Promise<ShipmentRecord[]> {
    const result = await dataConnect.executeGraphql<{ shipments: ShipmentRecord[] }, any>(
      LIST_TENANT_SHIPMENTS_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.shipments ?? [];
  }

  async findShipmentBySupplierId(organisationId: string, supplierShipmentId: string): Promise<ShipmentRecord | null> {
    const result = await dataConnect.executeGraphql<{ shipments: ShipmentRecord[] }, any>(
      FIND_SHIPMENT_BY_SUPPLIER_ID_GQL,
      { variables: { organisationId, supplierShipmentId } }
    );
    return result.data.shipments?.[0] ?? null;
  }

  async upsertSupplierShipment(data: {
    organisationId: string;
    orderId: string;
    supplierPurchaseOrderId: string;
    supplierShipmentId: string;
    supplierCustomerReference?: string | null;
    dispatchedAt?: string | null;
  }): Promise<{ id?: string }> {
    const existing = await this.findShipmentBySupplierId(data.organisationId, data.supplierShipmentId).catch(() => null);
    if (existing?.id) return { id: existing.id };
    try {
      const result = await dataConnect.executeGraphql<{ shipment_insert: { id: string } }, any>(
        CREATE_SHIPMENT_GQL,
        {
          variables: {
            organisationId: data.organisationId,
            orderId: data.orderId,
            supplierPurchaseOrderId: data.supplierPurchaseOrderId,
            supplierShipmentId: data.supplierShipmentId,
            supplierCustomerReference: data.supplierCustomerReference ?? null,
            status: 'DISPATCHED',
            dispatchedAt: data.dispatchedAt ?? null,
          },
        }
      );
      return { id: result.data.shipment_insert?.id };
    } catch (error) {
      const raced = await this.findShipmentBySupplierId(data.organisationId, data.supplierShipmentId).catch(() => null);
      if (raced?.id) return { id: raced.id };
      throw error;
    }
  }

  async listGoodsReceipts(organisationId: string, limit = 200): Promise<GoodsReceiptRecord[]> {
    const result = await dataConnect.executeGraphql<{ goodsReceipts: GoodsReceiptRecord[] }, any>(
      LIST_TENANT_GOODS_RECEIPTS_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.goodsReceipts ?? [];
  }

  async createGoodsReceipt(data: {
    organisationId: string;
    shipmentId: string;
    receivedByUid: string;
    status: 'COMPLETE' | 'PARTIAL' | 'EXCEPTION';
    notes?: string | null;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ goodsReceipt_insert: { id: string } }, any>(
      CREATE_GOODS_RECEIPT_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          shipmentId: data.shipmentId,
          receivedByUid: data.receivedByUid,
          status: data.status,
          notes: data.notes ?? null,
        },
      }
    );
    return { id: result.data.goodsReceipt_insert?.id };
  }
}
