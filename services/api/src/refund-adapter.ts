import { firestore } from './firebase.js';
import { HttpError, nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';
import type { RefundRecord } from './types.js';


export interface RefundAdapter {
  createRefundRecord(params: {
    orderId: string;
    lineId: string;
    pharmacyId: string;
    amountPence: number;
    originalPaymentRef: string;
    paymentRoute: 'manual' | 'worldpay';
    cause: string;
    idempotencyKey: string;
  }): Promise<RefundRecord>;

  confirmRefund(
    refundId: string,
    confirmedBy: string
  ): Promise<RefundRecord>;
}

export class StaffConfirmationRefundAdapter implements RefundAdapter {
  async createRefundRecord(params: {
    orderId: string;
    lineId: string;
    pharmacyId: string;
    amountPence: number;
    originalPaymentRef: string;
    paymentRoute: 'manual' | 'worldpay';
    cause: string;
    idempotencyKey: string;
  }): Promise<RefundRecord> {
    // Check idempotency
    const existingSnapshot = await firestore
      .collection('refundRecords')
      .where('idempotencyKey', '==', params.idempotencyKey)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      return existingSnapshot.docs[0]!.data() as RefundRecord;
    }

    const docRef = firestore.collection('refundRecords').doc();
    const record: RefundRecord = {
      id: docRef.id,
      ...params,
      status: 'pending_confirmation',
      createdAt: nowIso(),
    };

    await docRef.set(record);
    invalidateCollectionCache('refundRecords');
    return record;
  }

  async confirmRefund(refundId: string, confirmedBy: string): Promise<RefundRecord> {
    const docRef = firestore.collection('refundRecords').doc(refundId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new HttpError(404, 'Refund record not found.', 'NOT_FOUND');
    }

    const current = snapshot.data() as RefundRecord;
    if (current.status === 'completed') {
      return current;
    }

    const updated: RefundRecord = {
      ...current,
      status: 'completed',
      confirmedAt: nowIso(),
      confirmedBy,
    };

    await docRef.set(updated);
    invalidateCollectionCache('refundRecords');
    return updated;
  }
}

export const refundAdapter = new StaffConfirmationRefundAdapter();
