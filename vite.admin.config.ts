import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const pharmacyModules = /^\.\/pages\/(Dashboard|PharmacyOverview|CreateOrder|Orders|FormularyPricing|Patients|PharmacySettings|PharmacyFinance)$/;

export default defineConfig({
  root: resolve(__dirname, 'apps/admin'),
  publicDir: resolve(__dirname, 'public'),
  envDir: __dirname,
  plugins: [react()],
  resolve: { alias: [{ find: pharmacyModules, replacement: resolve(__dirname, 'src/surfaces/UnavailableSurface.tsx') }] },
  define: { 'import.meta.env.VITE_APP_SURFACE': JSON.stringify('admin'), 'import.meta.env.VITE_AUTH_MODE': JSON.stringify('cookie') },
  server: { port: 5175, proxy: { '/v1': 'http://127.0.0.1:8080', '/health': 'http://127.0.0.1:8080' } },
  build: { outDir: resolve(__dirname, 'dist-admin'), emptyOutDir: true, sourcemap: false },
});
