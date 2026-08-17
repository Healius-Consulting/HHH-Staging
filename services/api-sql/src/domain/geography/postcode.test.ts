import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOrganisationAddress, parseLegacyAddressBlob } from './address.js';
import { haversineMiles, normaliseUkPostcode, projectDirectoryMapPositions, topFiveNearest } from './postcode.js';

test('UK postcodes are normalised', () => {
  assert.equal(normaliseUkPostcode('sw1a1aa'), 'SW1A 1AA');
  assert.throws(() => normaliseUkPostcode('not a postcode'));
});

test('legacy address blobs are split into structured fields', () => {
  const parsed = parseLegacyAddressBlob('12 High Street, Nottingham, Nottinghamshire, NG16 3AA');
  assert.equal(parsed.addressLine1, '12 High Street');
  assert.equal(parsed.locality, 'Nottingham');
  assert.equal(parsed.county, 'Nottinghamshire');
  assert.equal(parsed.postcode, 'NG16 3AA');
});

test('formatted organisation addresses preserve postcode', () => {
  const formatted = formatOrganisationAddress({
    addressLine1: '12 High Street',
    locality: 'Nottingham',
    postcode: 'ng16 3aa',
  });
  assert.equal(formatted, '12 High Street, Nottingham, NG16 3AA');
});

test('nearest pharmacies are ranked by haversine distance', () => {
  const origin = { latitude: 51.5074, longitude: -0.1278 };
  const candidates = [
    { id: 'near', latitude: 51.51, longitude: -0.12 },
    { id: 'far', latitude: 53.48, longitude: -2.24 },
  ];
  const nearest = topFiveNearest(origin, candidates);
  assert.equal(nearest[0]?.profile.id, 'near');
  assert.ok(nearest[0]!.miles < nearest[1]!.miles);
  assert.ok(haversineMiles(origin, candidates[0]!) < 5);
});

test('directory map positions stay inside the privacy-safe frame', () => {
  const positions = projectDirectoryMapPositions(
    { latitude: 52.95, longitude: -1.15 },
    [{ latitude: 52.96, longitude: -1.14 }],
  );
  assert.equal(positions.length, 1);
  assert.ok(positions[0]!.xPercent >= 0 && positions[0]!.xPercent <= 100);
  assert.ok(positions[0]!.yPercent >= 0 && positions[0]!.yPercent <= 100);
});
