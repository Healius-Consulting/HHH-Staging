import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOrganisationAddress, parseLegacyAddressBlob } from './address.js';
import { DIRECTORY_MAP_MIN_RADIUS_MILES, haversineMiles, normaliseUkPostcode, projectDirectoryMapPositions, topFiveNearest } from './postcode.js';

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
  assert.deepEqual(Object.keys(positions[0]!).sort(), ['xPercent', 'yPercent']);
});

test('directory map keeps a nearby pharmacy close when the furthest result is about 100 miles', () => {
  const origin = { latitude: 52.95, longitude: -1.15 };
  const milesPerDegreeLatitude = 69.172;
  const tenMilesNorth = { latitude: origin.latitude + 10 / milesPerDegreeLatitude, longitude: origin.longitude };
  const hundredMilesNorth = { latitude: origin.latitude + 100 / milesPerDegreeLatitude, longitude: origin.longitude };
  const [near, far] = projectDirectoryMapPositions(origin, [tenMilesNorth, hundredMilesNorth]);
  const nearOffset = 50 - (near?.yPercent ?? 50);
  const farOffset = 50 - (far?.yPercent ?? 50);
  assert.ok(nearOffset > 2 && nearOffset < 8);
  assert.ok(farOffset > 35 && farOffset < 46);
  assert.ok(farOffset > nearOffset * 8);
});

test('directory map separates a 100-mile pharmacy from a 260-mile pharmacy', () => {
  const origin = { latitude: 52.95, longitude: -1.15 };
  const milesPerDegreeLatitude = 69.172;
  const hundredMilesNorth = { latitude: origin.latitude + 100 / milesPerDegreeLatitude, longitude: origin.longitude };
  const twoHundredSixtyMilesNorth = { latitude: origin.latitude + 260 / milesPerDegreeLatitude, longitude: origin.longitude };
  const [near, far] = projectDirectoryMapPositions(origin, [hundredMilesNorth, twoHundredSixtyMilesNorth]);
  const nearOffset = 50 - (near?.yPercent ?? 50);
  const farOffset = 50 - (far?.yPercent ?? 50);
  assert.ok(nearOffset > 12 && nearOffset < 22);
  assert.ok(farOffset > 35 && farOffset < 46);
  assert.ok(farOffset > nearOffset * 2);
  assert.ok(DIRECTORY_MAP_MIN_RADIUS_MILES < 100);
});
