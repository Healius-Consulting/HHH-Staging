import { dataConnect } from '../bootstrap/firebase.js';
import { formatOrganisationAddress, parseLegacyAddressBlob } from '../domain/geography/address.js';
import { geocodePostcode } from '../domain/geography/postcode.js';
import { SqlDirectoryRepository } from '../repositories/sql/directory.sql.js';
import type { OrganisationRecord } from '../repositories/ports/organisation.port.js';

const LIST_ORGANISATIONS_GQL = `
  query ListOrganisationsForAddressBackfill {
    organisations(where: { archivedAt: { isNull: true } }, limit: 1000) {
      id
      tradingName
      gphcNumber
      address
      addressLine1
      addressLine2
      locality
      county
      postcode
      latitude
      longitude
      mainContactEmail
      mainContactPhone
    }
  }
`;

const UPDATE_ORGANISATION_ADDRESS_GQL = `
  mutation BackfillOrganisationAddress(
    $id: UUID!
    $address: String!
    $addressLine1: String
    $addressLine2: String
    $locality: String
    $county: String
    $postcode: String
    $latitude: Float
    $longitude: Float
  ) {
    organisation_update(
      key: { id: $id }
      data: {
        address: $address
        addressLine1: $addressLine1
        addressLine2: $addressLine2
        locality: $locality
        county: $county
        postcode: $postcode
        latitude: $latitude
        longitude: $longitude
      }
    )
  }
`;

async function backfillOrganisationAddresses() {
  const directoryRepo = new SqlDirectoryRepository();
  const result = await dataConnect.executeGraphql<{ organisations: OrganisationRecord[] }, any>(LIST_ORGANISATIONS_GQL);
  const organisations = result.data.organisations ?? [];
  console.log(`Backfilling structured addresses for ${organisations.length} organisations...\n`);

  for (const organisation of organisations) {
    const parsed = organisation.addressLine1 && organisation.postcode
      ? {
        addressLine1: organisation.addressLine1,
        addressLine2: organisation.addressLine2,
        locality: organisation.locality ?? '',
        county: organisation.county,
        postcode: organisation.postcode,
      }
      : parseLegacyAddressBlob(organisation.address);
    const postcode = parsed.postcode ?? organisation.postcode;
    const geocode = postcode ? await geocodePostcode(postcode).catch(() => null) : null;
    const address = formatOrganisationAddress({
      addressLine1: parsed.addressLine1,
      addressLine2: parsed.addressLine2,
      locality: parsed.locality,
      county: parsed.county,
      postcode: postcode ?? undefined,
    });

    await dataConnect.executeGraphql<any, any>(UPDATE_ORGANISATION_ADDRESS_GQL, {
      variables: {
        id: organisation.id,
        address,
        addressLine1: parsed.addressLine1 || null,
        addressLine2: parsed.addressLine2 || null,
        locality: parsed.locality || null,
        county: parsed.county || null,
        postcode: postcode || null,
        latitude: geocode?.status === 'matched' ? geocode.latitude : organisation.latitude,
        longitude: geocode?.status === 'matched' ? geocode.longitude : organisation.longitude,
      },
    });

    if (parsed.addressLine1 && parsed.locality && postcode && organisation.mainContactEmail) {
      await directoryRepo.upsertProfile({
        organisationId: organisation.id,
        tradingName: organisation.tradingName,
        gphcNumber: organisation.gphcNumber,
        addressLine1: parsed.addressLine1,
        addressLine2: parsed.addressLine2,
        locality: parsed.locality,
        postcode,
        publicEmail: organisation.mainContactEmail,
        publicPhone: organisation.mainContactPhone,
        latitude: geocode?.status === 'matched' ? geocode.latitude : organisation.latitude,
        longitude: geocode?.status === 'matched' ? geocode.longitude : organisation.longitude,
      });
    }

    console.log(`✔ ${organisation.id}: ${postcode ?? 'no postcode'} ${geocode?.status === 'matched' ? `(geocoded)` : ''}`);
  }

  console.log('\nAddress backfill complete.');
}

void backfillOrganisationAddresses();
