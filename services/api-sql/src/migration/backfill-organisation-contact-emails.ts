import { parseLegacyAddressBlob } from '../domain/geography/address.js';
import type { DirectoryProfileRecord } from '../repositories/ports/directory.port.js';
import { executeGraphqlViaFirebaseCli } from './dataconnect-cli.js';

type GraphqlExecutor = {
  executeGraphql<TData>(operation: string, variables?: Record<string, unknown>): Promise<{ data: TData }>;
};

type OrganisationRow = {
  id: string;
  tradingName: string;
  gphcNumber: string;
  superintendentName: string;
  address: string;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  county: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  mainContactPhone: string | null;
  organisationDomains_on_organisation: Array<{ hostname: string }>;
};

type StaffRow = {
  uid: string;
  email: string;
  displayName: string;
  status: string;
  disabled: boolean;
  createdAt: string | null;
};

type EmailSource =
  | 'superintendent_staff_email'
  | 'directory_public_email'
  | 'domain_placeholder';

const DRY_RUN = process.env.DRY_RUN === '1';

const GET_DIRECTORY_PROFILE_GQL = `
  query GetDirectoryProfile($organisationId: UUID!) {
    pharmacyDirectoryProfile(key: { organisationId: $organisationId }) {
      lifecycle
      deliveryCapability
      collectionAvailable
      intakeState
      acceptingNewPatients
      publicEmail
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

const LIST_ORGANISATIONS_GQL = `
  query ListOrganisationsForContactEmailBackfill {
    organisations(
      where: { archivedAt: { isNull: true }, mainContactEmail: { isNull: true } }
      limit: 1000
    ) {
      id
      tradingName
      gphcNumber
      superintendentName
      address
      addressLine1
      addressLine2
      locality
      county
      postcode
      latitude
      longitude
      mainContactPhone
      organisationDomains_on_organisation {
        hostname
      }
    }
  }
`;

const LIST_STAFF_GQL = `
  query ListStaffForOrganisation($organisationId: UUID!) {
    staffUsers(
      where: {
        organisationId: { eq: $organisationId }
        disabled: { eq: false }
      }
    ) {
      uid
      email
      displayName
      status
      disabled
      createdAt
    }
  }
`;

const UPDATE_ORGANISATION_EMAIL_GQL = `
  mutation BackfillOrganisationContactEmail($id: UUID!, $mainContactEmail: String!) {
    organisation_update(key: { id: $id }, data: { mainContactEmail: $mainContactEmail })
  }
`;

async function createGraphqlExecutor(): Promise<GraphqlExecutor> {
  const { dataConnect } = await import('../bootstrap/firebase.js');
  try {
    await dataConnect.executeGraphql<{ organisations: Array<{ id: string }> }, any>(
      'query BackfillContactEmailAuthProbe { organisations(limit: 1) { id } }',
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

function hasStructuredAddress(organisation: OrganisationRow) {
  if (organisation.addressLine1 && organisation.postcode) return true;
  const parsed = parseLegacyAddressBlob(organisation.address);
  return Boolean(parsed.addressLine1 && parsed.postcode);
}

function resolvedAddress(organisation: OrganisationRow) {
  if (organisation.addressLine1 && organisation.postcode) {
    return {
      addressLine1: organisation.addressLine1,
      addressLine2: organisation.addressLine2,
      locality: organisation.locality ?? '',
      postcode: organisation.postcode,
    };
  }
  const parsed = parseLegacyAddressBlob(organisation.address);
  return {
    addressLine1: parsed.addressLine1,
    addressLine2: parsed.addressLine2,
    locality: parsed.locality ?? '',
    postcode: parsed.postcode ?? organisation.postcode ?? '',
  };
}

function normaliseDomain(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

function resolveOwnerUid(staff: StaffRow[]) {
  const sorted = [...staff].sort(
    (left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')),
  );
  return sorted[0]?.uid ?? null;
}

function resolveContactEmail(
  organisation: OrganisationRow,
  staff: StaffRow[],
  directoryProfile: Pick<DirectoryProfileRecord, 'publicEmail'> | null,
): { email: string; source: EmailSource } | null {
  const activeStaff = staff.filter(member => member.status === 'ACTIVE' && !member.disabled);
  const superintendentName = organisation.superintendentName.trim().toLowerCase();

  const superintendentMatch = activeStaff.find(
    member => member.displayName.trim().toLowerCase() === superintendentName,
  );
  if (superintendentMatch?.email) {
    return { email: superintendentMatch.email, source: 'superintendent_staff_email' };
  }

  const ownerUid = resolveOwnerUid(activeStaff);
  const owner = activeStaff.find(member => member.uid === ownerUid);
  if (owner?.email) {
    return { email: owner.email, source: 'superintendent_staff_email' };
  }

  if (directoryProfile?.publicEmail?.includes('@')) {
    return { email: directoryProfile.publicEmail, source: 'directory_public_email' };
  }

  const hostname = organisation.organisationDomains_on_organisation[0]?.hostname;
  if (hostname) {
    return {
      email: `enquiries@${normaliseDomain(hostname)}`,
      source: 'domain_placeholder',
    };
  }

  return null;
}

async function upsertDirectoryProfile(
  graphql: GraphqlExecutor,
  organisation: OrganisationRow,
  address: ReturnType<typeof resolvedAddress>,
  publicEmail: string,
) {
  const existing = await graphql.executeGraphql<{ pharmacyDirectoryProfile: DirectoryProfileRecord | null }>(
    GET_DIRECTORY_PROFILE_GQL,
    { organisationId: organisation.id },
  );
  const profile = existing.data.pharmacyDirectoryProfile;
  await graphql.executeGraphql(UPSERT_DIRECTORY_PROFILE_GQL, {
    organisationId: organisation.id,
    tradingName: organisation.tradingName,
    gphcNumber: organisation.gphcNumber,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    locality: address.locality,
    postcode: address.postcode,
    publicEmail,
    publicPhone: organisation.mainContactPhone,
    latitude: organisation.latitude,
    longitude: organisation.longitude,
    lifecycle: profile?.lifecycle ?? 'DRAFT',
    deliveryCapability: profile?.deliveryCapability ?? 'NONE',
    collectionAvailable: profile?.collectionAvailable ?? true,
    intakeState: profile?.intakeState ?? 'AVAILABLE',
    acceptingNewPatients: profile?.acceptingNewPatients ?? false,
  });
}

async function backfillOrganisationContactEmails() {
  const graphql = await createGraphqlExecutor();
  const dryRunLabel = DRY_RUN ? ' (DRY RUN)' : '';
  console.log(`Backfilling organisation contact emails${dryRunLabel}...\n`);

  const result = await graphql.executeGraphql<{ organisations: OrganisationRow[] }>(LIST_ORGANISATIONS_GQL);
  const candidates = (result.data.organisations ?? []).filter(hasStructuredAddress);

  const fixed: Array<{ id: string; tradingName: string; email: string; source: EmailSource }> = [];
  const blocked: Array<{ id: string; tradingName: string; reason: string }> = [];
  const failures: string[] = [];

  for (const organisation of candidates) {
    const address = resolvedAddress(organisation);
    if (!address.addressLine1 || !address.locality || !address.postcode) {
      blocked.push({
        id: organisation.id,
        tradingName: organisation.tradingName,
        reason: 'address incomplete for directory sync',
      });
      continue;
    }

    const staffResult = await graphql.executeGraphql<{ staffUsers: StaffRow[] }>(
      LIST_STAFF_GQL,
      { organisationId: organisation.id },
    );
    const staff = staffResult.data.staffUsers ?? [];

    let directoryProfile: Pick<DirectoryProfileRecord, 'publicEmail'> | null = null;
    try {
      const directoryResult = await graphql.executeGraphql<{ pharmacyDirectoryProfile: DirectoryProfileRecord | null }>(
        GET_DIRECTORY_PROFILE_GQL,
        { organisationId: organisation.id },
      );
      directoryProfile = directoryResult.data.pharmacyDirectoryProfile;
    } catch {
      directoryProfile = null;
    }

    const resolved = resolveContactEmail(organisation, staff, directoryProfile);
    if (!resolved) {
      blocked.push({
        id: organisation.id,
        tradingName: organisation.tradingName,
        reason: 'no superintendent staff email, directory email, or domain',
      });
      continue;
    }

    try {
      if (DRY_RUN) {
        console.log(
          `[dry-run] ${organisation.tradingName} (${organisation.id}): ${resolved.email} via ${resolved.source}`,
        );
        fixed.push({
          id: organisation.id,
          tradingName: organisation.tradingName,
          email: resolved.email,
          source: resolved.source,
        });
        continue;
      }

      await graphql.executeGraphql(UPDATE_ORGANISATION_EMAIL_GQL, {
        id: organisation.id,
        mainContactEmail: resolved.email,
      });
      await upsertDirectoryProfile(graphql, organisation, address, resolved.email);
      fixed.push({
        id: organisation.id,
        tradingName: organisation.tradingName,
        email: resolved.email,
        source: resolved.source,
      });
      console.log(`✔ ${organisation.tradingName} (${organisation.id}): ${resolved.email} via ${resolved.source}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${organisation.id}: ${message}`);
      console.error(`✗ ${organisation.tradingName} (${organisation.id}): ${message}`);
    }
  }

  console.log('\nOrganisation contact email backfill complete.');
  console.log(`Mode: ${DRY_RUN ? 'dry-run' : 'apply'}`);
  console.log(`Candidates with address, missing email: ${candidates.length}`);
  console.log(`Fixed: ${fixed.length}`);
  console.log(`Blocked: ${blocked.length}`);
  if (fixed.length) {
    console.log('\nFixed organisations:');
    for (const entry of fixed) {
      console.log(`  - ${entry.tradingName} (${entry.id}): ${entry.email} [${entry.source}]`);
    }
  }
  if (blocked.length) {
    console.log('\nBlocked organisations:');
    for (const entry of blocked) {
      console.log(`  - ${entry.tradingName} (${entry.id}): ${entry.reason}`);
    }
  }
  if (failures.length) {
    console.log(`\nFailures: ${failures.length}`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

void backfillOrganisationContactEmails();
