import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  DirectoryProfileRecord,
  DirectoryRepositoryPort,
  UpsertDirectoryProfileInput,
} from '../ports/directory.port.js';

const GET_DIRECTORY_PROFILE_GQL = `
  query GetDirectoryProfile($organisationId: UUID!) {
    pharmacyDirectoryProfile(key: { organisationId: $organisationId }) {
      organisationId
      tradingName
      gphcNumber
      addressLine1
      addressLine2
      locality
      postcode
      publicEmail
      publicPhone
      deliveryCapability
      collectionAvailable
      deliverySummary
      intakeState
      latitude
      longitude
      lifecycle
      acceptingNewPatients
    }
  }
`;

const LIST_ELIGIBLE_DIRECTORY_PROFILES_GQL = `
  query ListEligibleDirectoryProfiles {
    pharmacyDirectoryProfiles(
      where: {
        lifecycle: { eq: PUBLISHED }
        intakeState: { ne: FULL }
        acceptingNewPatients: { eq: true }
        latitude: { isNull: false }
        longitude: { isNull: false }
        organisation: {
          status: { eq: LIVE }
          archivedAt: { isNull: true }
          classification: { eq: STANDARD }
        }
      }
      limit: 500
    ) {
      organisationId
      tradingName
      gphcNumber
      addressLine1
      addressLine2
      locality
      postcode
      publicEmail
      publicPhone
      deliveryCapability
      collectionAvailable
      deliverySummary
      intakeState
      latitude
      longitude
      lifecycle
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

export class SqlDirectoryRepository implements DirectoryRepositoryPort {
  async findProfileByOrganisationId(organisationId: string): Promise<DirectoryProfileRecord | null> {
    const result = await dataConnect.executeGraphql<{ pharmacyDirectoryProfile: DirectoryProfileRecord | null }, any>(
      GET_DIRECTORY_PROFILE_GQL,
      { variables: { organisationId } },
    );
    return result.data.pharmacyDirectoryProfile ?? null;
  }

  async listEligibleProfiles(): Promise<DirectoryProfileRecord[]> {
    const result = await dataConnect.executeGraphql<{ pharmacyDirectoryProfiles: DirectoryProfileRecord[] }, any>(
      LIST_ELIGIBLE_DIRECTORY_PROFILES_GQL,
    );
    return (result.data.pharmacyDirectoryProfiles ?? []).filter(
      profile => typeof profile.latitude === 'number' && typeof profile.longitude === 'number',
    );
  }

  async upsertProfile(input: UpsertDirectoryProfileInput): Promise<void> {
    const existing = await this.findProfileByOrganisationId(input.organisationId);
    await dataConnect.executeGraphql<any, any>(UPSERT_DIRECTORY_PROFILE_GQL, {
      variables: {
        organisationId: input.organisationId,
        tradingName: input.tradingName,
        gphcNumber: input.gphcNumber,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        locality: input.locality,
        postcode: input.postcode,
        publicEmail: input.publicEmail,
        publicPhone: input.publicPhone ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        lifecycle: existing?.lifecycle ?? 'DRAFT',
        deliveryCapability: existing?.deliveryCapability ?? 'NONE',
        collectionAvailable: existing?.collectionAvailable ?? true,
        intakeState: existing?.intakeState ?? 'AVAILABLE',
        acceptingNewPatients: existing?.acceptingNewPatients ?? false,
      },
    });
  }
}
