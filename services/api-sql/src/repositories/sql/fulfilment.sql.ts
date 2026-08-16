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
      courier
      trackingNumber
      status
      dispatchDate
      deliveryDate
      createdAt
    }
  }
`;

const CREATE_SHIPMENT_GQL = `
  mutation CreateShipment(
    $organisationId: UUID!
    $orderId: UUID!
    $courier: String!
    $trackingNumber: String!
    $status: ShipmentStatus!
    $dispatchDate: Timestamp!
  ) {
    shipment_insert(data: {
      organisationId: $organisationId
      orderId: $orderId
      courier: $courier
      trackingNumber: $trackingNumber
      status: $status
      dispatchDate: $dispatchDate
    })
  }
`;

const LIST_TENANT_GOODS_RECEIPTS_GQL = `
  query ListTenantGoodsReceipts($organisationId: UUID!, $limit: Int!) {
    goodsReceipts(where: { organisationId: { eq: $organisationId } }, limit: $limit) {
      id
      orderId
      receiptNumber
      receivedByUid
      receivedDate
      status
      notes
      createdAt
    }
  }
`;

const CREATE_GOODS_RECEIPT_GQL = `
  mutation CreateGoodsReceipt(
    $organisationId: UUID!
    $orderId: UUID!
    $receiptNumber: String!
    $receivedByUid: String!
    $receivedDate: Timestamp!
    $status: GoodsReceiptStatus!
    $notes: String
  ) {
    goodsReceipt_insert(data: {
      organisationId: $organisationId
      orderId: $orderId
      receiptNumber: $receiptNumber
      receivedByUid: $receivedByUid
      receivedDate: $receivedDate
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

  async createShipment(data: {
    organisationId: string;
    orderId: string;
    courier: string;
    trackingNumber: string;
    status: 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED';
    dispatchDate: string;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ shipment_insert: { id: string } }, any>(
      CREATE_SHIPMENT_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          orderId: data.orderId,
          courier: data.courier,
          trackingNumber: data.trackingNumber,
          status: data.status,
          dispatchDate: data.dispatchDate,
        },
      }
    );
    return { id: result.data.shipment_insert?.id };
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
    orderId: string;
    receiptNumber: string;
    receivedByUid: string;
    receivedDate: string;
    status: 'COMPLETE' | 'DAMAGED' | 'DISCREPANCY';
    notes?: string | null;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ goodsReceipt_insert: { id: string } }, any>(
      CREATE_GOODS_RECEIPT_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          orderId: data.orderId,
          receiptNumber: data.receiptNumber,
          receivedByUid: data.receivedByUid,
          receivedDate: data.receivedDate,
          status: data.status,
          notes: data.notes ?? null,
        },
      }
    );
    return { id: result.data.goodsReceipt_insert?.id };
  }
}
