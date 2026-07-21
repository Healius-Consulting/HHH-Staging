import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'apps/eligibility'),
  envDir: __dirname,
  plugins: [react()],
  server: { port: 5174 },
  build: { outDir: resolve(__dirname, 'dist-eligibility'), emptyOutDir: true },
});
