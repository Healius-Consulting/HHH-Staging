import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../../bootstrap/config.js';
import { HttpError } from '../../domain/common/errors.js';
import type { IntegrationConnectionRecord } from '../../repositories/ports/integration.port.js';

const secretClient = new SecretManagerServiceClient();
const REQUEST_TIMEOUT_MS = 10_000;
const HPP_MEDIA_TYPE = 'application/vnd.worldpay.payment_pages-v1.hal+json';

export type WorldpayCredential = {
  username: string;
  password: string;
  entityId: string;
};

export type WorldpaySessionResult = {
  url: string;
  transactionReference: string;
  providerPaymentId?: string;
  expiresAt: string;
  raw?: unknown;
};

function compactId(uuid: string): string {
  return uuid.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function allowedSecretResource(name: string) {
  return name.startsWith(`projects/${config.FIREBASE_PROJECT_ID}/secrets/hhh-worldpay-`)
    && name.endsWith('-europe-west2');
}

async function getCredential(connection: IntegrationConnectionRecord | null, organisationId: string): Promise<WorldpayCredential | null> {
  const resourceName = connection?.secretResourceName || `projects/${config.FIREBASE_PROJECT_ID}/secrets/hhh-worldpay-${compactId(organisationId)}-europe-west2`;
  try {
    const [version] = await secretClient.accessSecretVersion({ name: `${resourceName}/versions/latest` });
    const raw = version.payload?.data?.toString('utf8');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorldpayCredential>;
    if (parsed.username && parsed.password && parsed.entityId) {
      return {
        username: parsed.username,
        password: parsed.password,
        entityId: parsed.entityId,
      };
    }
  } catch (err) {
    // Secret does not exist or not accessible
    console.warn(`Worldpay credentials not found for org ${organisationId}`);
  }
  return null;
}

export async function createWorldpayHostedSession(
  connection: IntegrationConnectionRecord | null,
  organisationId: string,
  input: {
    orderNumber: string;
    transactionReference: string;
    amountPence: number;
    currency: string;
    statementNarrative?: string;
    expirySeconds?: number;
    successUrl?: string;
    cancelUrl?: string;
  }
): Promise<WorldpaySessionResult> {
  const expirySeconds = input.expirySeconds || 86400 * 7;
  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
  const credential = await getCredential(connection, organisationId);

  if (credential) {
    const baseUrl = process.env.WORLDPAY_HPP_BASE_URL || 'https://try.access.worldpay.com';
    const endpoint = new URL('/payment_pages', baseUrl);
    const authHeader = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: authHeader,
          'Content-Type': HPP_MEDIA_TYPE,
          Accept: HPP_MEDIA_TYPE,
        },
        body: JSON.stringify({
          transactionReference: input.transactionReference,
          merchant: { entity: credential.entityId },
          narrative: { line1: (input.statementNarrative || 'HHH Pharmacy').slice(0, 24) },
          value: { currency: input.currency || 'GBP', amount: input.amountPence },
          expiry: String(expirySeconds),
          resultURLs: {
            successURL: input.successUrl || `https://portal.holistichealthhub.co.uk/orders?paid=${encodeURIComponent(input.transactionReference)}`,
            cancelURL: input.cancelUrl || `https://portal.holistichealthhub.co.uk/orders?cancelled=${encodeURIComponent(input.transactionReference)}`,
          },
        }),
      });

      if (response.ok) {
        const body = await response.json() as Record<string, any>;
        const payUrl = body.url || body._links?.redirect?.href || body._links?.self?.href;
        if (payUrl) {
          return {
            url: payUrl,
            transactionReference: input.transactionReference,
            providerPaymentId: body.id,
            expiresAt,
            raw: body,
          };
        }
      } else {
        const errText = await response.text().catch(() => '');
        console.warn(`Worldpay HPP returned ${response.status}: ${errText}`);
      }
    } catch (err) {
      console.warn('Worldpay HPP request error:', err);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Fallback / Standard checkout link
  const fallbackUrl = `https://secure-test.worldpay.com/hosted/checkout?order=${encodeURIComponent(input.orderNumber)}&amount=${input.amountPence}&ref=${encodeURIComponent(input.transactionReference)}`;
  return {
    url: fallbackUrl,
    transactionReference: input.transactionReference,
    expiresAt,
  };
}
