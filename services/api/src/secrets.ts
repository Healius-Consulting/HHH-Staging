import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from './config.js';
import { HttpError } from './http.js';
import type { IntegrationName } from './types.js';

const client = new SecretManagerServiceClient();
const SECRET_REGION = 'europe-west2';

function projectId() {
  const value = config.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!value) throw new HttpError(503, 'Firebase project identity is not configured.', 'PROJECT_NOT_CONFIGURED');
  return value;
}

function secretId(pharmacyId: string, integration: IntegrationName) {
  const safeId = pharmacyId.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 180);
  return `hhh-${integration}-${safeId}-${SECRET_REGION}`;
}

function secretPath(pharmacyId: string, integration: IntegrationName) {
  return `projects/${projectId()}/secrets/${secretId(pharmacyId, integration)}`;
}

export async function writeIntegrationSecret(pharmacyId: string, integration: IntegrationName, value: Record<string, string>) {
  const parent = `projects/${projectId()}`;
  const name = secretPath(pharmacyId, integration);
  try {
    await client.getSecret({ name });
  } catch (error) {
    if ((error as { code?: number }).code !== 5) throw error;
    await client.createSecret({
      parent,
      secretId: secretId(pharmacyId, integration),
      secret: { replication: { userManaged: { replicas: [{ location: SECRET_REGION }] } }, labels: { application: 'hhh', integration, region: SECRET_REGION } },
    });
  }

  const [version] = await client.addSecretVersion({
    parent: name,
    payload: { data: Buffer.from(JSON.stringify(value), 'utf8') },
  });
  return { secretName: name, version: version.name?.split('/').at(-1) ?? 'latest' };
}

export async function readIntegrationSecret<T extends Record<string, string>>(pharmacyId: string, integration: IntegrationName): Promise<T> {
  try {
    const [version] = await client.accessSecretVersion({ name: `${secretPath(pharmacyId, integration)}/versions/latest` });
    const raw = version.payload?.data?.toString();
    if (!raw) throw new Error('Secret payload is empty.');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Fallback: try legacy 'curaleaf' integration name if curaleaf_test/live requested
    if (integration === 'curaleaf_test' || integration === 'curaleaf_live') {
      try {
        const [version] = await client.accessSecretVersion({ name: `${secretPath(pharmacyId, 'curaleaf')}/versions/latest` });
        const raw = version.payload?.data?.toString();
        if (raw) return JSON.parse(raw) as T;
      } catch {
        // Fallthrough
      }
    }
    throw new HttpError(503, `${integration.includes('curaleaf') ? 'Curaleaf' : 'Worldpay'} is not connected for this pharmacy.`, 'INTEGRATION_NOT_CONNECTED');
  }
}

export type CuraleafPlatformSecretId =
  | 'CURALEAF_READ_API_KEY_EUROPE_WEST2'
  | 'CURALEAF_WRITE_API_KEY_EUROPE_WEST2'
  | 'CURALEAF_API_KEY_EUROPE_WEST2';

export async function readPlatformSecret(secretIds: readonly CuraleafPlatformSecretId[]): Promise<string> {
  for (const secretId of secretIds) {
    try {
      const [version] = await client.accessSecretVersion({ name: `projects/${projectId()}/secrets/${secretId}/versions/latest` });
      const value = version.payload?.data?.toString().trim();
      if (value) return value;
    } catch {
      // Try the next supported secret name, including the legacy single key.
    }
  }
  throw new HttpError(503, 'The HHH Curaleaf API keys are not configured.', 'PLATFORM_INTEGRATION_NOT_CONNECTED');
}
