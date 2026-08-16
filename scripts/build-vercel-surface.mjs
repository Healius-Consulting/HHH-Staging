import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build, loadEnv } from 'vite';
import { assertSurfaceBuildEnvironment } from '../platform/vercel/surface-build-environment.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surface = process.argv[2] ?? process.env.HHH_SURFACE ?? 'portal';
const supportedSurfaces = new Set(['public', 'portal']);
const privateDirectory = path.join(repositoryRoot, '.vercel-private');

if (!surface || !supportedSurfaces.has(surface)) {
  throw new Error('HHH_SURFACE must be public or portal. Standalone admin and pharmacy deployments are not supported.');
}


const loadedEnvironment = loadEnv(process.env.NODE_ENV ?? 'production', repositoryRoot, '');
assertSurfaceBuildEnvironment(surface, { ...loadedEnvironment, ...process.env });

await rm(privateDirectory, { recursive: true, force: true });
await rm(path.join(repositoryRoot, 'dist-portal'), { recursive: true, force: true });

async function buildProtectedSurface(protectedSurface, outputDirectory = null) {
  await build({ configFile: path.join(repositoryRoot, `vite.${protectedSurface}.config.ts`) });
  const sourceDirectory = path.join(repositoryRoot, `dist-${protectedSurface}`);
  const outputIndex = path.join(sourceDirectory, 'index.html');
  const privateIndex = path.join(privateDirectory, protectedSurface, 'index.html');
  await access(outputIndex);
  await mkdir(path.dirname(privateIndex), { recursive: true });
  await rename(outputIndex, privateIndex);
  if (outputDirectory) await cp(sourceDirectory, outputDirectory, { recursive: true });
}

if (surface === 'portal') {
  // Both client bundles remain independently compiled. Their HTML is private;
  // fingerprinted assets can safely share the portal's static output.
  await buildProtectedSurface('pharmacy', path.join(repositoryRoot, 'dist-portal'));
  await buildProtectedSurface('admin', path.join(repositoryRoot, 'dist-portal'));
} else if (surface === 'public') {
  await build({ configFile: path.join(repositoryRoot, 'vite.public.config.ts') });
}
