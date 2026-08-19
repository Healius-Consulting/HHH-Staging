import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quotedCostFromSnapshot } from './finance-costing.js';

const paidQuote = {
  shippingPrice: '5.00',
  taxRate: '0.2',
  items: [{
    packId: 'pack-a',
    quantity: 1,
    inStock: true,
    wholesalePackPrice: '68.00',
    patientPackPrice: '85.00',
  }],
};

describe('quoted cost from order snapshot', () => {
  it('uses the stored quote wholesale and shipping, not 75% of patient price', () => {
    const cost = quotedCostFromSnapshot({
      lineItems: [{ packId: 'pack-a', quantity: 1, unitPricePence: 8500 }],
      quote: paidQuote,
      pricingQuote: paidQuote,
    });
    assert.equal(cost.wholesaleComplete, true);
    assert.equal(cost.wholesaleProductPence, 6800);
    assert.equal(cost.shippingPence, 500);
    assert.equal(cost.wholesalePence, 7300);
  });

  it('does not invent a cost when the paid quote is missing', () => {
    const cost = quotedCostFromSnapshot({
      lineItems: [{ packId: 'pack-a', quantity: 1, unitPricePence: 8500 }],
    });
    assert.equal(cost.wholesaleComplete, false);
    assert.equal(cost.wholesaleProductPence, null);
    assert.equal(cost.shippingPence, null);
    assert.equal(cost.wholesalePence, null);
  });

  it('ignores a later quote-review price when the paid quote is stored', () => {
    const cost = quotedCostFromSnapshot({
      quote: paidQuote,
      quoteReview: {
        latestQuote: {
          ...paidQuote,
          items: [{ ...paidQuote.items[0]!, wholesalePackPrice: '72.00' }],
          shippingPrice: '7.00',
        },
      },
    });
    assert.equal(cost.wholesaleProductPence, 6800);
    assert.equal(cost.shippingPence, 500);
  });
});
