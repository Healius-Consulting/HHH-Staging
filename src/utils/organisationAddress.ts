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

function extractUkPostcode(value: string) {
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
      addressLine2: '',
      locality: '',
      county: '',
      postcode: '',
    };
  }

  const postcode = extractUkPostcode(trimmed) ?? '';
  const withoutPostcode = postcode
    ? trimmed.replace(new RegExp(`\\b${postcode.replace(/\s+/g, '\\s*')}\\b`, 'i'), '').replace(/[,\s]+$/, '')
    : trimmed;
  const parts = withoutPostcode.split(',').map(part => part.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return {
      addressLine1: parts[0] ?? '',
      addressLine2: parts.length > 3 ? parts.slice(1, -2).join(', ') : '',
      locality: parts.at(-2) ?? '',
      county: parts.at(-1) ?? '',
      postcode,
    };
  }

  if (parts.length === 2) {
    return {
      addressLine1: parts[0] ?? '',
      addressLine2: '',
      locality: parts[1] ?? '',
      county: '',
      postcode,
    };
  }

  return {
    addressLine1: parts[0] ?? trimmed,
    addressLine2: '',
    locality: '',
    county: '',
    postcode,
  };
}

export function organisationAddressFields(organisation: {
  address: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  county?: string;
  postcode?: string;
}) {
  if (organisation.addressLine1 || organisation.locality || organisation.postcode) {
    return {
      addressLine1: organisation.addressLine1 ?? '',
      addressLine2: organisation.addressLine2 ?? '',
      locality: organisation.locality ?? '',
      county: organisation.county ?? '',
      postcode: organisation.postcode ?? '',
    };
  }
  return parseLegacyAddressBlob(organisation.address);
}
