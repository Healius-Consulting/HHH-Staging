const COMPACT_UUID = /^[0-9a-f]{32}$/i;

export function asUuid(value: string): string {
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!COMPACT_UUID.test(compact)) return value;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function uuidFromHex(hex: string): string {
  const compact = hex.replace(/[^0-9a-f]/gi, '').slice(0, 32).toLowerCase().padEnd(32, '0');
  return asUuid(compact);
}

export function uuidKey(value: string): string {
  return value.replaceAll('-', '').toLowerCase();
}

export function sameUuid(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return uuidKey(left) === uuidKey(right);
}
