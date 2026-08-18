import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_ID = 'hhh-platform-service';
const LOCATION = 'europe-west2';
const PROJECT_ID = process.env.FIREBASE_PROJECT ?? 'hhh26-4ebd2';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export async function executeGraphqlViaFirebaseCli<TData>(
  operation: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: TData }> {
  const dir = mkdtempSync(join(tmpdir(), 'hhh-dc-'));
  const queryPath = join(dir, 'operation.gql');
  const varsPath = join(dir, 'variables.json');
  writeFileSync(queryPath, operation.trim());
  writeFileSync(varsPath, JSON.stringify(variables));

  try {
    const output = execFileSync(
      'firebase',
      [
        'dataconnect:execute',
        queryPath,
        '--project', PROJECT_ID,
        '--service', SERVICE_ID,
        '--location', LOCATION,
        '--variables', `@${varsPath}`,
        '--no-debug-details',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return JSON.parse(output) as { data: TData };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function readFirebaseCliError(error: unknown) {
  if (error && typeof error === 'object' && 'stderr' in error) {
    return String((error as { stderr?: Buffer }).stderr ?? '');
  }
  return error instanceof Error ? error.message : String(error);
}
