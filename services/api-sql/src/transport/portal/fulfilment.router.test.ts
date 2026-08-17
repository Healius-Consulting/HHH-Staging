import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

const entityIdSchema = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i);

const goodsReceiptSchema = z.object({
  orderId: entityIdSchema.optional(),
  receiptNumber: z.string().min(1).max(100).optional(),
  status: z.enum(['COMPLETE', 'DAMAGED', 'DISCREPANCY', 'PARTIAL']).optional(),
  notes: z.string().max(4000).optional(),
  items: z.array(z.object({
    productId: z.string(),
    expectedQuantity: z.number().int().nonnegative().optional(),
    receivedQuantity: z.number().int().nonnegative(),
  })).optional(),
  lines: z.array(z.object({
    productId: z.string(),
    expectedQuantity: z.number().int().nonnegative().optional(),
    receivedQuantity: z.number().int().nonnegative(),
  })).optional(),
});

describe('portal goods receipt validation', () => {
  it('accepts compact tenant ids and dashed UUID order ids', () => {
    const payload = {
      organisationId: '70913a3071c34a41952ed532927af58c',
      orderId: '5a8b4ac3-236c-41f7-a37b-0132b7892637',
      items: [{
        productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
        expectedQuantity: 2,
        receivedQuantity: 2,
        batchNumber: null,
        expiryDate: null,
        issue: 'none',
      }],
    };
    const parsed = goodsReceiptSchema.parse(payload);
    assert.equal(parsed.orderId, '5a8b4ac3-236c-41f7-a37b-0132b7892637');
    assert.equal(parsed.items?.[0]?.receivedQuantity, 2);
  });

  it('accepts compact order ids used by migrated SQL records', () => {
    const parsed = goodsReceiptSchema.parse({
      orderId: '93eea6883a394b1db998e43cc16acf4b',
      items: [{ productId: 'pack-1', receivedQuantity: 1 }],
    });
    assert.equal(parsed.orderId, '93eea6883a394b1db998e43cc16acf4b');
  });
});
