import { formatOrganisationAddress, parseLegacyAddressBlob } from '../domain/geography/address.js';
import { geocodePostcode } from '../domain/geography/postcode.js';
import type { DirectoryProfileRecord } from '../repositories/ports/directory.port.js';
import type { OrganisationRecord } from '../repositories/ports/organisation.port.js';
import { executeGraphqlViaFirebaseCli } from './dataconnect-cli.js';

type GraphqlExecutor = {
  executeGraphql<TData>(operation: string, variables?: Record<string, unknown>): Promise<{ data: TData }>;
};

const GET_DIRECTORY_PROFILE_GQL = `
  query GetDirectoryProfile($organisationId: UUID!) {
    pharmacyDirectoryProfile(key: { organisationId: $organisationId }) {
      lifecycle
      deliveryCapability
      collectionAvailable
      intakeState
      acceptingNewPatients
    }
  }
`;

const UPSERT_DIRECTORY_PROFILE_GQL = `
  mutation UpsertDirectoryProfile(
    $organisationId: UUID!
    $tradingName: String!
    $gphcNumber: String!
    $addressLine1: String!
    $addressLine2: String
    $locality: String!
    $postcode: String!
    $publicEmail: String!
    $publicPhone: String
    $latitude: Float
    $longitude: Float
    $lifecycle: DirectoryLifecycle!
    $deliveryCapability: DeliveryCapability!
    $collectionAvailable: Boolean!
    $intakeState: IntakeState!
    $acceptingNewPatients: Boolean!
  ) {
    pharmacyDirectoryProfile_upsert(data: {
      organisationId: $organisationId
      tradingName: $tradingName
      gphcNumber: $gphcNumber
      addressLine1: $addressLine1
      addressLine2: $addressLine2
      locality: $locality
      postcode: $postcode
      publicEmail: $publicEmail
      publicPhone: $publicPhone
      latitude: $latitude
      longitude: $longitude
      lifecycle: $lifecycle
      deliveryCapability: $deliveryCapability
      collectionAvailable: $collectionAvailable
      intakeState: $intakeState
      acceptingNewPatients: $acceptingNewPatients
    })
  }
`;

async function createGraphqlExecutor(): Promise<GraphqlExecutor> {
  const { dataConnect } = await import('../bootstrap/firebase.js');
  try {
    await dataConnect.executeGraphql<{ organisations: Array<{ id: string }> }, any>(
      'query BackfillAuthProbe { organisations(limit: 1) { id } }',
    );
    return {
      executeGraphql<TData>(operation: string, variables: Record<string, unknown> = {}) {
        return dataConnect.executeGraphql<TData, any>(operation, { variables }) as Promise<{ data: TData }>;
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('invalid-credential') && !message.includes('invalid_grant')) {
      throw error;
    }
    console.warn('Application default credentials unavailable; using Firebase CLI auth instead.\n');
    return {
      executeGraphql: executeGraphqlViaFirebaseCli,
    };
  }
}

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

async function upsertDirectoryProfile(
  graphql: GraphqlExecutor,
  input: {
    organisationId: string;
    tradingName: string;
    gphcNumber: string;
    addressLine1: string;
    addressLine2: string | null;
    locality: string;
    postcode: string;
    publicEmail: string;
    publicPhone: string | null;
    latitude: number | null;
    longitude: number | null;
  },
) {
  const existing = await graphql.executeGraphql<{ pharmacyDirectoryProfile: DirectoryProfileRecord | null }>(
    GET_DIRECTORY_PROFILE_GQL,
    { organisationId: input.organisationId },
  );
  const profile = existing.data.pharmacyDirectoryProfile;
  await graphql.executeGraphql(UPSERT_DIRECTORY_PROFILE_GQL, {
    organisationId: input.organisationId,
    tradingName: input.tradingName,
    gphcNumber: input.gphcNumber,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    locality: input.locality,
    postcode: input.postcode,
    publicEmail: input.publicEmail,
    publicPhone: input.publicPhone,
    latitude: input.latitude,
    longitude: input.longitude,
    lifecycle: profile?.lifecycle ?? 'DRAFT',
    deliveryCapability: profile?.deliveryCapability ?? 'NONE',
    collectionAvailable: profile?.collectionAvailable ?? true,
    intakeState: profile?.intakeState ?? 'AVAILABLE',
    acceptingNewPatients: profile?.acceptingNewPatients ?? false,
  });
}

async function backfillOrganisationAddresses() {
  const graphql = await createGraphqlExecutor();
  const result = await graphql.executeGraphql<{ organisations: OrganisationRecord[] }>(LIST_ORGANISATIONS_GQL);
  const organisations = result.data.organisations ?? [];
  console.log(`Backfilling structured addresses for ${organisations.length} organisations...\n`);

  let updated = 0;
  let geocoded = 0;
  let directorySynced = 0;
  const failures: string[] = [];

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

    try {
      await graphql.executeGraphql(UPDATE_ORGANISATION_ADDRESS_GQL, {
        id: organisation.id,
        address,
        addressLine1: parsed.addressLine1 || null,
        addressLine2: parsed.addressLine2 || null,
        locality: parsed.locality || null,
        county: parsed.county || null,
        postcode: postcode || null,
        latitude: geocode?.status === 'matched' ? geocode.latitude : organisation.latitude,
        longitude: geocode?.status === 'matched' ? geocode.longitude : organisation.longitude,
      });
      updated += 1;
      if (geocode?.status === 'matched') geocoded += 1;

      if (parsed.addressLine1 && parsed.locality && postcode && organisation.mainContactEmail) {
        await upsertDirectoryProfile(graphql, {
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
        directorySynced += 1;
      }

      console.log(`✔ ${organisation.tradingName} (${organisation.id}): ${postcode ?? 'no postcode'} ${geocode?.status === 'matched' ? '(geocoded)' : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${organisation.id}: ${message}`);
      console.error(`✗ ${organisation.tradingName} (${organisation.id}): ${message}`);
    }
  }

  console.log('\nAddress backfill complete.');
  console.log(`Updated organisations: ${updated}/${organisations.length}`);
  console.log(`Geocoded postcodes: ${geocoded}`);
  console.log(`Directory profiles synced: ${directorySynced}`);
  if (failures.length) {
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

void backfillOrganisationAddresses();
