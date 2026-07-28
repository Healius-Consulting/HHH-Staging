import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'apps/eligibility'),
  publicDir: resolve(__dirname, 'public'),
  envDir: __dirname,
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
    },
  },
  build: { outDir: resolve(__dirname, 'dist-eligibility'), emptyOutDir: true },
});
