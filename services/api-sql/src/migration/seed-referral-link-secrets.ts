import { ReferralLinkService, referralTokenHash } from '../application/referrals/referral-link.service.js';
import { SqlOrganisationRepository } from '../repositories/sql/organisation.sql.js';

const protectedTokens = [
  {
    organisationId: '6d0176bb89a04e329bcec934c9557c42',
    environmentName: 'HHH_EASTWOOD_REFERRAL_TOKEN',
    expectedHash: '1ae3847fe37bf19d7a6bda29ee2b599c781c2d76c2697a58a82fb8be1d27e13d',
  },
  {
    organisationId: '3e9f74ff4fed497d904d4d3ee3e5e126',
    environmentName: 'HHH_KCHEM_REFERRAL_TOKEN',
    expectedHash: 'bf090d34c7d94b07e2c27b4a2a84240a48b93ae66f179506a34535ca56837252',
  },
] as const;

function compact(value: string) {
  return value.replaceAll('-', '').toLowerCase();
}

async function seed() {
  const preferredByOrganisation = new Map<string, string>();
  for (const protectedToken of protectedTokens) {
    const rawToken = process.env[protectedToken.environmentName];
    if (!rawToken || referralTokenHash(rawToken) !== protectedToken.expectedHash) {
      throw new Error(`${protectedToken.environmentName} is missing or does not match the protected legacy link.`);
    }
    preferredByOrganisation.set(protectedToken.organisationId, rawToken);
  }

  const repository = new SqlOrganisationRepository();
  const service = new ReferralLinkService(repository);
  const organisations = await repository.listOrganisations();
  const knownIds = new Set(organisations.map(organisation => compact(organisation.id)));
  for (const protectedToken of protectedTokens) {
    if (!knownIds.has(protectedToken.organisationId)) {
      throw new Error(`Protected pharmacy ${protectedToken.organisationId} is missing from SQL.`);
    }
  }

  const results: Array<{ organisationId: string; name: string; created: boolean }> = [];
  for (const organisation of organisations) {
    const result = await service.ensureEligibilityLink({
      organisationId: organisation.id,
      preferredToken: preferredByOrganisation.get(compact(organisation.id)),
    });
    results.push({ organisationId: organisation.id, name: organisation.tradingName, created: result.created });
  }

  console.log(JSON.stringify({ verified: true, organisations: results }, null, 2));
}

void seed();
