import { parseQuote, type ParsedQuote } from './quote-review.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Paid Curaleaf quote stored on the order. Never a later live recheck. */
export function paidQuoteFromSnapshot(snapshot: unknown): ParsedQuote | null {
  const root = asRecord(snapshot);
  const curaleaf = asRecord(root.curaleaf);
  for (const candidate of [root.pricingQuote, root.quote, curaleaf.quote]) {
    const parsed = parseQuote(candidate);
    if (parsed && parsed.items.some(item => item.wholesalePence > 0)) return parsed;
  }
  return null;
}

export function quotedCostFromSnapshot(snapshot: unknown) {
  const quote = paidQuoteFromSnapshot(snapshot);
  if (!quote) {
    return {
      wholesaleComplete: false as const,
      wholesaleProductPence: null,
      shippingPence: null,
      wholesalePence: null,
      prices: new Map<string, number>(),
    };
  }
  const wholesaleProductPence = quote.items.reduce((sum, item) => sum + item.wholesalePence * item.quantity, 0);
  return {
    wholesaleComplete: true as const,
    wholesaleProductPence,
    shippingPence: quote.shippingPence,
    wholesalePence: wholesaleProductPence + quote.shippingPence,
    prices: new Map(quote.items.map(item => [item.packId, item.wholesalePence])),
  };
}
