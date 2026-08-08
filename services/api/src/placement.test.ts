import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateDispensingFee,
  calculateExpiryBoundaryDate,
  calculatePrescriptionExpiry,
  rankSubstitutions,
  satisfiesMarginFloor,
} from './placement-engine.js';

test('pro-rata fee allocation rounds pennies deterministically using largest remainder', () => {
  const linePrices = [1000, 2000, 3000]; // 1:2:3 ratio, total 6000
  const fee = 1000; // £10.00
  const allocated = allocateDispensingFee(linePrices, fee);
  assert.equal(allocated.reduce((sum, a) => sum + a, 0), 1000);
  assert.deepEqual(allocated, [167, 333, 500]);
});

test('15% margin floor requires line revenue + allocated fee >= wholesale cost * 1.15', () => {
  // Wholesale cost = £100.00 (10000p) -> Required revenue = £115.00 (11500p)
  assert.equal(satisfiesMarginFloor(10000, 1500, 10000), true);
  assert.equal(satisfiesMarginFloor(9000, 2499, 10000), false);
  assert.equal(satisfiesMarginFloor(11500, 0, 10000), true);
});

test('substitution ranking orders exact matching formulas by cost, pack count, and ID', () => {
  const candidates = [
    { packId: 'pack-c', formulaId: 'form-1', formulaName: 'Form 1', unit: 'g', packSize: 10, quantity: 2, inStock: true, state: 'ACTIVE', wholesalePackPricePence: 2000 },
    { packId: 'pack-a', formulaId: 'form-1', formulaName: 'Form 1', unit: 'g', packSize: 20, quantity: 1, inStock: true, state: 'ACTIVE', wholesalePackPricePence: 3500 },
    { packId: 'pack-b', formulaId: 'form-1', formulaName: 'Form 1', unit: 'g', packSize: 20, quantity: 1, inStock: true, state: 'ACTIVE', wholesalePackPricePence: 3500 },
  ];

  const ranked = rankSubstitutions(candidates, 'form-1', 20);
  assert.equal(ranked.length, 3);
  // pack-a (3500p total, 1 pack, stable ID pack-a) should be rank 1
  assert.equal(ranked[0]?.substitutePackId, 'pack-a');
  assert.equal(ranked[0]?.rank, 1);
  // pack-b (3500p total, 1 pack, stable ID pack-b) should be rank 2
  assert.equal(ranked[1]?.substitutePackId, 'pack-b');
  assert.equal(ranked[1]?.rank, 2);
  // pack-c (4000p total, 2 packs) should be rank 3
  assert.equal(ranked[2]?.substitutePackId, 'pack-c');
  assert.equal(ranked[2]?.rank, 3);
});

test('prescription expiry is automatically derived as 28 days from issue date when missing', () => {
  const issue = '2026-03-01T00:00:00.000Z';
  const expiry = calculatePrescriptionExpiry(issue);
  assert.equal(expiry, '2026-03-29');
});

test('expiry boundary is calculated as 7 days prior to expiry date at midnight', () => {
  const expiry = '2026-03-29T00:00:00.000Z';
  const boundary = calculateExpiryBoundaryDate(expiry);
  assert.equal(new Date(boundary).toISOString().startsWith('2026-03-22'), true);
});
