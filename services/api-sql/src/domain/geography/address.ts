const UK_POSTCODE_PATTERN = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function formatOrganisationAddress(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  locality?: string | null;
  county?: string | null;
  postcode?: string | null;
}) {
  return [
    input.addressLine1,
    input.addressLine2,
    input.locality,
    input.county,
    input.postcode?.trim().toUpperCase(),
  ]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(', ');
}

export function extractUkPostcode(value: string) {
  const match = value.toUpperCase().match(UK_POSTCODE_PATTERN);
  if (!match?.[1]) return null;
  const compact = match[1].replace(/\s+/g, '');
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function parseLegacyAddressBlob(address: string) {
  const trimmed = address.trim();
  if (!trimmed) {
    return {
      addressLine1: '',
      addressLine2: null as string | null,
      locality: '',
      county: null as string | null,
      postcode: null as string | null,
    };
  }

  const postcode = extractUkPostcode(trimmed);
  const withoutPostcode = postcode
    ? trimmed.replace(new RegExp(`\\b${postcode.replace(/\s+/g, '\\s*')}\\b`, 'i'), '').replace(/[,\s]+$/, '')
    : trimmed;
  const parts = withoutPostcode.split(',').map(part => part.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return {
      addressLine1: parts[0] ?? '',
      addressLine2: parts.length > 3 ? parts.slice(1, -2).join(', ') : null,
      locality: parts.at(-2) ?? '',
      county: parts.at(-1) ?? null,
      postcode,
    };
  }

  if (parts.length === 2) {
    return {
      addressLine1: parts[0] ?? '',
      addressLine2: null,
      locality: parts[1] ?? '',
      county: null,
      postcode,
    };
  }

  return {
    addressLine1: parts[0] ?? trimmed,
    addressLine2: null,
    locality: '',
    county: null,
    postcode,
  };
}
