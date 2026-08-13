import { randomUUID } from 'node:crypto';
import { firestore } from './firebase.js';
import { nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';
import type { SubstitutionProposal } from './types.js';



export const MARGIN_FLOOR_PERCENT = 15;

/**
 * Largest-remainder penny rounding for pro-rata fee allocation across order lines.
 */
export function allocateDispensingFee(
  linePricesPence: number[],
  totalDispensingFeePence: number
): number[] {
  if (linePricesPence.length === 0) return [];
  const totalPrice = linePricesPence.reduce((sum, p) => sum + p, 0);
  if (totalPrice <= 0 || totalDispensingFeePence <= 0) {
    const allocated = new Array(linePricesPence.length).fill(0);
    if (totalDispensingFeePence > 0 && linePricesPence.length > 0) {
      allocated[0] = totalDispensingFeePence;
    }
    return allocated;
  }

  const rawShares = linePricesPence.map(price => (price / totalPrice) * totalDispensingFeePence);
  const floorShares = rawShares.map(share => Math.floor(share));
  const assignedTotal = floorShares.reduce((sum, s) => sum + s, 0);
  let remainderPence = totalDispensingFeePence - assignedTotal;

  const remainders = rawShares.map((raw, index) => ({
    index,
    remainder: raw - floorShares[index]!,
  }));

  // Sort by highest remainder descending, then index ascending for deterministic behavior
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floorShares];
  for (let i = 0; i < remainderPence; i++) {
    const item = remainders[i % remainders.length];
    if (item && result[item.index] !== undefined) {
      result[item.index]! += 1;
    }
  }

  return result;
}

/**
 * Checks if line medicine revenue + allocated fee meets the 15% wholesale margin floor.
 * Gate: (lineMedicineRevenuePence + allocatedFeePence) >= lineWholesaleCostPence * 1.15
 */
export function satisfiesMarginFloor(
  lineMedicineRevenuePence: number,
  allocatedFeePence: number,
  lineWholesaleCostPence: number
): boolean {
  const lineTotalRevenue = lineMedicineRevenuePence + allocatedFeePence;
  const requiredRevenue = Math.ceil(lineWholesaleCostPence * (1 + MARGIN_FLOOR_PERCENT / 100));
  return lineTotalRevenue >= requiredRevenue;
}

/**
 * Rank substitution options for out-of-stock or held lines.
 * Filter active, in-stock products with exact matching formulaId and exact prescribed-unit total.
 * Rank criteria:
 * 1. Lowest wholesale cost (wholesaleTotalPence ascending)
 * 2. Fewest packs (quantity ascending)
 * 3. Stable pack ID (packId ascending)
 */
export function rankSubstitutions(
  candidates: Array<{
    packId: string;
    formulaId: string;
    formulaName: string;
    unit: string;
    packSize: number;
    quantity: number;
    inStock: boolean;
    state: string;
    wholesalePackPricePence: number;
  }>,
  targetFormulaId: string,
  targetUnitsTotal: number
): SubstitutionProposal[] {
  const matching = candidates.filter(
    c =>
      c.state === 'ACTIVE' &&
      c.inStock &&
      c.formulaId === targetFormulaId &&
      c.packSize * c.quantity === targetUnitsTotal
  );

  const calculated = matching.map(item => ({
    lineId: '',
    originalPackId: '',
    substitutePackId: item.packId,
    formulaId: item.formulaId,
    formulaName: item.formulaName,
    unitsTotal: targetUnitsTotal,
    quantity: item.quantity,
    wholesalePackPricePence: item.wholesalePackPricePence,
    wholesaleTotalPence: item.wholesalePackPricePence * item.quantity,
    rank: 0,
  }));

  calculated.sort((a, b) => {
    if (a.wholesaleTotalPence !== b.wholesaleTotalPence) {
      return a.wholesaleTotalPence - b.wholesaleTotalPence;
    }
    if (a.quantity !== b.quantity) {
      return a.quantity - b.quantity;
    }
    return a.substitutePackId.localeCompare(b.substitutePackId);
  });

  return calculated.map((item, index) => ({
    id: randomUUID(),
    ...item,
    rank: index + 1,
  }));
}

/**
 * Calculates prescription expiry date:
 * Issue date + 28 calendar days if explicit expiry is missing.
 */
export function calculatePrescriptionExpiry(issueDateIso: string, explicitExpiryIso?: string): string {
  if (explicitExpiryIso && explicitExpiryIso.trim().length > 0) {
    return explicitExpiryIso;
  }
  const date = new Date(issueDateIso);
  date.setDate(date.getDate() + 28);
  return date.toISOString().split('T')[0]!;
}

/**
 * Calculates exact boundary date (prescriptionExpiry - 7 calendar days at midnight Europe/London).
 */
export function calculateExpiryBoundaryDate(expiryDateIso: string): string {
  const date = new Date(expiryDateIso);
  date.setDate(date.getDate() - 7);
  // Set midnight
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Append-only Placement Ledger Event
 */
export async function recordPlacementLedgerEvent(event: {
  pharmacyId: string;
  orderId: string;
  prescriptionId: string;
  lineId: string;
  eventType: 'fee_allocated' | 'auto_placed' | 'held_price' | 'held_stock' | 'margin_improved' | 'absorbed_placed' | 'substituted' | 'cancel_requested' | 'refund_confirmed' | 'expired_cancelled' | 'renewal_held' | 'renewal_attached';
  actor: 'system' | string;
  details: Record<string, unknown>;
}) {
  const docRef = firestore.collection('placementLedgerEvents').doc();
  const payload = {
    id: docRef.id,
    ...event,
    timestamp: nowIso(),
  };
  await docRef.set(payload);
  invalidateCollectionCache('placementLedgerEvents');
  return payload;
}
