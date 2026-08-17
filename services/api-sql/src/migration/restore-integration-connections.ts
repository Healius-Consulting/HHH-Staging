import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../bootstrap/config.js';
import { SqlIntegrationRepository } from '../repositories/sql/integration.sql.js';
import { SqlOrganisationRepository } from '../repositories/sql/organisation.sql.js';
import type { IntegrationName } from '../repositories/ports/integration.port.js';

const client = new SecretManagerServiceClient();
const parent = `projects/${config.FIREBASE_PROJECT_ID}`;

function compact(value: string) {
  return value.toLowerCase().replaceAll('-', '');
}

function masked(value: string | undefined) {
  if (!value) return null;
  const tail = value.slice(-4);
  return `${'•'.repeat(Math.min(8, Math.max(4, value.length - tail.length)))}${tail}`;
}

async function main(apply: boolean) {
  const organisationRepo = new SqlOrganisationRepository();
  const integrationRepo = new SqlIntegrationRepository();
  const organisations = await organisationRepo.listOrganisations();
  const organisationByCompactId = new Map(organisations.map(organisation => [compact(organisation.id), organisation]));
  const [secrets] = await client.listSecrets({ parent });
  const plans = [];

  for (const secret of secrets) {
    const resourceName = secret.name ?? '';
    const secretId = resourceName.split('/').at(-1) ?? '';
    const match = /^hhh-(curaleaf|worldpay)-([0-9a-f-]{32,36})-europe-west2$/i.exec(secretId);
    if (!match) continue;
    const integration = match[1]!.toUpperCase() as IntegrationName;
    const organisation = organisationByCompactId.get(compact(match[2]!));
    if (!organisation) continue;

    const [version] = await client.accessSecretVersion({ name: `${resourceName}/versions/latest` });
    const raw = version.payload?.data?.toString('utf8');
    if (!raw) throw new Error(`Existing ${integration} secret payload is empty for ${organisation.id}.`);
    const credential = JSON.parse(raw) as Record<string, string>;
    const externalCustomerId = integration === 'CURALEAF' ? credential.customerId : credential.entityId;
    plans.push({
      organisationId: organisation.id,
      organisation: organisation.tradingName,
      integration,
      environment: 'TEST' as const,
      status: integration === 'WORLDPAY' || organisation.status === 'LIVE' ? 'ACTIVE' as const : 'PENDING_VALIDATION' as const,
      // Secret Manager list responses may canonicalise the project segment to
      // the numeric project number. Store the configured project-id path so
      // runtime allowlisting stays explicit and cannot cross projects.
      secretResourceName: `${parent}/secrets/${secretId}`,
      externalCustomerId: externalCustomerId || null,
      maskedCredential: masked(externalCustomerId),
    });
  }

  console.log(JSON.stringify({ apply, plannedConnections: plans.map(plan => ({
    organisation: plan.organisation,
    integration: plan.integration,
    status: plan.status,
    hasExistingSecret: true,
    hasExternalIdentifier: Boolean(plan.externalCustomerId),
  })) }, null, 2));
  if (!apply) return;

  for (const { organisation: _organisation, ...plan } of plans) {
    await integrationRepo.restoreConnection(plan);
  }
  const verified = await integrationRepo.listConnections();
  if (verified.length < plans.length || verified.some(connection => !connection.secretResourceName)) {
    throw new Error('Integration connection restoration verification failed.');
  }
  console.log(JSON.stringify({ verified: true, restoredConnectionCount: plans.length }));
}

void main(process.argv.includes('--apply'));
