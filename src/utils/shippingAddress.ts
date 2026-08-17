export type CuraleafShippingAddress = string | {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
  country?: string | null;
  name?: string | null;
};

export function formatShippingAddress(address: CuraleafShippingAddress[] | null | undefined) {
  if (!address?.length) return null;
  const parts = address.flatMap(entry => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      return trimmed ? [trimmed] : [];
    }
    return [
      entry.name,
      entry.line1,
      entry.line2,
      entry.city,
      entry.county,
      entry.postcode,
      entry.country,
    ].map(value => String(value || '').trim()).filter(Boolean);
  });
  return parts.length ? parts.join(', ') : null;
}
