import { HttpError } from '../common/errors.js';

export type GeocodeResult =
  | { status: 'matched'; postcode: string; latitude: number; longitude: number; provider: 'postcodes_io' }
  | { status: 'not_found'; postcode: string; provider: 'postcodes_io' }
  | { status: 'provider_unavailable'; postcode: string; provider: 'postcodes_io' };

let postcodeProviderFailures = 0;
let postcodeProviderOpenUntil = 0;

export function normaliseUkPostcode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^(GIR0AA|(?:[A-Z][0-9][0-9A-Z]?|[A-Z][A-Z][0-9][0-9A-Z]?)[0-9][A-Z]{2})$/.test(compact)) {
    throw new HttpError(400, 'Enter a valid UK postcode.', 'INVALID_POSTCODE');
  }
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function isNorthernIrelandPostcode(postcodeValue: string) {
  return normaliseUkPostcode(postcodeValue).startsWith('BT');
}

export function haversineMiles(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function topFiveNearest<T extends { latitude: number; longitude: number }>(
  origin: { latitude: number; longitude: number },
  candidates: T[],
) {
  return candidates
    .map(candidate => ({ profile: candidate, miles: haversineMiles(origin, candidate) }))
    .sort((left, right) => left.miles - right.miles)
    .slice(0, 5);
}

export function projectDirectoryMapPositions(
  origin: { latitude: number; longitude: number },
  destinations: Array<{ latitude: number; longitude: number }>,
) {
  const vectors = destinations.map(destination => {
    const averageLatitudeRadians = ((origin.latitude + destination.latitude) / 2) * Math.PI / 180;
    return {
      x: (destination.longitude - origin.longitude) * Math.cos(averageLatitudeRadians),
      y: destination.latitude - origin.latitude,
    };
  });
  const furthest = Math.max(0.0001, ...vectors.map(vector => Math.hypot(vector.x, vector.y)));
  return vectors.map(vector => ({
    xPercent: Math.round((50 + (vector.x / furthest) * 36) * 10) / 10,
    yPercent: Math.round((50 - (vector.y / furthest) * 36) * 10) / 10,
  }));
}

export async function geocodePostcode(postcodeValue: string): Promise<GeocodeResult> {
  const postcode = normaliseUkPostcode(postcodeValue);
  if (isNorthernIrelandPostcode(postcode) || postcodeProviderOpenUntil > Date.now()) {
    return { status: 'provider_unavailable', postcode, provider: 'postcodes_io' };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch('https://api.postcodes.io/postcodes?filter=postcode,longitude,latitude', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: [postcode] }),
        signal: controller.signal,
      });
      if (response.status === 404) {
        postcodeProviderFailures = 0;
        return { status: 'not_found', postcode, provider: 'postcodes_io' };
      }
      if (!response.ok) throw new Error(`provider_${response.status}`);
      const payload = await response.json() as {
        result?: Array<{ result?: { postcode?: string; latitude?: number; longitude?: number } | null }>;
      };
      const result = payload.result?.[0]?.result;
      if (!result || typeof result.latitude !== 'number' || typeof result.longitude !== 'number') {
        postcodeProviderFailures = 0;
        return { status: 'not_found', postcode, provider: 'postcodes_io' };
      }
      postcodeProviderFailures = 0;
      return {
        status: 'matched',
        postcode: normaliseUkPostcode(result.postcode ?? postcode),
        latitude: result.latitude,
        longitude: result.longitude,
        provider: 'postcodes_io',
      };
    } catch {
      if (attempt === 1) {
        postcodeProviderFailures += 1;
        if (postcodeProviderFailures >= 5) postcodeProviderOpenUntil = Date.now() + 30_000;
        return { status: 'provider_unavailable', postcode, provider: 'postcodes_io' };
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return { status: 'provider_unavailable', postcode, provider: 'postcodes_io' };
}
