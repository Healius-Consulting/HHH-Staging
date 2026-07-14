import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 10_000;

export class CuraleafRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'CuraleafRequestError';
  }
}

function credentialFor(method: string) {
  return method === 'GET' || method === 'HEAD'
    ? config.CURALEAF_READ_API_KEY
    : config.CURALEAF_WRITE_API_KEY;
}

export async function curaleafRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const apiKey = credentialFor(method);
  if (!apiKey) throw new CuraleafRequestError(503, `Curaleaf ${method === 'GET' || method === 'HEAD' ? 'read' : 'write'} credential is not configured.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, `${config.CURALEAF_BASE_URL}/`), {
      ...init,
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': apiKey, ...init.headers },
    });
    if (!response.ok) throw new CuraleafRequestError(response.status, `Curaleaf request failed with status ${response.status}.`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof CuraleafRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new CuraleafRequestError(504, 'Curaleaf request timed out.');
    throw new CuraleafRequestError(502, 'Curaleaf could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function curaleafConnectionStatus() {
  const environment = config.CURALEAF_BASE_URL.endsWith('.dev') || config.CURALEAF_READ_API_KEY?.startsWith('cura_test_')
    ? 'test'
    : 'production';
  if (!config.CURALEAF_READ_API_KEY) return {
    configured: false,
    connected: false,
    writeConfigured: Boolean(config.CURALEAF_WRITE_API_KEY),
    environment,
    checkedAt: new Date().toISOString(),
    message: 'Curaleaf read credential is not configured.',
  };

  try {
    await curaleafRequest('/v1/formulas/?pageSize=1');
    return {
      configured: true,
      connected: true,
      writeConfigured: Boolean(config.CURALEAF_WRITE_API_KEY),
      environment,
      checkedAt: new Date().toISOString(),
      message: `Curaleaf ${environment === 'test' ? 'sandbox' : 'production'} read access verified.`,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      writeConfigured: Boolean(config.CURALEAF_WRITE_API_KEY),
      environment,
      checkedAt: new Date().toISOString(),
      message: error instanceof CuraleafRequestError ? error.message : 'Curaleaf connection check failed.',
    };
  }
}
