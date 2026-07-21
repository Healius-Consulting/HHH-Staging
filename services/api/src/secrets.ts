import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from './config.js';
import { HttpError } from './http.js';
import type { IntegrationName } from './types.js';

const client = new SecretManagerServiceClient();

function projectId() {
  const value = config.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!value) throw new HttpError(503, 'Firebase project identity is not configured.', 'PROJECT_NOT_CONFIGURED');
  return value;
}

function secretId(organisationId: string, integration: IntegrationName) {
  const safeId = organisationId.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 180);
  return `hhh-${integration}-${safeId}`;
}

function secretPath(organisationId: string, integration: IntegrationName) {
  return `projects/${projectId()}/secrets/${secretId(organisationId, integration)}`;
}

export async function writeIntegrationSecret(organisationId: string, integration: IntegrationName, value: Record<string, string>) {
  const parent = `projects/${projectId()}`;
  const name = secretPath(organisationId, integration);
  try {
    await client.getSecret({ name });
  } catch (error) {
    if ((error as { code?: number }).code !== 5) throw error;
    await client.createSecret({
      parent,
      secretId: secretId(organisationId, integration),
      secret: { replication: { userManaged: { replicas: [{ location: 'europe-west2' }] } }, labels: { application: 'hhh', integration } },
    });
  }

  const [version] = await client.addSecretVersion({
    parent: name,
    payload: { data: Buffer.from(JSON.stringify(value), 'utf8') },
  });
  return { secretName: name, version: version.name?.split('/').at(-1) ?? 'latest' };
}

export async function readIntegrationSecret<T extends Record<string, string>>(organisationId: string, integration: IntegrationName): Promise<T> {
  try {
    const [version] = await client.accessSecretVersion({ name: `${secretPath(organisationId, integration)}/versions/latest` });
    const raw = version.payload?.data?.toString();
    if (!raw) throw new Error('Secret payload is empty.');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, `${integration === 'curaleaf' ? 'Curaleaf' : 'Worldpay'} is not connected for this pharmacy.`, 'INTEGRATION_NOT_CONNECTED');
  }
}

export async function readPlatformSecret(secretId: 'CURALEAF_API_KEY'): Promise<string> {
  try {
    const [version] = await client.accessSecretVersion({ name: `projects/${projectId()}/secrets/${secretId}/versions/latest` });
    const value = version.payload?.data?.toString().trim();
    if (!value) throw new Error('Secret payload is empty.');
    return value;
  } catch {
    throw new HttpError(503, 'The HHH Curaleaf API key is not configured.', 'PLATFORM_INTEGRATION_NOT_CONNECTED');
  }
}
